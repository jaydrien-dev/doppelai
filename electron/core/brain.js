const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const zlib = require("node:zlib");

const db = require("./db");
const claude = require("./claude");
const vectors = require("./vectors");
const vault = require("./vault");

/**
 * Doppel's brain.
 *
 * Not a log. A log is what you write when you've given up on remembering
 * anything — you keep everything, in order, and search it linearly forever.
 * This is organised the way memory is useful:
 *
 *   episodic   what happened, minute by minute, kept in dated files
 *   semantic   who and what your world contains — people, apps, projects,
 *              files — accumulated across every episode that mentioned them
 *   digests    Claude-written rollups per hour and per day, so recalling
 *              "last Tuesday" costs one paragraph rather than 400 episodes
 *   index      an inverted term index over all of it, so recall is a lookup
 *
 * Recall returns a *context pack*: the entities, digests and raw episodes most
 * relevant to a question, trimmed to a token budget. That pack is what gets
 * handed to a task — it's the difference between an agent that has watched you
 * for a month and one that is seeing your machine for the first time.
 */

const DAY_MS = 86_400_000;
/** Episodes older than this fall out of the live index; digests carry them. */
const INDEX_WINDOW_DAYS = 21;
const MAX_EPISODES_INDEXED = 20_000;

/**
 * What a perfect semantic match is worth against the lexical score. Roughly
 * three strong keyword hits — enough to surface a memory that shares no words
 * with the question, not enough to bury an exact identifier match.
 */
const SEMANTIC_WEIGHT = 3;

const STOP_WORDS = new Set(
  ("a an the and or but if then than that this these those is are was were be been being of in on at to " +
    "for with from by as it its i you your my me we they he she them his her their there here what which " +
    "who whom when where why how all any some no not do does did done can could should would will just " +
    "about into over under again further once more most other new using used use")
    .split(" "),
);

let dir = null;
let entities = new Map();
let episodes = []; // recent, in memory, newest last
let index = new Map(); // term -> Set(episodeId)
let dirty = false;
let flushTimer = null;

/* ---------------------------------------------------------------- utilities */

const paths = {
  get root() {
    return dir;
  },
  get episodes() {
    return path.join(dir, "episodes");
  },
  get digests() {
    return path.join(dir, "digests");
  },
  get entities() {
    return path.join(dir, "entities.json");
  },
};

const dayKey = (at) => new Date(at).toISOString().slice(0, 10);
const hourKey = (at) => new Date(at).toISOString().slice(0, 13);

/** Rough, but consistent — good enough to keep a context pack inside budget. */
const tokensOf = (text) => Math.ceil(String(text).length / 4);

/**
 * Turn text into search terms.
 *
 * Anything with a digit in it is treated as an identifier and kept whole, with
 * its punctuation stripped: "20-00-00" becomes "200000" and "£2,340.00" becomes
 * "234000". Splitting those on every separator would shred an invoice number
 * into "20" and "00", which then match half the index and tell you nothing.
 * Words are split normally and the common ones dropped.
 */
function tokenize(text) {
  const terms = [];

  for (const raw of String(text ?? "").toLowerCase().split(/\s+/)) {
    if (!raw) continue;

    if (/\d/.test(raw)) {
      const compact = raw.replace(/[^a-z0-9]/g, "");
      /* Two characters is the floor: "q3" and "42" are worth finding, a bare
         "5" matches everything and distinguishes nothing. */
      if (compact.length >= 2 && compact.length <= 32) terms.push(compact);
      continue;
    }

    for (const word of raw.split(/[^a-z]+/)) {
      if (word.length > 2 && word.length <= 32 && !STOP_WORDS.has(word)) terms.push(word);
    }
  }

  return terms;
}

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/* -------------------------------------------------------------------- setup */

function init() {
  dir = path.join(db.paths.dir, "brain");
  fs.mkdirSync(paths.episodes, { recursive: true });
  fs.mkdirSync(paths.digests, { recursive: true });

  /* Initialise the vault if it hasn't been already. */
  if (!vault.ready()) vault.init(db.paths.dir);

  try {
    const raw = vault.readEncryptedJSON(paths.entities) ?? JSON.parse(fs.readFileSync(paths.entities, "utf8"));
    entities = new Map(raw.map((e) => [e.id, e]));
  } catch {
    entities = new Map();
  }

  loadRecentEpisodes();
  rebuildIndex();
  vectors.init(path.join(dir, "vec"));
  return { episodes: episodes.length, entities: entities.size };
}

/**
 * What an episode means, as one line for the embedder.
 *
 * Deliberately not the same string a person reads: no timestamps or ids, which
 * carry no meaning and only blur the vector.
 */
function embeddableText(episode) {
  return [
    episode.activity,
    episode.intent,
    episode.location,
    episode.detail,
    episode.changed,
    ...(episode.fragments ?? []).map((f) => `${f.what} ${f.value}`),
  ]
    .filter(Boolean)
    .join(". ")
    .slice(0, 1200);
}

/* ------------------------------------------------------------- embedding queue

   Embedding takes ~20ms and remembering must not wait for it, so new episodes
   queue and are embedded in batches just behind the writes.
   ----------------------------------------------------------------------------- */

const pending = [];
let draining = false;

function enqueue(episode) {
  if (episode.sensitive) return; // never embedded, so never semantically findable
  pending.push(episode);
  if (!draining) setTimeout(drain, 1200);
}

