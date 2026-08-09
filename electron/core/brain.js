const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const zlib = require("node:zlib");

const db = require("./db");
const claude = require("./claude");
const vectors = require("./vectors");

/**
 * Mimic's brain.
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

  try {
    const raw = JSON.parse(fs.readFileSync(paths.entities, "utf8"));
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
    console.error("[mimic] could not embed:", err.message);
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
    let lines = [];
    try {
      lines = fs.readFileSync(path.join(paths.episodes, file), "utf8").split("\n");
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
 * Record one thing Mimic saw.
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
    fs.appendFileSync(file, `${JSON.stringify(episode)}\n`, "utf8");
  } catch (err) {
    console.error("[mimic] brain could not write an episode:", err.message);
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
    const tmp = `${paths.entities}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...entities.values()]), "utf8");
    fs.renameSync(tmp, paths.entities);
    dirty = false;
  } catch (err) {
    console.error("[mimic] brain could not save what it knows:", err.message);
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
    console.error("[mimic] semantic recall failed, falling back to words:", err.message);
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
async function answer(question, { budgetTokens = 4000 } = {}) {
  const pack = await recallSemantic(question, { limit: 18, budgetTokens });
  if (!claude.configured()) return { ok: false, reason: "no-key", pack };

  const found = pack.entities.length + pack.episodes.length + pack.digests.length;
  if (found === 0) return { ok: true, text: "", pack, empty: true };

  const result = await claude.ask({
    system: ANSWER_SYSTEM,
    effort: claude.EFFORT.consolidate,
    maxTokens: 1200,
    messages: [
      {
        role: "user",
        content: `They asked: "${question}"\n\nWhat I have in memory:\n\n${packToText(pack)}`,
      },
    ],
  });

  if (!result.ok) return { ...result, pack };
  return { ok: true, text: result.text, pack };
}

const ANSWER_SYSTEM = `You are Mimic, an agent that watches how one person works and remembers it.

They have asked what you remember about something. You are given the memories your retrieval turned up — some are summaries of whole periods, some are individual moments with the exact words and figures you read off the screen at the time.

Answer them directly, in prose, from those memories alone. Lead with the answer. Quote the exact figures and wording where you have them — that precision is the reason you kept them. Say when something happened.

If the memories don't actually answer the question, say so plainly rather than assembling something plausible out of what is nearby. If they only partly answer it, give what you have and name the gap. Never invent a number, a name or a date that is not in front of you.

Voice: first person, warm, understated, slightly dry. Short sentences. Brief — a paragraph or two, not an essay. No exclamation marks, no emoji, no bullet lists unless the answer is genuinely a list.`;

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
      .map((f) => JSON.parse(fs.readFileSync(path.join(paths.digests, f), "utf8")))
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
    fs.writeFileSync(digestPath(label), JSON.stringify(digest), "utf8");
  } catch (err) {
    console.error("[mimic] brain could not save a digest:", err.message);
  }

  /* Anything the digest identified as a lasting fact becomes semantic memory. */
  for (const raw of digest.entities ?? []) mergeEntity(raw, at);
  flush();

  return { ok: true, digest };
}

const DIGEST_SYSTEM = `You are the memory of an agent called Mimic that watches how one person works on their computer.

You are given a list of things Mimic observed over a period. Fold them into a single digest that will be read back weeks later, when the raw observations are gone.

Write the summary in Mimic's voice: first person, warm, understated, slightly dry, short sentences. No exclamation marks, no emoji, never salesy. Report what happened rather than praising anyone.

Keep what a colleague would still care about later — what the person was working on, what they were trying to achieve, anything that repeated, anything that broke. Drop the noise: idle window switches, one-off glances, anything already obvious.

Only list an entity if it is a lasting part of this person's working world (a colleague, a client, a project, a document they return to), not something incidental to this hour.`;

const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "themes", "entities", "openThreads"],
  properties: {
    summary: { type: "string", description: "One paragraph, in Mimic's voice." },
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

module.exports = {
  init,
  remember,
  recall,
  recallSemantic,
  answer,
  packToText,
  consolidate,
  knownEntities,
  forgetEntity,
  forgetEpisodes,
  recentEpisodes,
  stats,
  flush,
  wipe,
  paths,
  tokenize,
  embeddableText,
};