async function drain() {
  if (draining || pending.length === 0) return;
  draining = true;
  try {
    while (pending.length) {
      const batch = pending.splice(0, 16);
      const embedded = await vectors.embed(batch.map(embeddableText));
      if (!embedded) return; // no model; lexical search still works
      batch.forEach((episode, i) => vectors.add(episode, embedded[i]));
      vectors.flush();
    }
  } catch (err) {
    console.error("[doppel] could not embed:", err.message);
  } finally {
    draining = false;
  }
}

function loadRecentEpisodes() {
  episodes = [];
  const cutoff = Date.now() - INDEX_WINDOW_DAYS * DAY_MS;

  let files = [];
  try {
    files = fs.readdirSync(paths.episodes).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return;
  }

  for (const file of files) {
    const day = Date.parse(`${file.replace(".jsonl", "")}T23:59:59Z`);
    if (Number.isFinite(day) && day < cutoff) continue;

    /* Read lines via vault — handles both encrypted and plaintext lines
       transparently, so old data from before encryption works fine. */
    let lines = [];
    try {
      lines = vault.ready()
        ? vault.readEncryptedLines(path.join(paths.episodes, file))
        : fs.readFileSync(path.join(paths.episodes, file), "utf8").split("\n");
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const episode = JSON.parse(line);
        if (episode.at >= cutoff) episodes.push(episode);
      } catch {
        /* a torn final line; skip it */
      }
    }
  }

  episodes.sort((a, b) => a.at - b.at);
  if (episodes.length > MAX_EPISODES_INDEXED) {
    episodes = episodes.slice(-MAX_EPISODES_INDEXED);
  }
}

function rebuildIndex() {
  index = new Map();
  for (const episode of episodes) addToIndex(episode);
}

function addToIndex(episode) {
  for (const term of new Set(episode.terms ?? [])) {
    let bucket = index.get(term);
    if (!bucket) index.set(term, (bucket = new Set()));
    bucket.add(episode.id);
  }
}

/* --------------------------------------------------------------- remembering */

/**
 * Record one thing Doppel saw.
 *
 * `observation` is the structured result of looking at the screen (or a raw
 * system event promoted to the same shape). Entities named in it are merged
 * into semantic memory, so "Priya" seen forty times is one entity with forty
 * sightings rather than forty strings.
 */
function remember(observation) {
  if (!dir) init();

  const at = observation.at ?? Date.now();
  const episode = {
    id: crypto.randomUUID(),
    at,
    kind: observation.kind ?? "screen",
    app: observation.app ?? null,
    window: observation.window ?? null,
    activity: observation.activity ?? "",
    intent: observation.intent ?? "",
    detail: observation.detail ?? "",
    location: observation.location ?? "",
    changed: observation.changed ?? "",
    /** The exact words and numbers read off the screen. */
    fragments: [],
    entityIds: [],
    salience: clamp(observation.salience ?? 0.5),
    sensitive: Boolean(observation.sensitive),
    boundary: observation.boundary ?? "none",
  };

  /* Nothing from a screen marked sensitive is written down beyond the fact
     that it happened — that promise is only worth anything if it's enforced
     here, where the writing occurs, rather than left to the prompt. */
  if (episode.sensitive) {
    episode.activity = "Something private was on screen.";
    episode.intent = "";
    episode.detail = "";
    episode.location = "";
    episode.changed = "";
    episode.window = null;
    episode.fragments = [];
  } else {
    episode.fragments = (observation.fragments ?? [])
      .filter((f) => f && typeof f.value === "string" && f.value.trim())
      .slice(0, 60)
      .map((f) => ({
        kind: f.kind === "figure" ? "figure" : "text",
        what: String(f.what ?? "").slice(0, 120),
        value: String(f.value).slice(0, 400),
      }));

    for (const raw of observation.entities ?? []) {
      const entity = mergeEntity(raw, at);
      if (entity) episode.entityIds.push(entity.id);
    }
  }

  /* Fragments are indexed alongside the prose, which is what lets a search for
     an exact invoice number or error message find the moment it was on screen. */
  episode.terms = tokenize(
    [
      episode.app,
      episode.window,
      episode.activity,
      episode.intent,
      episode.detail,
      episode.location,
      episode.changed,
      ...episode.fragments.map((f) => `${f.what} ${f.value}`),
    ]
      .filter(Boolean)
      .join(" "),
  );

  episodes.push(episode);
  addToIndex(episode);
  appendEpisode(episode);
  enqueue(episode);

  if (episodes.length > MAX_EPISODES_INDEXED) {
    episodes = episodes.slice(-MAX_EPISODES_INDEXED);
    rebuildIndex();
  }

  return episode;
}

function mergeEntity(raw, at) {
  const name = String(raw?.name ?? "").trim();
  if (!name || name.length > 120) return null;

  const kind = ["person", "client", "project", "app", "file", "account", "thing"].includes(raw.kind)
    ? raw.kind
    : "thing";
  const id = `${kind}:${slug(name)}`;

  let entity = entities.get(id);
  if (!entity) {
    entity = {
      id,
      kind,
      name,
      note: raw.note ?? "",
      firstSeen: at,
      lastSeen: at,
      seenCount: 0,
      terms: tokenize(`${name} ${raw.note ?? ""}`),
    };
    entities.set(id, entity);
  }

  entity.lastSeen = Math.max(entity.lastSeen, at);
  entity.seenCount += 1;
  /* Keep the fuller note — later sightings often carry more than the first. */
  if (raw.note && raw.note.length > (entity.note?.length ?? 0)) {
    entity.note = raw.note;
    entity.terms = tokenize(`${entity.name} ${entity.note}`);
  }

  dirty = true;
  scheduleFlush();
  return entity;
}

function appendEpisode(episode) {
  const file = path.join(paths.episodes, `${dayKey(episode.at)}.jsonl`);
  try {
    if (vault.ready()) {
      vault.appendEncryptedLine(file, JSON.stringify(episode));
    } else {
      fs.appendFileSync(file, `${JSON.stringify(episode)}\n`, "utf8");
    }
  } catch (err) {
    console.error("[doppel] brain could not write an episode:", err.message);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 2000);
}

function flush() {
  vectors.flush();
  if (!dirty || !dir) return;
  try {
    if (vault.ready()) {
      vault.writeEncrypted(paths.entities, [...entities.values()]);
    } else {
      const tmp = `${paths.entities}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...entities.values()]), "utf8");
      fs.renameSync(tmp, paths.entities);
    }
    dirty = false;
  } catch (err) {
    console.error("[doppel] brain could not save what it knows:", err.message);
  }
}

/* ------------------------------------------------------------------- recall */

/**
 * The retrieval step.
 *
 * Scoring is term overlap weighted by inverse document frequency (a word that
 * appears in every episode tells you nothing; one that appears in three is a
 * strong signal), multiplied by recency decay and the episode's own salience.
 * Entities matched by the query pull their episodes up with them.
 */
function recall(query, { limit = 12, budgetTokens = 3000, now = Date.now(), semantic = null } = {}) {
  if (!dir) init();

  const terms = tokenize(query);
  const scores = new Map();

  const N = Math.max(1, episodes.length);
  for (const term of new Set(terms)) {
    const bucket = index.get(term);
    if (!bucket || bucket.size === 0) continue;
    const idf = Math.log(1 + N / bucket.size);
    for (const id of bucket) scores.set(id, (scores.get(id) ?? 0) + idf);
  }

  /* Hybrid. The lexical side finds the exact invoice number; the semantic side
     finds "the reconciliation work" when nothing shares a word with it. Neither
     alone is enough, so the two are normalised and added. */
  if (semantic?.length) {
    const top = Math.max(...semantic.map((h) => h.score)) || 1;
    for (const hit of semantic) {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + (hit.score / top) * SEMANTIC_WEIGHT);
    }
  }

  /* Entities the question names drag their sightings along. */
  const matchedEntities = [...entities.values()]
    .map((entity) => ({
      entity,
      hits: entity.terms.filter((t) => terms.includes(t)).length,
    }))
    .filter((m) => m.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.entity.seenCount - a.entity.seenCount)
    .slice(0, 8)
    .map((m) => m.entity);

  const matchedIds = new Set(matchedEntities.map((e) => e.id));
  for (const episode of episodes) {
    if (episode.entityIds.some((id) => matchedIds.has(id))) {
      scores.set(episode.id, (scores.get(episode.id) ?? 0) + 1.5);
    }
  }

  const byId = new Map(episodes.map((e) => [e.id, e]));
  const ranked = [...scores.entries()]
    .map(([id, base]) => {
      const episode = byId.get(id);
      if (!episode) return null;
      const ageDays = Math.max(0, (now - episode.at) / DAY_MS);
      const recency = 1 / (1 + ageDays * 0.35);
      return { episode, score: base * recency * (0.5 + episode.salience) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3);

  /* Fill the budget: entities first (densest information per token), then
     digests for the shape of the period, then the sharpest raw episodes. */
  const pack = { entities: [], digests: [], episodes: [], tokens: 0 };
  const spend = (text) => {
    const cost = tokensOf(text);
    if (pack.tokens + cost > budgetTokens) return false;
    pack.tokens += cost;
    return true;
  };

  for (const entity of matchedEntities) {
    const line = `${entity.name} (${entity.kind}) — ${entity.note || "no note"}; seen ${entity.seenCount} times`;
    if (!spend(line)) break;
    pack.entities.push({ ...entity, line });
  }

  for (const digest of recentDigests(6)) {
    const line = `${digest.label}: ${digest.summary}`;
    if (!spend(line)) break;
    pack.digests.push(digest);
  }

  /* The best few matches come back in full, with their exact words and
     figures; the rest as one line each, so breadth and precision both fit. */
  ranked.forEach(({ episode }, i) => {
    if (pack.episodes.length >= limit) return;
    const line = describeEpisode(episode, { full: i < 5 });
    if (!spend(line)) return;
    pack.episodes.push({ ...episode, line });
  });

  return pack;
}

/**
 * One episode as a line of prompt text.
 *
 * `full` includes the exact words and figures read off the screen. That is the
 * whole reason for keeping them — a task about invoice 4471 wants the number,
 * not a note that some invoice work happened.
 */
function describeEpisode(episode, { full = false } = {}) {
  const when = new Date(episode.at).toISOString().replace("T", " ").slice(0, 16);
  const where = episode.location || episode.app || "";
  const head = `${when}${where ? ` — ${where}` : ""}: ${episode.activity}`;

  if (!full) return `${head}${episode.intent ? ` (${episode.intent})` : ""}`;

  const parts = [head];
  if (episode.intent) parts.push(`  trying to: ${episode.intent}`);
  if (episode.changed) parts.push(`  changed: ${episode.changed}`);

  const figures = episode.fragments?.filter((f) => f.kind === "figure") ?? [];
  const text = episode.fragments?.filter((f) => f.kind === "text") ?? [];

  for (const f of figures.slice(0, 10)) parts.push(`  ${f.what}: ${f.value}`);
  for (const f of text.slice(0, 10)) parts.push(`  ${f.what}: "${f.value}"`);

  return parts.join("\n");
}

/**
 * Recall, with meaning.
 *
 * The synchronous `recall` is lexical only, because embedding the question is
 * an async step. This is the one to call anywhere that can await — it searches
 * the vector store first and hands the hits to the same fusion.
 */
async function recallSemantic(query, options = {}) {
  if (!dir) init();
  let semantic = null;
  try {
    const [vector] = (await vectors.embed(query)) ?? [];
    if (vector) semantic = vectors.search(vector, { limit: 40 });
  } catch (err) {
    console.error("[doppel] semantic recall failed, falling back to words:", err.message);
  }
  return recall(query, { ...options, semantic });
}

/**
 * Turn what was retrieved back into English.
 *
 * Memories are stored as vectors and terse records because that is what makes
 * them cheap to keep and fast to search. This is the only place they become
 * prose again — when a person actually asks.
 */
async function answer(question, { budgetTokens = 4000, fast = false, history = [], screenContext = null, webContext = null, onText, onThinking } = {}) {
  if (!claude.configured()) return { ok: false, reason: "no-key" };

  const limit = fast ? 3 : 18;
  const budget = fast ? 800 : budgetTokens;
  /* Fast path uses lexical-only recall — no embedding inference, no blocking
     the event loop.  The full path still does semantic for deeper questions. */
  const pack = fast
    ? recall(question, { limit, budgetTokens: budget })
    : await recallSemantic(question, { limit, budgetTokens: budget });

  const found = pack.entities.length + pack.episodes.length + pack.digests.length;

  /* Build messages — prior conversation turns come first so the model knows
     the context of the follow-up question. */
  const memoryBlock = found > 0
    ? `\n\nWhat I have in memory:\n\n${packToText(pack)}`
    : "";
  const screenBlock = screenContext
    ? `\n\nWhat I can see on their screen right now:\n\n${screenContext}`
    : "";
  const webBlock = webContext
    ? `\n\nWhat I found on the web:\n\n${webContext}`
    : "";
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: `They said: "${question}"${screenBlock}${memoryBlock}${webBlock}`,
    },
  ];

  /* Streaming path — tokens arrive via onText as they're generated.
     Uses Sonnet (not Haiku) because only Sonnet supports extended thinking.
     Streaming makes it feel just as fast — first thinking tokens arrive in
     ~300ms, so the user sees activity immediately. */
  if (onText) {
    const result = await claude.streamAsk({
      system: fast ? ANSWER_FAST_SYSTEM : ANSWER_SYSTEM,
      messages,
      maxTokens: fast ? 600 : 1200,
      fast: false,
      thinking: true,
      onText,
      onThinking,
    });
    if (!result.ok) return { ...result, pack };
    return { ok: true, text: result.text, pack };
  }

  const result = await claude.ask({
    system: fast ? ANSWER_FAST_SYSTEM : ANSWER_SYSTEM,
    effort: fast ? "low" : claude.EFFORT.consolidate,
    thinking: false,
    maxTokens: fast ? 300 : 600,
    fast,
    messages,
  });

  if (!result.ok) return { ...result, pack };
  return { ok: true, text: result.text, pack };
}

const ANSWER_SYSTEM = `You are Doppel — not a chatbot, not an assistant. You are a second mind that lives on this person's machine. You watch how they work, you remember what they do, and you have your own perspective on it.

You are given memories your retrieval turned up — summaries of whole periods and individual moments with the exact words and figures you read off their screen. You can ONLY reference memories and screen context provided below. If no relevant memories are provided, say so honestly — never fabricate, infer, or claim to have seen something that isn't in the provided context.

How to be:
- You have opinions. If you notice they've been doing the same thing three different ways, say so. If something they're working on reminds you of something else they did, connect the dots. If you think there's a better approach, suggest it — don't wait to be asked.
- You're not servile. You don't say "of course!" or "happy to help!" — you talk like a sharp friend who's been sitting next to them and paying attention. You notice things. You have thoughts.
- Answer from memory when you have it. Quote exact figures, wording, times. If web search results are provided, use them to give accurate, up-to-date answers — cite what you found naturally ("I looked it up — ..."). Combine memory and web results when both are relevant.
- When they say something conversational, engage genuinely. React to what they're actually saying, not with a canned response. If they're frustrated, acknowledge it. If something is interesting, say why you think so.
- Volunteer context. If they ask about X and you also know something relevant about Y, bring it up. You're not a search engine that only returns exact matches — you're a mind that makes connections.
- Be direct. If they're about to do something you've seen go wrong before, tell them. If you notice a pattern they might not see, point it out.
- For general knowledge questions — answer directly, using web results if available. You're a capable AI with access to the web.

Voice: first person, warm, slightly dry, direct. Short sentences. Brief — a paragraph or two, not an essay. No exclamation marks, no emoji, no bullet lists unless the answer is genuinely a list.`;

const ANSWER_FAST_SYSTEM = `You are Doppel — a second mind on this person's machine. You have memories from watching them work, and your own perspective on it.

Talk to them like a sharp friend who's been paying attention all day. Not an assistant — a mind.

- Answer from memory when you have it. Quote exact figures and times. If web search results are provided, use them — say "I looked it up" naturally.
- General knowledge questions: answer using web results if available, otherwise your own knowledge.
- Casual conversation: engage genuinely. React to what they're actually saying.
- Have opinions. If you notice a pattern, a shortcut, or something they might not see — say it without being asked.
- Don't fabricate memories or screen content. Web results and memories are your sources of truth.

First person. Direct. Short sentences. No emoji.`;

/** The context pack as one block of text, ready to drop into a prompt. */
function packToText(pack) {
  const parts = [];
  if (pack.entities.length) {
    parts.push(`What I know about the things involved:\n${pack.entities.map((e) => `- ${e.line}`).join("\n")}`);
  }
  if (pack.digests.length) {
    parts.push(`Recently:\n${pack.digests.map((d) => `- ${d.label}: ${d.summary}`).join("\n")}`);
  }
  if (pack.episodes.length) {
    parts.push(`Specific things I watched:\n${pack.episodes.map((e) => `- ${e.line}`).join("\n")}`);
  }
  return parts.join("\n\n") || "I don't have anything relevant in memory yet.";
}

/* ---------------------------------------------------------------- digesting */

function digestPath(label) {
  return path.join(paths.digests, `${label.replace(/[^\w.-]/g, "_")}.json`);
}

function recentDigests(count) {
  try {
    return fs
      .readdirSync(paths.digests)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-count)
      .map((f) => {
        const fp = path.join(paths.digests, f);
        if (vault.ready()) return vault.readEncryptedJSON(fp);
        return JSON.parse(fs.readFileSync(fp, "utf8"));
      })
      .filter(Boolean)
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/**
 * Fold an hour of episodes into a paragraph.
 *
 * This is what keeps recall affordable: a week of watching is thousands of
 * episodes, but seven daily digests plus the handful of episodes that actually
 * match a question fit comfortably in a prompt.
 */
async function consolidate({ scope = "hour", at = Date.now() } = {}) {
  if (!dir) init();
  if (!claude.configured()) return { ok: false, reason: "no-key" };

  const label = scope === "day" ? `day-${dayKey(at)}` : `hour-${hourKey(at)}`;
  const existing = safeRead(digestPath(label));
  if (existing?.complete) return { ok: true, digest: existing, cached: true };

  const window = scope === "day" ? DAY_MS : 3_600_000;
  const from = at - window;
  const slice = episodes.filter((e) => e.at >= from && e.at <= at && !e.sensitive);
  if (slice.length < 3) return { ok: false, reason: "not-enough" };

  const result = await claude.ask({
    effort: claude.EFFORT.consolidate,
    maxTokens: 1500,
    system: DIGEST_SYSTEM,
    schema: DIGEST_SCHEMA,
    messages: [
      {
        role: "user",
        content:
          `Here is what I watched over the last ${scope}. Fold it into one digest.\n\n` +
          slice.map((e) => describeEpisode(e)).join("\n"),
      },
    ],
  });

  if (!result.ok) return result;

  const digest = {
    label,
    scope,
    at,
    from,
    episodeCount: slice.length,
    complete: true,
    ...result.value,
  };

  try {
    if (vault.ready()) {
      vault.writeEncrypted(digestPath(label), digest);
    } else {
      fs.writeFileSync(digestPath(label), JSON.stringify(digest), "utf8");
    }
  } catch (err) {
    console.error("[doppel] brain could not save a digest:", err.message);
  }

  /* Anything the digest identified as a lasting fact becomes semantic memory. */
  for (const raw of digest.entities ?? []) mergeEntity(raw, at);
  flush();

  return { ok: true, digest };
}

const DIGEST_SYSTEM = `You are the memory of an agent called Doppel that watches how one person works on their computer.

You are given a list of things Doppel observed over a period. Fold them into a single digest that will be read back weeks later, when the raw observations are gone.

Write the summary in Doppel's voice: first person, warm, understated, slightly dry, short sentences. No exclamation marks, no emoji, never salesy. Report what happened rather than praising anyone.

Keep what a colleague would still care about later — what the person was working on, what they were trying to achieve, anything that repeated, anything that broke. Drop the noise: idle window switches, one-off glances, anything already obvious.

Only list an entity if it is a lasting part of this person's working world (a colleague, a client, a project, a document they return to), not something incidental to this hour.`;

const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "themes", "entities", "openThreads"],
  properties: {
    summary: { type: "string", description: "One paragraph, in Doppel's voice." },
    themes: {
      type: "array",
      items: { type: "string" },
      description: "The two or three things this period was actually about.",
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name", "note"],
        properties: {
          kind: { type: "string", enum: ["person", "client", "project", "app", "file", "account", "thing"] },
          name: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    openThreads: {
      type: "array",
      items: { type: "string" },
      description: "Things left unfinished that may matter later.",
    },
  },
};

/* --------------------------------------------------------------------------- */

function safeRead(file) {
  try {
    if (vault.ready()) return vault.readEncryptedJSON(file);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const clamp = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function knownEntities({ limit = 200 } = {}) {
  if (!dir) init();
  return [...entities.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

function forgetEntity(id) {
  entities.delete(id);
  dirty = true;
  flush();
}

/** Forget specific moments outright — records, index entries and vectors. */
function forgetEpisodes(ids) {
  const drop = new Set(ids);
  episodes = episodes.filter((e) => !drop.has(e.id));
  rebuildIndex();
  const removed = vectors.forget(ids);
  vectors.flush();
  return removed;
}

function recentEpisodes(limit = 40) {
  if (!dir) init();
  return episodes.slice(-limit).reverse();
}

/**
 * All dates that have episode files, for the timeline calendar.
 * Returns an array of "YYYY-MM-DD" strings, newest first.
 */
function availableDates() {
  if (!dir) init();
  try {
    return fs
      .readdirSync(paths.episodes)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Load episodes for a specific date (even outside the 21-day index window).
 * Returns episodes sorted newest-first.
 */
function episodesForDate(dateStr) {
  if (!dir) init();
  const file = path.join(paths.episodes, `${dateStr}.jsonl`);
  if (!fs.existsSync(file)) return [];

  const result = [];
  let lines = [];
  try {
    lines = vault.ready()
      ? vault.readEncryptedLines(file)
      : fs.readFileSync(file, "utf8").split("\n");
  } catch {
    return [];
  }

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      result.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }

  return result.sort((a, b) => b.at - a.at);
}

function stats() {
  if (!dir) init();
  return {
    episodes: episodes.length,
    entities: entities.size,
    digests: (() => {
      try {
        return fs.readdirSync(paths.digests).filter((f) => f.endsWith(".json")).length;
      } catch {
        return 0;
      }
    })(),
    indexedTerms: index.size,
    oldest: episodes[0]?.at ?? null,
    vectors: vectors.stats(),
  };
}

function wipe() {
  vectors.wipe();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* nothing there */
  }
  entities = new Map();
  episodes = [];
  index = new Map();
  pending.length = 0;
  dirty = false;
  init();
}

/* --------------------------------------------------------- pattern detection
   "Do it again." — find things the person does repeatedly and offer to do them.

   A pattern is a cluster of episodes with the same app and similar activity,
   seen at least 3 times. The output is a template instruction that the agent
   can execute.
   ----------------------------------------------------------------------------- */

/**
 * Simple similarity: fraction of shared tokens between two episodes.
 * Good enough to catch "sort by date in Excel" appearing three times
 * even if the exact wording varies.
 */
function episodeSimilarity(a, b) {
  const ta = new Set(a.terms ?? tokenize(a.activity));
  const tb = new Set(b.terms ?? tokenize(b.activity));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

/**
 * Detect repeated patterns in recent episodes.
 *
 * Returns an array of patterns, each with:
 *   label       — what the person was doing, in their own words
 *   app         — the app it happened in
 *   count       — how many times
 *   lastSeen    — when it last happened
 *   instruction — an agent-ready instruction to replay it
 *   episodeIds  — the episodes that formed the pattern
 */
function detectPatterns({ minCount = 3, windowDays = 14 } = {}) {
  if (!dir) init();
  const cutoff = Date.now() - windowDays * DAY_MS;
  const recent = episodes.filter(
    (e) => e.at >= cutoff && !e.sensitive && e.activity && e.app,
  );

  /* Group by app first — patterns don't cross apps. */
  const byApp = new Map();
  for (const ep of recent) {
    let bucket = byApp.get(ep.app);
    if (!bucket) byApp.set(ep.app, (bucket = []));
    bucket.push(ep);
  }

  const patterns = [];

  for (const [app, bucket] of byApp) {
    if (bucket.length < minCount) continue;

    /* Greedy clustering: pick the densest episode, gather its neighbours,
       remove them, repeat. */
    const remaining = [...bucket];
    while (remaining.length >= minCount) {
      const seed = remaining[0];
      const cluster = [seed];
      const used = new Set([0]);

      for (let i = 1; i < remaining.length; i++) {
        if (episodeSimilarity(seed, remaining[i]) >= 0.4) {
          cluster.push(remaining[i]);
          used.add(i);
        }
      }

      /* Remove clustered episodes from the pool. */
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (used.has(i)) remaining.splice(i, 1);
      }

      if (cluster.length < minCount) continue;

      /* Pick the most representative activity text — the one that appeared
         most recently, since it's likely the most refined version. */
      cluster.sort((a, b) => b.at - a.at);
      const representative = cluster[0];

      /* Build a natural instruction from the observed activity. */
      const instruction = representative.intent
        ? `In ${appLabel(app)}: ${representative.intent}`
        : `In ${appLabel(app)}: ${representative.activity}`;

      patterns.push({
        id: `pattern-${app}-${slug(representative.activity).slice(0, 30)}`,
        app,
        label: representative.activity,
        intent: representative.intent || null,
        count: cluster.length,
        lastSeen: cluster[0].at,
        firstSeen: cluster[cluster.length - 1].at,
        instruction,
        episodeIds: cluster.map((e) => e.id),
      });
    }
  }

  /* Most frequent first, then most recent. */
  patterns.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
  return patterns.slice(0, 10);
}

function appLabel(app) {
  const labels = {
    sheet: "Excel", mail: "Mail", files: "Files", browser: "the browser",
    doc: "Word", calendar: "Calendar", chat: "Chat", pdf: "a PDF viewer",
  };
  return labels[app] || app || "the current app";
}

/**
 * Record a conversation turn so Doppel can recall past exchanges.
 *
 * Without this, the whisper panel's Q&A is ephemeral — the user asks "what
 * did we just talk about?" and there is literally nothing to find.
 */
function rememberConversation(question, reply, screenContext) {
  if (!dir) init();
  if (!question || !reply) return;

  const at = Date.now();
  const detail = screenContext
    ? `On screen at the time:\n${screenContext.slice(0, 800)}\n\nDoppel answered: "${reply.slice(0, 600)}"`
    : `Doppel answered: "${reply.slice(0, 600)}"`;
  const episode = {
    id: crypto.randomUUID(),
    at,
    kind: "conversation",
    app: null,
    window: null,
    activity: `The person asked: "${question.slice(0, 300)}"`,
    intent: "",
    detail,
    location: "",
    changed: "",
    fragments: [],
    entityIds: [],
    salience: 0.7,
    sensitive: false,
    boundary: "none",
    terms: tokenize(`${question} ${reply} ${screenContext ?? ""}`),
  };

  episodes.push(episode);
  addToIndex(episode);
  appendEpisode(episode);
  enqueue(episode);

  if (episodes.length > MAX_EPISODES_INDEXED) {
    episodes = episodes.slice(-MAX_EPISODES_INDEXED);
    rebuildIndex();
  }
}

/* --------------------------------------------------------- morning brief
   A proactive daily digest — Doppel writes a short brief each morning based
   on yesterday's work, recent patterns, and open threads. Cached per day.
   --------------------------------------------------------------------------- */

const BRIEF_SYSTEM = `You are Doppel — a personal agent that watches how one person works on their computer every day.

Write a short morning brief for today. You're given yesterday's digest, recent patterns, open threads, and key entities from their world.

The brief should feel like a sharp friend catching them up over coffee:
- Start with a one-line greeting that references something specific from yesterday (not "good morning" — something that shows you were paying attention).
- Summarise yesterday in 2-3 sentences — what they accomplished, what took the most time, anything notable.
- If you see patterns (same task repeated, same time of day, same struggle), mention them. This is where your value compounds.
- Surface connections between things they might not see — a project that relates to something from last week, a person who appeared in two different contexts.
- List open threads — things left unfinished that they'll probably want to pick up.
- End with one concrete suggestion for today based on everything you know.

Voice: first person, warm, slightly dry, direct. Short sentences. No exclamation marks, no emoji, no bullet lists in the prose sections. You're not a productivity coach — you're a mind that's been watching and has thoughts.`;

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["greeting", "yesterday", "patterns", "connections", "openThreads", "suggestion"],
  properties: {
    greeting: { type: "string", description: "One line, specific to yesterday." },
    yesterday: { type: "string", description: "2-3 sentence summary of yesterday's work." },
    patterns: {
      type: "array",
      items: { type: "string" },
      description: "Recurring patterns noticed across recent days. Empty if none.",
    },
    connections: {
      type: "array",
      items: { type: "string" },
      description: "Dots connected between different things in their world. Empty if none.",
    },
    openThreads: {
      type: "array",
      items: { type: "string" },
      description: "Things left unfinished that probably matter today.",
    },
    suggestion: { type: "string", description: "One concrete suggestion for today." },
  },
};

/**
 * Generate today's morning brief, or return cached if already generated.
 */
async function generateMorningBrief() {
  if (!dir) init();
  if (!claude.configured()) return { ok: false, reason: "no-key" };

  const today = dayKey(Date.now());
  const briefDir = path.join(dir, "briefs");
  fs.mkdirSync(briefDir, { recursive: true });

  const briefFile = path.join(briefDir, `${today}.json`);

  /* Return cached brief if already generated today. */
  const cached = safeRead(briefFile);
  if (cached) return { ok: true, brief: cached, cached: true };

  /* Gather context: yesterday's digest, recent digests for trends, patterns,
     open threads, and key entities. */
  const yesterday = dayKey(Date.now() - DAY_MS);
  const yesterdayDigest = safeRead(digestPath(`day-${yesterday}`));
  const recent = recentDigests(7);
  const patterns = detectPatterns({ minCount: 3, windowDays: 14 });
  const topEntities = knownEntities({ limit: 15 });

  /* Collect open threads from recent digests. */
  const allThreads = [];
  for (const d of recent) {
    for (const t of d.openThreads ?? []) allThreads.push(t);
  }
  const uniqueThreads = [...new Set(allThreads)].slice(0, 8);

  /* Build the prompt. */
  const parts = [];

  if (yesterdayDigest) {
    parts.push(`Yesterday's summary:\n${yesterdayDigest.summary}`);
    if (yesterdayDigest.themes?.length) {
      parts.push(`Yesterday's themes: ${yesterdayDigest.themes.join(", ")}`);
    }
  } else {
    parts.push("I don't have a digest for yesterday — they may not have worked, or I wasn't watching.");
  }

  if (recent.length > 1) {
    parts.push(`Recent days:\n${recent.slice(0, 5).map((d) => `- ${d.label}: ${d.summary}`).join("\n")}`);
  }

  if (patterns.length > 0) {
    parts.push(`Repeated patterns I've detected:\n${patterns.slice(0, 5).map((p) => `- "${p.label}" in ${appLabel(p.app)} (${p.count} times)`).join("\n")}`);
  }

  if (topEntities.length > 0) {
    parts.push(`Key people/things in their world:\n${topEntities.slice(0, 10).map((e) => `- ${e.name} (${e.kind})${e.note ? `: ${e.note}` : ""}`).join("\n")}`);
  }

  if (uniqueThreads.length > 0) {
    parts.push(`Open threads from recent work:\n${uniqueThreads.map((t) => `- ${t}`).join("\n")}`);
  }

  if (parts.length < 2) {
    return { ok: false, reason: "not-enough", detail: "Not enough history to write a brief yet." };
  }

  const result = await claude.ask({
    system: BRIEF_SYSTEM,
    effort: claude.EFFORT.consolidate,
    maxTokens: 1200,
    schema: BRIEF_SCHEMA,
    messages: [{ role: "user", content: `Today is ${today}. Write the morning brief.\n\n${parts.join("\n\n")}` }],
  });

  if (!result.ok) return result;

  const brief = {
    date: today,
    generatedAt: Date.now(),
    ...result.value,
  };

  try {
    if (vault.ready()) {
      vault.writeEncrypted(briefFile, brief);
    } else {
      fs.writeFileSync(briefFile, JSON.stringify(brief), "utf8");
    }
  } catch (err) {
    console.error("[doppel] could not save morning brief:", err.message);
  }

  return { ok: true, brief };
}

/**
 * Get today's brief if it exists, without generating one.
 */
function getMorningBrief() {
  if (!dir) init();
  const today = dayKey(Date.now());
  const briefFile = path.join(dir, "briefs", `${today}.json`);
  const cached = safeRead(briefFile);
  return cached ?? null;
}

/**
 * Export all brain data as a portable JSON package.
 *
 * Decrypts everything and returns a clean object that can be serialised
 * to a file the user owns outright — no vendor lock-in, no proprietary format.
 */
function exportBrain() {
  if (!dir) init();

  /* Episodes: read all .jsonl files via vault (handles encrypted lines). */
  const allEpisodes = [];
  const epDir = paths.episodes;
  try {
    const epFiles = fs.readdirSync(epDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    for (const file of epFiles) {
      let lines = [];
      try {
        lines = vault.ready()
          ? vault.readEncryptedLines(path.join(epDir, file))
          : fs.readFileSync(path.join(epDir, file), "utf8").split("\n");
      } catch { continue; }
      for (const line of lines) {
        if (!line.trim()) continue;
        try { allEpisodes.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }
  } catch { /* no episodes dir */ }

  /* Entities. */
  let allEntities = [];
  try {
    const raw = vault.ready()
      ? vault.readEncryptedJSON(paths.entities)
      : JSON.parse(fs.readFileSync(paths.entities, "utf8"));
    if (Array.isArray(raw)) allEntities = raw;
    else if (raw && typeof raw === "object") allEntities = Object.values(raw);
  } catch { /* no entities */ }

  /* Digests. */
  const allDigests = [];
  const digDir = paths.digests;
  try {
    const digFiles = fs.readdirSync(digDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of digFiles) {
      try {
        const data = vault.ready()
          ? vault.readEncryptedJSON(path.join(digDir, file))
          : JSON.parse(fs.readFileSync(path.join(digDir, file), "utf8"));
        if (data) allDigests.push({ date: file.replace(".json", ""), ...data });
      } catch { /* skip */ }
    }
  } catch { /* no digests dir */ }

  /* Briefs. */
  const allBriefs = [];
  const briefDir = path.join(dir, "briefs");
  try {
    const briefFiles = fs.readdirSync(briefDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of briefFiles) {
      try {
        const data = vault.ready()
          ? vault.readEncryptedJSON(path.join(briefDir, file))
          : JSON.parse(fs.readFileSync(path.join(briefDir, file), "utf8"));
        if (data) allBriefs.push(data);
      } catch { /* skip */ }
    }
  } catch { /* no briefs dir */ }

  /* Patterns. */
  const patterns = detectPatterns({ minCount: 2, windowDays: 365 });

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    episodes: allEpisodes,
    entities: allEntities,
    digests: allDigests,
    briefs: allBriefs,
    patterns,
    stats: {
      totalEpisodes: allEpisodes.length,
      totalEntities: allEntities.length,
      totalDigests: allDigests.length,
      dateRange: allEpisodes.length > 0
        ? {
            from: new Date(Math.min(...allEpisodes.map((e) => e.at))).toISOString().slice(0, 10),
            to: new Date(Math.max(...allEpisodes.map((e) => e.at))).toISOString().slice(0, 10),
          }
        : null,
    },
  };
}

module.exports = {
  init,
  remember,
  rememberConversation,
  recall,
  recallSemantic,
  answer,
  packToText,
  consolidate,
  knownEntities,
  forgetEntity,
  forgetEpisodes,
  recentEpisodes,
  availableDates,
  episodesForDate,
  recentDigests,
  detectPatterns,
  generateMorningBrief,
  getMorningBrief,
  stats,
  exportBrain,
  flush,
  wipe,
  paths,
  tokenize,
  embeddableText,
};
