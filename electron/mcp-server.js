#!/usr/bin/env node

/**
 * Doppel MCP Server
 *
 * Exposes Doppel's brain — the always-on personal memory built by watching how
 * you work — as an MCP server that any AI model can connect to.
 *
 * This runs as a standalone process, separate from the Electron app. It reads
 * the same brain files on disk, so any AI client (Claude Desktop, Cursor, etc.)
 * gets access to everything Doppel has observed.
 *
 * Tools:
 *   recall           — Hybrid semantic+keyword search over memory
 *   ask              — AI-powered Q&A over memory (uses Claude API)
 *   remember         — Store information into Doppel's brain from external AIs
 *   recent_activity  — Last N observations
 *   screen_now       — Current screen context and what user is doing
 *   known_entities   — People, apps, projects Doppel has learned about
 *   user_context     — Full current state: app, narration, watched folders
 *   patterns         — Behavioral patterns: app usage, time distribution
 *   daily_summary    — All observations + digest for a given date
 *   available_dates  — Which dates have recorded activity
 *   focused_recall   — Search with time, app, and entity filters
 *   episode_timeline — Chronological timeline for a date range
 *   morning_brief    — Synthesized daily brief
 *   about_user       — What Doppel knows about the user at a glance
 *   check_inbox      — Poll for tasks queued by the user
 *   claim_task       — Claim a task before working on it
 *   report_result    — Report task completion back to the user
 *
 * Resources:
 *   doppel://brain/stats    — Episode, entity, vector counts
 *   doppel://brain/entities — All known entities as JSON
 *   doppel://activity/today — Today's full activity log
 *
 * Prompts:
 *   daily-review    — "What did I do today?"
 *   project-context — "What do you know about [topic]?"
 *   work-patterns   — "What are my work habits?"
 *
 * Usage:
 *   node electron/mcp-server.js
 *
 * Configure in Claude Desktop's config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "doppel": {
 *         "command": "node",
 *         "args": ["<path-to-doppel>/electron/mcp-server.js"]
 *       }
 *     }
 *   }
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { McpServer } = require("@modelcontextprotocol/server");
const { StdioServerTransport } = require("@modelcontextprotocol/server/stdio");
const z = require("zod");

/* -------------------------------------------------------------------------- */
/*  Locate Doppel's data directory                                            */
/* -------------------------------------------------------------------------- */

function findDataDir() {
  const platform = process.platform;
  let dir;
  if (platform === "win32") {
    dir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Doppel");
  } else if (platform === "darwin") {
    dir = path.join(os.homedir(), "Library", "Application Support", "Doppel");
  } else {
    dir = path.join(os.homedir(), ".config", "Doppel");
  }
  if (!fs.existsSync(dir)) {
    console.error(`[doppel-mcp] Data directory not found: ${dir}`);
    console.error("[doppel-mcp] Make sure Doppel has been run at least once.");
    process.exit(1);
  }
  return dir;
}

const DATA_DIR = findDataDir();
const BRAIN_DIR = path.join(DATA_DIR, "brain");
const STATE_FILE = path.join(DATA_DIR, "doppel-state.json");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");

/* -------------------------------------------------------------------------- */
/*  Read brain data from disk                                                 */
/* -------------------------------------------------------------------------- */

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function readEntities() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(BRAIN_DIR, "entities.json"), "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readEpisodes(limit = 50) {
  const episodesDir = path.join(BRAIN_DIR, "episodes");
  if (!fs.existsSync(episodesDir)) return [];

  const allFiles = fs.readdirSync(episodesDir)
    .filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"))
    .sort()
    .reverse();

  const episodes = [];
  for (const file of allFiles) {
    if (episodes.length >= limit) break;
    const filepath = path.join(episodesDir, file);
    try {
      if (file.endsWith(".jsonl")) {
        const content = fs.readFileSync(filepath, "utf8");
        const lines = content.split("\n").filter((l) => l.trim());
        for (let i = lines.length - 1; i >= 0 && episodes.length < limit; i--) {
          try {
            episodes.push(JSON.parse(lines[i]));
          } catch {
            /* Encrypted lines — skip without the vault. */
          }
        }
      } else {
        const raw = JSON.parse(fs.readFileSync(filepath, "utf8"));
        const arr = Array.isArray(raw) ? raw : [];
        for (let i = arr.length - 1; i >= 0 && episodes.length < limit; i--) {
          episodes.push(arr[i]);
        }
      }
    } catch {
      /* skip corrupt files */
    }
  }
  return episodes;
}

function readEpisodesForDate(dateStr) {
  const episodesDir = path.join(BRAIN_DIR, "episodes");
  const jsonl = path.join(episodesDir, `${dateStr}.jsonl`);
  const json = path.join(episodesDir, `${dateStr}.json`);
  const file = fs.existsSync(jsonl) ? jsonl : fs.existsSync(json) ? json : null;
  if (!file) return [];

  try {
    if (file.endsWith(".jsonl")) {
      return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readDigests(limit = 20) {
  const digestsDir = path.join(BRAIN_DIR, "digests");
  if (!fs.existsSync(digestsDir)) return [];

  const files = fs.readdirSync(digestsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const digests = [];
  for (const file of files) {
    if (digests.length >= limit) break;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(digestsDir, file), "utf8"));
      if (raw && raw.summary) {
        digests.push({ label: file.replace(".json", ""), ...raw });
      }
    } catch {
      /* skip */
    }
  }
  return digests;
}

/* -------------------------------------------------------------------------- */
/*  Vector store                                                              */
/* -------------------------------------------------------------------------- */

const DIMS = 384;
const SCALE = 127;

let vectorStore = new Int8Array(0);
let vectorMeta = [];
let vectorCount = 0;
let embeddingModel = null;
let embeddingUnavailable = null;

function loadVectors() {
  const vecDir = path.join(BRAIN_DIR, "vectors");
  const vecFile = path.join(vecDir, "vectors.bin");
  const metaFile = path.join(vecDir, "meta.json");

  try {
    vectorMeta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const raw = fs.readFileSync(vecFile);
    vectorStore = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    vectorCount = Math.min(vectorMeta.length, Math.floor(vectorStore.length / DIMS));
    if (vectorMeta.length !== vectorCount) vectorMeta = vectorMeta.slice(0, vectorCount);
    console.error(`[doppel-mcp] Loaded ${vectorCount} vectors`);
  } catch {
    vectorStore = new Int8Array(0);
    vectorMeta = [];
    vectorCount = 0;
  }
}

async function loadEmbeddingModel() {
  try {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = path.join(BRAIN_DIR, "model");
    env.allowRemoteModels = true;
    embeddingModel = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: "q8",
      device: "cpu",
    });
    console.error("[doppel-mcp] Embedding model loaded");
  } catch (err) {
    embeddingUnavailable = err?.message ?? String(err);
    console.error("[doppel-mcp] No embedding model, using lexical search only:", embeddingUnavailable);
  }
}

async function embedQuery(text) {
  if (!embeddingModel) return null;
  const output = await embeddingModel([text], { pooling: "mean", normalize: true });
  return Float32Array.from(output.data.subarray(0, DIMS));
}

function vectorSearch(queryVec, limit = 20) {
  if (!queryVec || vectorCount === 0) return [];

  const q = new Int8Array(DIMS);
  for (let d = 0; d < DIMS; d++) {
    const v = Math.round(queryVec[d] * SCALE);
    q[d] = v > 127 ? 127 : v < -128 ? -128 : v;
  }

  const hits = [];
  const norm = SCALE * SCALE;

  for (let i = 0; i < vectorCount; i++) {
    const entry = vectorMeta[i];
    if (!entry || entry.sen) continue;

    let dot = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += q[d] * vectorStore[offset + d];

    const score = dot / norm;
    if (score >= 0.15) hits.push({ id: entry.id, at: entry.at, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/*  Search — hybrid lexical + vector (RRF fusion)                             */
/* -------------------------------------------------------------------------- */

const STOP_WORDS = new Set(
  "a an the and or but if then than that this these those is are was were be been being of in on at to for with from by as it its i you your my me we they he she them his her their there here what which who whom when where why how all any some no not do does did done can could should would will just about into over under again further once more most other new using used use"
    .split(" "),
);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

async function search(query, limit = 15) {
  const terms = tokenize(query);
  const termSet = new Set(terms);
  const episodes = readEpisodes(500);
  const entities = readEntities();
  const digests = readDigests(30);

  const lexicalEpisodes = terms.length > 0
    ? episodes
        .map((ep) => {
          const text = [ep.activity, ep.intent, ep.detail, ep.location, ep.changed,
            ...(ep.fragments ?? []).map((f) => `${f.what} ${f.value}`)]
            .filter(Boolean)
            .join(" ");
          const epTerms = tokenize(text);
          let score = 0;
          for (const t of epTerms) {
            if (termSet.has(t)) score++;
          }
          return { ep, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit * 2)
    : [];

  let semanticHits = [];
  const queryVec = await embedQuery(query);
  if (queryVec) {
    semanticHits = vectorSearch(queryVec, limit * 2);
  }

  const RRF_K = 60;
  const combined = new Map();
  const epById = new Map();
  for (const ep of episodes) epById.set(ep.id, ep);

  for (let i = 0; i < lexicalEpisodes.length; i++) {
    const id = lexicalEpisodes[i].ep.id;
    const prev = combined.get(id) ?? { ep: lexicalEpisodes[i].ep, score: 0 };
    prev.score += 1 / (RRF_K + i + 1);
    combined.set(id, prev);
  }

  for (let i = 0; i < semanticHits.length; i++) {
    const id = semanticHits[i].id;
    const ep = epById.get(id);
    if (!ep) continue;
    const prev = combined.get(id) ?? { ep, score: 0 };
    prev.score += 1 / (RRF_K + i + 1);
    combined.set(id, prev);
  }

  const fusedEpisodes = [...combined.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.ep);

  const scoredEntities = terms.length > 0
    ? entities
        .map((ent) => {
          const text = [ent.id, ent.type, ent.summary, ...(ent.facts ?? [])]
            .filter(Boolean)
            .join(" ");
          const entTerms = tokenize(text);
          let score = 0;
          for (const t of entTerms) {
            if (termSet.has(t)) score++;
          }
          return { ent, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((s) => s.ent)
    : [];

  const scoredDigests = terms.length > 0
    ? digests
        .filter((d) => {
          const dTerms = tokenize(d.summary || "");
          return dTerms.some((t) => termSet.has(t));
        })
        .slice(0, 5)
    : [];

  return {
    episodes: fusedEpisodes,
    entities: scoredEntities,
    digests: scoredDigests,
    method: queryVec ? "hybrid" : "lexical",
  };
}

/* -------------------------------------------------------------------------- */
/*  Claude API — for the `ask` tool                                           */
/* -------------------------------------------------------------------------- */

let Anthropic = null;
let claudeClient = null;

function getApiKey() {
  /* Read the API key from Doppel's state file, same as the main app. */
  const state = readState();
  const encrypted = state.ai?.apiKey;
  /* The state file stores the key directly (not encrypted) in the standalone
     context. If encryption is enabled in the main app, the key here may be
     the raw string or a wrapped object. Try the simple path first. */
  if (typeof encrypted === "string" && encrypted.startsWith("sk-")) return encrypted;
  /* Fall back to environment variable. */
  return process.env.ANTHROPIC_API_KEY || "";
}

function getClaudeClient() {
  const key = getApiKey();
  if (!key) return null;
  if (!Anthropic) {
    try {
      Anthropic = require("@anthropic-ai/sdk");
    } catch {
      return null;
    }
  }
  if (!claudeClient) {
    claudeClient = new Anthropic({ apiKey: key, maxRetries: 2 });
  }
  return claudeClient;
}

async function askClaude(system, userMessage) {
  const client = getClaudeClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = (response?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    console.error("[doppel-mcp] Claude API error:", err?.message ?? err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Write to brain — for the `remember` tool                                  */
/* -------------------------------------------------------------------------- */

function writeEpisode(episode) {
  const episodesDir = path.join(BRAIN_DIR, "episodes");
  if (!fs.existsSync(episodesDir)) fs.mkdirSync(episodesDir, { recursive: true });

  const date = new Date(episode.at).toISOString().slice(0, 10);
  const file = path.join(episodesDir, `${date}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(episode) + "\n");

  /* Queue for embedding — write to the pending file that the main app's
     vector worker picks up on next run. */
  const pendingFile = path.join(BRAIN_DIR, "vectors", "pending.jsonl");
  const pendingDir = path.dirname(pendingFile);
  if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });
  fs.appendFileSync(pendingFile, JSON.stringify({ id: episode.id, text: episode.detail || episode.activity }) + "\n");
}

/* -------------------------------------------------------------------------- */
/*  Inbox — task queue between user and external agents                       */
/* -------------------------------------------------------------------------- */

function readInbox() {
  try {
    const raw = JSON.parse(fs.readFileSync(INBOX_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeInbox(tasks) {
  fs.writeFileSync(INBOX_FILE, JSON.stringify(tasks, null, 2));
}

function formatTask(t) {
  const time = new Date(t.createdAt).toLocaleString();
  const parts = [`[${time}] (${t.status})`];
  parts.push(t.instruction);
  if (t.agent) parts.push(`— claimed by ${t.agent}`);
  if (t.result) parts.push(`\n  Result: ${t.result.slice(0, 300)}`);
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/*  Format helpers                                                            */
/* -------------------------------------------------------------------------- */

function formatEpisode(ep) {
  const time = new Date(ep.at).toLocaleString();
  const parts = [`[${time}]`];
  if (ep.app) parts.push(`(${ep.app})`);
  if (ep.activity) parts.push(ep.activity);
  if (ep.detail) parts.push(`— ${ep.detail}`);
  return parts.join(" ");
}

function formatEntity(ent) {
  const parts = [`${ent.id} (${ent.type})`];
  if (ent.summary) parts.push(`: ${ent.summary}`);
  if (ent.facts?.length) parts.push(`\n  Facts: ${ent.facts.join("; ")}`);
  return parts.join("");
}

function formatDigest(d) {
  return `${d.label}: ${d.summary}`;
}

/* -------------------------------------------------------------------------- */
/*  MCP Server                                                                */
/* -------------------------------------------------------------------------- */

const server = new McpServer({
  name: "doppel",
  version: "3.0.0",
  instructions: `Doppel is the user's personal memory layer. It watches their screen and remembers everything they do — apps, documents, conversations, tasks, habits. You are connected to it.

## When to use Doppel tools

- When the user asks "what was I working on", "what did I do", "when did I last", "do you remember", or anything about their past activity → use **recall** or **ask**.
- When the user mentions a person, project, or app and wants context → use **recall** with that as the query.
- When the user asks for a summary of their day or week → use **daily_summary** or **morning_brief**.
- When the user asks about their habits or patterns → use **patterns**.
- When the user wants to know what's on screen right now → use **screen_now**.
- When you learn something useful about the user during conversation → use **remember** to save it to their Doppel brain.
- **Always check_inbox at the start of every conversation.** The user may have queued tasks for you from Doppel's UI. If there are tasks, claim them with **claim_task**, do the work, then **report_result**.

## Tool selection

- **recall** — fast keyword + semantic search, returns raw data. Use for lookups.
- **ask** — AI-powered Q&A, returns a synthesized answer. Use when the user wants a narrative response.
- **remember** — save a fact or note into Doppel's brain so it persists across sessions.
- **check_inbox** — poll for tasks the user queued for you. Always check on conversation start.
- **claim_task** — lock a task so you can work on it.
- **report_result** — send your completed work back to the user's Doppel UI.

## Important

- Doppel is local and private. Never refer to it as a third-party service — it runs on the user's machine.
- When reporting results, be concise. The result text appears in Doppel's chat UI.
- If check_inbox returns tasks, prioritize them — the user explicitly queued them for you.`,
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TOOLS                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/* --- Tool: recall --------------------------------------------------------- */

server.registerTool(
  "recall",
  {
    description:
      "Search Doppel's memory for anything it has observed. Doppel watches the user's screen and remembers what they do — apps they use, documents they edit, tasks they work on, people they communicate with. Returns raw episodes, entities, and digests. For a synthesized natural-language answer, use the `ask` tool instead.",
    inputSchema: z.object({
      query: z.string().describe("What to search for — a topic, app name, person, project, or question"),
    }),
  },
  async ({ query }) => {
    const results = await search(query);
    const total = results.episodes.length + results.entities.length + results.digests.length;

    if (total === 0) {
      return {
        content: [{ type: "text", text: "Nothing in Doppel's memory matches that query." }],
      };
    }

    const parts = [];
    if (results.entities.length > 0) {
      parts.push("## Known entities\n" + results.entities.map(formatEntity).join("\n"));
    }
    if (results.digests.length > 0) {
      parts.push("## Recent summaries\n" + results.digests.map(formatDigest).join("\n"));
    }
    if (results.episodes.length > 0) {
      parts.push("## Observed moments\n" + results.episodes.map(formatEpisode).join("\n"));
    }

    const suffix = results.method === "hybrid"
      ? "\n\n_Searched by meaning + keywords._"
      : "\n\n_Searched by keywords only (embedding model loading)._";

    return {
      content: [{ type: "text", text: parts.join("\n\n") + suffix }],
    };
  },
);

/* --- Tool: ask ------------------------------------------------------------ */

server.registerTool(
  "ask",
  {
    description:
      "Ask a question about the user and get a natural-language answer synthesized from Doppel's memory. Unlike `recall` which returns raw data, this tool uses AI to read through the user's memory and compose a clear answer. Use this for questions like 'what was I working on yesterday?', 'what do I know about project X?', 'when did I last talk to Y?'. Requires an Anthropic API key to be configured in Doppel.",
    inputSchema: z.object({
      question: z.string().describe("The question to answer from the user's memory"),
    }),
  },
  async ({ question }) => {
    const results = await search(question, 20);
    const total = results.episodes.length + results.entities.length + results.digests.length;

    if (total === 0) {
      return {
        content: [{ type: "text", text: "Nothing relevant found in Doppel's memory to answer that question." }],
      };
    }

    /* Build context from search results */
    const contextParts = [];
    if (results.entities.length > 0) {
      contextParts.push("ENTITIES:\n" + results.entities.map(formatEntity).join("\n"));
    }
    if (results.digests.length > 0) {
      contextParts.push("SUMMARIES:\n" + results.digests.map(formatDigest).join("\n"));
    }
    if (results.episodes.length > 0) {
      contextParts.push("OBSERVATIONS:\n" + results.episodes.map(formatEpisode).join("\n"));
    }
    const context = contextParts.join("\n\n");

    const answer = await askClaude(
      "You are answering a question about a user based on observations from Doppel, their personal AI that watches their screen and remembers what they do. Answer based ONLY on the provided observations — do not make up information. Be specific and reference times, apps, and details from the data. If the data doesn't fully answer the question, say what you can and note what's missing.",
      `Question: ${question}\n\nDoppel's memory:\n${context}`,
    );

    if (!answer) {
      /* No API key or call failed — return raw data instead */
      const parts = [];
      if (results.entities.length > 0) parts.push("## Entities\n" + results.entities.map(formatEntity).join("\n"));
      if (results.digests.length > 0) parts.push("## Summaries\n" + results.digests.map(formatDigest).join("\n"));
      if (results.episodes.length > 0) parts.push("## Observations\n" + results.episodes.map(formatEpisode).join("\n"));
      return {
        content: [{ type: "text", text: `_Could not generate a synthesized answer (no API key or API error). Here is the raw data:_\n\n${parts.join("\n\n")}` }],
      };
    }

    return {
      content: [{ type: "text", text: answer }],
    };
  },
);

/* --- Tool: remember ------------------------------------------------------- */

server.registerTool(
  "remember",
  {
    description:
      "Store information into Doppel's brain so it becomes part of the user's permanent memory. Use this when the user tells you something important they want Doppel to remember, or when you learn something about the user that would be useful for future context. The information will be searchable via recall and ask tools. Examples: 'remember that I prefer dark mode', 'remember that project X deadline is Friday', 'remember this meeting summary'.",
    inputSchema: z.object({
      content: z.string().describe("What to remember — the information to store"),
      category: z.string().optional().describe("Optional category: 'fact', 'preference', 'note', 'summary', 'conversation'. Defaults to 'note'."),
    }),
  },
  async ({ content, category }) => {
    const cat = category || "note";
    const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const episode = {
      id,
      at: now,
      kind: "external",
      app: "mcp",
      window: null,
      activity: `Remembered ${cat}`,
      intent: `Stored via MCP by an external AI tool`,
      detail: content,
      location: null,
      changed: "",
      fragments: [{ kind: "text", what: cat, value: content.slice(0, 400) }],
      salience: 0.8,
      sensitive: false,
      boundary: "none",
    };

    writeEpisode(episode);

    return {
      content: [{ type: "text", text: `Stored in Doppel's memory (${cat}). It will be searchable via recall and will be embedded for semantic search when Doppel's main app next processes the queue.` }],
    };
  },
);

/* --- Tool: screen_now ----------------------------------------------------- */

server.registerTool(
  "screen_now",
  {
    description:
      "Get what's currently on the user's screen — the latest observation from Doppel including what app is active, what they're doing, and any recent narration. This is the closest thing to 'seeing' the user's screen. Use this when you need current context: what app they're in, what document they're editing, what website they're on. Doppel updates this every few seconds when active.",
    inputSchema: z.object({}),
  },
  async () => {
    const state = readState();
    const narration = state.narration ?? [];
    const paused = state.observation?.paused;

    if (paused) {
      return {
        content: [{ type: "text", text: "Doppel is currently paused — not watching the screen. No current context available." }],
      };
    }

    if (narration.length === 0) {
      return {
        content: [{ type: "text", text: "No screen observations yet. Doppel may still be starting up, or the user hasn't been active." }],
      };
    }

    /* The narration array is ordered newest-first. */
    const latest = narration[0];
    const time = new Date(latest.at).toLocaleString();
    const ago = Math.round((Date.now() - latest.at) / 1000);

    const parts = [];
    parts.push(`## Current screen (${ago}s ago)`);
    parts.push(latest.text);
    if (latest.app) parts.push(`**App:** ${latest.app}`);
    if (latest.intent) parts.push(`**Intent:** ${latest.intent}`);
    if (latest.adaptation) parts.push(`**Note:** ${latest.adaptation}`);

    /* Add a few more recent entries for context flow */
    if (narration.length > 1) {
      parts.push("\n## Recent context");
      for (let i = 1; i < Math.min(narration.length, 5); i++) {
        const n = narration[i];
        const nTime = new Date(n.at).toLocaleString();
        parts.push(`[${nTime}] ${n.app ? `(${n.app}) ` : ""}${n.text}`);
      }
    }

    /* Active app from the most recent episodes */
    const recentEps = readEpisodes(3);
    if (recentEps.length > 0 && recentEps[0].detail) {
      parts.push(`\n## Latest observation detail`);
      parts.push(recentEps[0].detail);
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  },
);

/* --- Tool: recent_activity ------------------------------------------------ */

server.registerTool(
  "recent_activity",
  {
    description:
      "Get the user's most recent activity as observed by Doppel. Returns the last N things Doppel saw the user doing.",
    inputSchema: z.object({
      limit: z.number().optional().default(10).describe("How many recent observations to return (default 10, max 50)"),
    }),
  },
  async ({ limit }) => {
    const n = Math.min(Math.max(1, limit ?? 10), 50);
    const episodes = readEpisodes(n);

    if (episodes.length === 0) {
      return {
        content: [{ type: "text", text: "Doppel hasn't observed any activity yet." }],
      };
    }

    const lines = episodes.map(formatEpisode);
    return {
      content: [{ type: "text", text: `## Last ${lines.length} observations\n${lines.join("\n")}` }],
    };
  },
);

/* --- Tool: known_entities ------------------------------------------------- */

server.registerTool(
  "known_entities",
  {
    description:
      "List the people, apps, projects, files, and other things Doppel has learned about from watching the user work.",
    inputSchema: z.object({
      type: z.string().optional().describe("Filter by entity type: 'person', 'app', 'project', 'file', or omit for all"),
    }),
  },
  async ({ type }) => {
    let entities = readEntities();
    if (type) {
      entities = entities.filter((e) => e.type === type);
    }

    if (entities.length === 0) {
      return {
        content: [{ type: "text", text: type ? `No ${type} entities found.` : "Doppel hasn't learned about any entities yet." }],
      };
    }

    const lines = entities.map(formatEntity);
    return {
      content: [{ type: "text", text: `## Known entities (${entities.length})\n${lines.join("\n\n")}` }],
    };
  },
);

/* --- Tool: user_context --------------------------------------------------- */

server.registerTool(
  "user_context",
  {
    description:
      "Get the user's full current context — observation status, narration, recent activity, and watched folders.",
    inputSchema: z.object({}),
  },
  async () => {
    const state = readState();
    const episodes = readEpisodes(5);
    const narration = state.narration ?? [];

    const parts = [];

    const paused = state.observation?.paused;
    parts.push(`Doppel is ${paused ? "paused" : "actively watching"}.`);

    if (narration.length > 0) {
      const latest = narration[0];
      const time = new Date(latest.at).toLocaleString();
      parts.push(`\nLast noticed (${time}): ${latest.text}`);
      if (latest.app) parts.push(`App: ${latest.app}`);
    }

    if (episodes.length > 0) {
      parts.push(`\n## Recent activity`);
      parts.push(episodes.map(formatEpisode).join("\n"));
    }

    const roots = state.observation?.roots ?? [];
    if (roots.length > 0) {
      parts.push(`\nWatched folders: ${roots.join(", ")}`);
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  },
);

/* --- Tool: patterns ------------------------------------------------------- */

server.registerTool(
  "patterns",
  {
    description:
      "Get behavioral patterns Doppel has detected — most-used apps, time-of-day distribution, common app transitions. Useful for understanding routines.",
    inputSchema: z.object({}),
  },
  async () => {
    const episodes = readEpisodes(200);
    if (episodes.length < 10) {
      return {
        content: [{ type: "text", text: "Not enough observations yet to detect patterns. Doppel needs more time watching." }],
      };
    }

    const appCounts = {};
    const hourCounts = {};
    for (const ep of episodes) {
      if (ep.app) appCounts[ep.app] = (appCounts[ep.app] || 0) + 1;
      const hour = new Date(ep.at).getHours();
      const bucket = hour < 9 ? "morning (before 9am)" : hour < 12 ? "late morning (9am-12pm)" : hour < 17 ? "afternoon (12pm-5pm)" : "evening (after 5pm)";
      hourCounts[bucket] = (hourCounts[bucket] || 0) + 1;
    }

    const topApps = Object.entries(appCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([app, count]) => `- ${app}: ${count} observations`);

    const timeDistribution = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([period, count]) => `- ${period}: ${count} observations`);

    const recentApps = episodes.slice(0, 30).map((ep) => ep.app).filter(Boolean);
    const transitions = [];
    for (let i = 0; i < recentApps.length - 1; i++) {
      if (recentApps[i] !== recentApps[i + 1]) {
        transitions.push(`${recentApps[i]} → ${recentApps[i + 1]}`);
      }
    }
    const transitionCounts = {};
    for (const t of transitions) transitionCounts[t] = (transitionCounts[t] || 0) + 1;
    const topTransitions = Object.entries(transitionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, count]) => `- ${t} (${count}x)`);

    const parts = [
      `## Most-used apps\n${topApps.join("\n")}`,
      `\n## Work time distribution\n${timeDistribution.join("\n")}`,
    ];
    if (topTransitions.length > 0) {
      parts.push(`\n## Common app transitions\n${topTransitions.join("\n")}`);
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  },
);

/* --- Tool: daily_summary -------------------------------------------------- */

server.registerTool(
  "daily_summary",
  {
    description:
      "Get a summary of what the user did on a specific day. Defaults to today.",
    inputSchema: z.object({
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
    }),
  },
  async ({ date }) => {
    const target = date || new Date().toISOString().slice(0, 10);
    const digestsDir = path.join(BRAIN_DIR, "digests");

    const parts = [`## Summary for ${target}`];

    const digestFile = path.join(digestsDir, `${target}.json`);
    if (fs.existsSync(digestFile)) {
      try {
        const digest = JSON.parse(fs.readFileSync(digestFile, "utf8"));
        if (digest.summary) parts.push(`\n### Digest\n${digest.summary}`);
      } catch { /* skip */ }
    }

    const eps = readEpisodesForDate(target);
    if (eps.length > 0) {
      parts.push(`\n### ${eps.length} observations`);
      const apps = new Set(eps.map((e) => e.app).filter(Boolean));
      parts.push(`Apps used: ${[...apps].join(", ")}`);

      const first5 = eps.slice(0, 5).map(formatEpisode);
      const last5 = eps.length > 10 ? eps.slice(-5).map(formatEpisode) : [];

      parts.push(`\nFirst observations:\n${first5.join("\n")}`);
      if (last5.length > 0) {
        parts.push(`\nLast observations:\n${last5.join("\n")}`);
      }
    }

    if (parts.length === 1) {
      parts.push("No observations found for this date.");
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  },
);

/* --- Tool: available_dates ------------------------------------------------ */

server.registerTool(
  "available_dates",
  {
    description:
      "List which dates have recorded activity in Doppel's memory. Returns dates with episode counts, sorted newest first. Useful for knowing how far back memory goes and which days had the most activity.",
    inputSchema: z.object({
      limit: z.number().optional().default(30).describe("Max dates to return (default 30)"),
    }),
  },
  async ({ limit }) => {
    const episodesDir = path.join(BRAIN_DIR, "episodes");
    if (!fs.existsSync(episodesDir)) {
      return { content: [{ type: "text", text: "No episodes recorded yet." }] };
    }

    const files = fs.readdirSync(episodesDir)
      .filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"))
      .sort()
      .reverse();

    const dates = [];
    for (const file of files) {
      if (dates.length >= (limit ?? 30)) break;
      const date = file.replace(/\.(jsonl|json)$/, "");
      const fp = path.join(episodesDir, file);
      let count = 0;
      try {
        if (file.endsWith(".jsonl")) {
          count = fs.readFileSync(fp, "utf8").split("\n").filter((l) => l.trim()).length;
        } else {
          const arr = JSON.parse(fs.readFileSync(fp, "utf8"));
          count = Array.isArray(arr) ? arr.length : 0;
        }
      } catch { /* skip */ }
      if (count > 0) dates.push({ date, episodes: count });
    }

    if (dates.length === 0) {
      return { content: [{ type: "text", text: "No episodes recorded yet." }] };
    }

    const lines = dates.map((d) => `${d.date}: ${d.episodes} observations`);
    const total = dates.reduce((s, d) => s + d.episodes, 0);
    return {
      content: [{ type: "text", text: `## Recorded dates (${dates.length} days, ${total} total observations)\n${lines.join("\n")}` }],
    };
  },
);

/* --- Tool: focused_recall ------------------------------------------------ */

server.registerTool(
  "focused_recall",
  {
    description:
      "Search Doppel's memory with filters — narrow by time range, app, or entity. More precise than `recall` when you know what you're looking for. Returns matching episodes chronologically.",
    inputSchema: z.object({
      query: z.string().optional().describe("Text to search for (optional if filtering by app/date)"),
      app: z.string().optional().describe("Filter to a specific app (e.g. 'VS Code', 'Chrome', 'Excel')"),
      after: z.string().optional().describe("Only episodes after this date (YYYY-MM-DD)"),
      before: z.string().optional().describe("Only episodes before this date (YYYY-MM-DD)"),
      limit: z.number().optional().default(20).describe("Max results (default 20, max 100)"),
    }),
  },
  async ({ query, app, after, before, limit }) => {
    const n = Math.min(Math.max(1, limit ?? 20), 100);
    const afterMs = after ? new Date(after + "T00:00:00").getTime() : 0;
    const beforeMs = before ? new Date(before + "T23:59:59").getTime() : Infinity;

    /* If we have a query, start with search results; otherwise load raw episodes. */
    let candidates;
    if (query) {
      const results = await search(query, n * 3);
      candidates = results.episodes;
    } else {
      candidates = readEpisodes(500);
    }

    /* Apply filters. */
    let filtered = candidates.filter((ep) => {
      if (ep.at < afterMs || ep.at > beforeMs) return false;
      if (app && ep.app && !ep.app.toLowerCase().includes(app.toLowerCase())) return false;
      return true;
    });

    filtered = filtered.slice(0, n);

    if (filtered.length === 0) {
      const filters = [query && `query="${query}"`, app && `app="${app}"`, after && `after=${after}`, before && `before=${before}`].filter(Boolean).join(", ");
      return { content: [{ type: "text", text: `No episodes match those filters (${filters}).` }] };
    }

    /* Sort chronologically for readability. */
    filtered.sort((a, b) => a.at - b.at);
    const lines = filtered.map(formatEpisode);
    return {
      content: [{ type: "text", text: `## ${filtered.length} matching episodes\n${lines.join("\n")}` }],
    };
  },
);

/* --- Tool: episode_timeline ---------------------------------------------- */

server.registerTool(
  "episode_timeline",
  {
    description:
      "Get a chronological timeline of activity for a date range, optionally grouped by app. Great for reconstructing what the user did across a morning, a day, or a week.",
    inputSchema: z.object({
      from: z.string().describe("Start date (YYYY-MM-DD)"),
      to: z.string().optional().describe("End date (YYYY-MM-DD, defaults to same as from)"),
      groupByApp: z.boolean().optional().default(false).describe("Group episodes by app instead of chronological"),
    }),
  },
  async ({ from, to, groupByApp }) => {
    const startDate = from;
    const endDate = to || from;

    /* Collect episodes across the date range. */
    const allEpisodes = [];
    const current = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T23:59:59");

    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);
      allEpisodes.push(...readEpisodesForDate(dateStr));
      current.setDate(current.getDate() + 1);
    }

    if (allEpisodes.length === 0) {
      return { content: [{ type: "text", text: `No activity recorded between ${startDate} and ${endDate}.` }] };
    }

    allEpisodes.sort((a, b) => a.at - b.at);
    const apps = [...new Set(allEpisodes.map((e) => e.app).filter(Boolean))];

    const parts = [`## Timeline: ${startDate}${endDate !== startDate ? ` to ${endDate}` : ""}`];
    parts.push(`${allEpisodes.length} observations across ${apps.length} apps (${apps.join(", ")})`);

    if (groupByApp) {
      for (const appName of apps) {
        const appEps = allEpisodes.filter((e) => e.app === appName);
        parts.push(`\n### ${appName} (${appEps.length})`);
        /* Show up to 15 per app to avoid overwhelming output. */
        const shown = appEps.slice(0, 15);
        parts.push(shown.map(formatEpisode).join("\n"));
        if (appEps.length > 15) parts.push(`  ... and ${appEps.length - 15} more`);
      }
    } else {
      /* Chronological — cap at 60 for readability, show first/last with gap. */
      if (allEpisodes.length <= 60) {
        parts.push("");
        parts.push(allEpisodes.map(formatEpisode).join("\n"));
      } else {
        parts.push("\n### First 25");
        parts.push(allEpisodes.slice(0, 25).map(formatEpisode).join("\n"));
        parts.push(`\n... ${allEpisodes.length - 50} observations omitted ...`);
        parts.push("\n### Last 25");
        parts.push(allEpisodes.slice(-25).map(formatEpisode).join("\n"));
      }
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  },
);

/* --- Tool: morning_brief ------------------------------------------------- */

server.registerTool(
  "morning_brief",
  {
    description:
      "Get or generate a morning brief — a concise daily digest of what happened, what's open, and what to focus on. If a pre-generated brief exists for the date, returns it. Otherwise synthesizes one from recent activity using Claude. Requires an Anthropic API key for synthesis.",
    inputSchema: z.object({
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
    }),
  },
  async ({ date }) => {
    const target = date || new Date().toISOString().slice(0, 10);

    /* Check for a pre-generated brief from the main app. */
    const briefFile = path.join(BRAIN_DIR, "briefs", `${target}.json`);
    if (fs.existsSync(briefFile)) {
      try {
        const brief = JSON.parse(fs.readFileSync(briefFile, "utf8"));
        const parts = [`## Morning Brief — ${target}`];
        if (brief.greeting) parts.push(brief.greeting);
        if (brief.yesterday) parts.push(`\n**Yesterday:** ${brief.yesterday}`);
        if (brief.patterns?.length) parts.push(`\n**Patterns:**\n${brief.patterns.map((p) => `- ${p}`).join("\n")}`);
        if (brief.connections?.length) parts.push(`\n**Connections:**\n${brief.connections.map((c) => `- ${c}`).join("\n")}`);
        if (brief.openThreads?.length) parts.push(`\n**Open threads:**\n${brief.openThreads.map((t) => `- ${t}`).join("\n")}`);
        if (brief.suggestion) parts.push(`\n**Suggestion:** ${brief.suggestion}`);
        return { content: [{ type: "text", text: parts.join("\n") }] };
      } catch { /* fall through to synthesis */ }
    }

    /* Synthesize from available data. */
    const eps = readEpisodesForDate(target);
    const digests = readDigests(5);
    const entities = readEntities().slice(0, 20);

    if (eps.length === 0 && digests.length === 0) {
      return { content: [{ type: "text", text: `No data available for ${target} to generate a brief.` }] };
    }

    const contextParts = [];
    if (eps.length > 0) {
      const apps = [...new Set(eps.map((e) => e.app).filter(Boolean))];
      contextParts.push(`ACTIVITY (${eps.length} observations, apps: ${apps.join(", ")}):`);
      /* Sample episodes: first 10 + last 10 if many */
      const sample = eps.length <= 20 ? eps : [...eps.slice(0, 10), ...eps.slice(-10)];
      contextParts.push(sample.map(formatEpisode).join("\n"));
    }
    if (digests.length > 0) {
      contextParts.push(`\nRECENT DIGESTS:\n${digests.map(formatDigest).join("\n")}`);
    }
    if (entities.length > 0) {
      contextParts.push(`\nKEY ENTITIES:\n${entities.map(formatEntity).join("\n")}`);
    }

    const answer = await askClaude(
      "You are Doppel, a personal AI that watches the user work and remembers everything. Generate a concise morning brief. Include: a short greeting, what they did (yesterday/recently), any patterns you notice, open threads (things that seem unfinished), and one suggestion. Keep it warm but brief — under 200 words.",
      `Generate a morning brief for ${target}.\n\n${contextParts.join("\n")}`,
    );

    if (!answer) {
      /* No API — return raw summary instead. */
      const parts = [`## Brief for ${target} (raw data, no API key)`];
      if (eps.length > 0) {
        const apps = [...new Set(eps.map((e) => e.app).filter(Boolean))];
        parts.push(`${eps.length} observations across ${apps.join(", ")}`);
        parts.push(eps.slice(0, 10).map(formatEpisode).join("\n"));
      }
      return { content: [{ type: "text", text: parts.join("\n") }] };
    }

    return {
      content: [{ type: "text", text: `## Morning Brief — ${target}\n\n${answer}` }],
    };
  },
);

/* --- Tool: about_user ---------------------------------------------------- */

server.registerTool(
  "about_user",
  {
    description:
      "Get a high-level summary of what Doppel knows about the user — how long it has been watching, how much it has seen, top apps, key people and projects. This is the tool to call first when connecting to a new user's Doppel to understand who they are.",
    inputSchema: z.object({}),
  },
  async () => {
    const entities = readEntities();
    const episodes = readEpisodes(500);
    const digests = readDigests(10);

    const parts = ["## What Doppel knows about this user"];

    /* History span. */
    if (episodes.length > 0) {
      const oldest = episodes[episodes.length - 1];
      const newest = episodes[0];
      const oldDate = new Date(oldest.at).toLocaleDateString();
      const newDate = new Date(newest.at).toLocaleDateString();
      const days = Math.ceil((newest.at - oldest.at) / 86_400_000) || 1;
      parts.push(`\n**Memory span:** ${oldDate} → ${newDate} (${days} day${days > 1 ? "s" : ""})`);
    }

    /* Counts. */
    const episodesDir = path.join(BRAIN_DIR, "episodes");
    let totalEpisodes = 0;
    let dateFileCount = 0;
    if (fs.existsSync(episodesDir)) {
      const files = fs.readdirSync(episodesDir).filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"));
      dateFileCount = files.length;
      for (const file of files) {
        try {
          if (file.endsWith(".jsonl")) {
            totalEpisodes += fs.readFileSync(path.join(episodesDir, file), "utf8").split("\n").filter((l) => l.trim()).length;
          } else {
            const arr = JSON.parse(fs.readFileSync(path.join(episodesDir, file), "utf8"));
            totalEpisodes += Array.isArray(arr) ? arr.length : 0;
          }
        } catch { /* skip */ }
      }
    }

    parts.push(`**Total observations:** ${totalEpisodes} across ${dateFileCount} days`);
    parts.push(`**Entities learned:** ${entities.length}`);
    parts.push(`**Digests:** ${digests.length}`);
    parts.push(`**Vectors:** ${vectorCount} (semantic search ${vectorCount > 0 ? "available" : "not yet built"})`);

    /* Top apps. */
    if (episodes.length > 0) {
      const appCounts = {};
      for (const ep of episodes) {
        if (ep.app) appCounts[ep.app] = (appCounts[ep.app] || 0) + 1;
      }
      const topApps = Object.entries(appCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (topApps.length > 0) {
        parts.push(`\n**Top apps:** ${topApps.map(([app, n]) => `${app} (${n})`).join(", ")}`);
      }
    }

    /* Entities by type. */
    if (entities.length > 0) {
      const byType = {};
      for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;
      const typeLine = Object.entries(byType).map(([t, n]) => `${n} ${t}${n > 1 ? "s" : ""}`).join(", ");
      parts.push(`**Entity breakdown:** ${typeLine}`);

      const people = entities.filter((e) => e.type === "person").slice(0, 5);
      if (people.length > 0) {
        parts.push(`\n**Key people:** ${people.map((p) => `${p.id}${p.summary ? ` — ${p.summary}` : ""}`).join("; ")}`);
      }
      const projects = entities.filter((e) => e.type === "project").slice(0, 5);
      if (projects.length > 0) {
        parts.push(`**Projects:** ${projects.map((p) => `${p.id}${p.summary ? ` — ${p.summary}` : ""}`).join("; ")}`);
      }
    }

    /* Recent digest as flavor text. */
    if (digests.length > 0) {
      parts.push(`\n**Latest digest:** ${formatDigest(digests[0])}`);
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  },
);

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  INBOX TOOLS — task queue between user and external agents                */
/* ═══════════════════════════════════════════════════════════════════════════ */

/* --- Tool: check_inbox --------------------------------------------------- */

server.registerTool(
  "check_inbox",
  {
    description:
      "Check for tasks the user has queued for you. Returns tasks with status 'approved' — these are ready for you to work on. Call `claim_task` to claim one before starting work, then `report_result` when done. Poll this periodically to pick up new tasks.",
    inputSchema: z.object({
      agent: z.string().optional().describe("Your name (e.g. 'Claude Desktop', 'Cursor'). If provided, only shows tasks directed at you or at 'any' agent."),
    }),
  },
  async ({ agent }) => {
    let tasks = readInbox().filter((t) => t.status === "approved");
    if (agent) {
      const a = agent.toLowerCase();
      tasks = tasks.filter((t) => !t.target || t.target === "any" || t.target.toLowerCase() === a);
    }
    if (tasks.length === 0) {
      return { content: [{ type: "text", text: "No tasks waiting. The user hasn't queued anything for you yet." }] };
    }
    const lines = tasks.map((t) => {
      const dir = t.target && t.target !== "any" ? ` [for ${t.target}]` : "";
      return `**${t.id}**: ${t.instruction}${dir} (created ${new Date(t.createdAt).toLocaleString()})`;
    });
    return {
      content: [{ type: "text", text: `## ${tasks.length} task${tasks.length > 1 ? "s" : ""} waiting\n${lines.join("\n\n")}` }],
    };
  },
);

/* --- Tool: claim_task ---------------------------------------------------- */

server.registerTool(
  "claim_task",
  {
    description:
      "Claim an inbox task so you can work on it. This marks it as 'claimed' so other agents don't pick it up. You must claim a task before starting work. Get task IDs from `check_inbox`.",
    inputSchema: z.object({
      taskId: z.string().describe("The task ID to claim"),
      agent: z.string().optional().describe("Your name (e.g. 'Claude Desktop', 'Cursor', 'ChatGPT'). Helps the user see who's working on what."),
    }),
  },
  async ({ taskId, agent }) => {
    const tasks = readInbox();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return { content: [{ type: "text", text: `Task ${taskId} not found.` }] };
    }
    if (task.status !== "approved") {
      return { content: [{ type: "text", text: `Task ${taskId} is ${task.status} — only approved tasks can be claimed.` }] };
    }
    task.status = "claimed";
    task.agent = agent || "unknown";
    task.claimedAt = Date.now();
    writeInbox(tasks);
    return {
      content: [{ type: "text", text: `Claimed. Here's what to do:\n\n${task.instruction}\n\nWhen done, call \`report_result\` with task ID "${task.id}".` }],
    };
  },
);

/* --- Tool: report_result ------------------------------------------------- */

server.registerTool(
  "report_result",
  {
    description:
      "Report the result of a task you claimed from the inbox. The user will see this in Doppel's UI.",
    inputSchema: z.object({
      taskId: z.string().describe("The task ID you're reporting on"),
      result: z.string().describe("What you did / the answer / the outcome"),
      success: z.boolean().optional().default(true).describe("Whether the task succeeded (default true)"),
    }),
  },
  async ({ taskId, result, success }) => {
    const tasks = readInbox();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return { content: [{ type: "text", text: `Task ${taskId} not found.` }] };
    }
    if (task.status !== "claimed") {
      return { content: [{ type: "text", text: `Task ${taskId} is ${task.status} — only claimed tasks can be reported on.` }] };
    }
    task.status = (success ?? true) ? "done" : "failed";
    task.result = result;
    task.completedAt = Date.now();
    writeInbox(tasks);

    /* Also store the result in Doppel's brain so it's searchable. */
    writeEpisode({
      id: `inbox-${task.id}-result`,
      at: Date.now(),
      kind: "external",
      app: "mcp",
      window: null,
      activity: `Task completed: ${task.instruction.slice(0, 100)}`,
      intent: `Result reported by ${task.agent || "external agent"}`,
      detail: result.slice(0, 1000),
      location: null,
      changed: "",
      fragments: [{ kind: "text", what: "task-result", value: result.slice(0, 400) }],
      salience: 0.7,
      sensitive: false,
      boundary: "none",
    });

    return {
      content: [{ type: "text", text: `Reported. The user will see your result in Doppel.` }],
    };
  },
);

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  RESOURCES                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

server.registerResource(
  "brain_stats",
  "doppel://brain/stats",
  { description: "Doppel brain statistics — episode count, entity count, vector count, storage size" },
  async (uri) => {
    const entities = readEntities();
    const digests = readDigests(1000);

    /* Count episodes across all date files */
    const episodesDir = path.join(BRAIN_DIR, "episodes");
    let totalEpisodes = 0;
    if (fs.existsSync(episodesDir)) {
      for (const file of fs.readdirSync(episodesDir)) {
        const fp = path.join(episodesDir, file);
        try {
          if (file.endsWith(".jsonl")) {
            totalEpisodes += fs.readFileSync(fp, "utf8").split("\n").filter((l) => l.trim()).length;
          } else if (file.endsWith(".json")) {
            const arr = JSON.parse(fs.readFileSync(fp, "utf8"));
            totalEpisodes += Array.isArray(arr) ? arr.length : 0;
          }
        } catch { /* skip */ }
      }
    }

    /* Vector store size */
    const vecFile = path.join(BRAIN_DIR, "vectors", "vectors.bin");
    let vecBytes = 0;
    try { vecBytes = fs.statSync(vecFile).size; } catch { /* ok */ }

    const stats = {
      episodes: totalEpisodes,
      entities: entities.length,
      digests: digests.length,
      vectors: vectorCount,
      vectorStorageBytes: vecBytes,
      embeddingModel: embeddingModel ? "loaded" : embeddingUnavailable ? "unavailable" : "loading",
    };

    return {
      contents: [{ uri: uri.href, text: JSON.stringify(stats, null, 2), mimeType: "application/json" }],
    };
  },
);

server.registerResource(
  "brain_entities",
  "doppel://brain/entities",
  { description: "All entities (people, apps, projects, files) Doppel has learned about, as JSON" },
  async (uri) => {
    const entities = readEntities();
    return {
      contents: [{ uri: uri.href, text: JSON.stringify(entities, null, 2), mimeType: "application/json" }],
    };
  },
);

server.registerResource(
  "activity_today",
  "doppel://activity/today",
  { description: "Full activity log for today — all observations Doppel has recorded" },
  async (uri) => {
    const today = new Date().toISOString().slice(0, 10);
    const eps = readEpisodesForDate(today);

    if (eps.length === 0) {
      return {
        contents: [{ uri: uri.href, text: "No observations recorded today yet.", mimeType: "text/plain" }],
      };
    }

    const lines = eps.map(formatEpisode);
    const apps = [...new Set(eps.map((e) => e.app).filter(Boolean))];
    const text = `Today (${today}): ${eps.length} observations across ${apps.length} apps (${apps.join(", ")})\n\n${lines.join("\n")}`;

    return {
      contents: [{ uri: uri.href, text, mimeType: "text/plain" }],
    };
  },
);

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PROMPTS                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

server.registerPrompt(
  "daily-review",
  {
    description: "Review what the user did today — summarize activity, highlight key tasks, note patterns",
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Using Doppel's memory tools, give me a review of what I did today. Call the `daily_summary` tool for today's date, then the `patterns` tool, and synthesize a clear summary of my day: what I worked on, how long I spent in each area, any notable patterns, and what I might want to pick up tomorrow.",
          },
        },
      ],
    };
  },
);

server.registerPrompt(
  "project-context",
  {
    description: "Get full context about a specific project, topic, or person from Doppel's memory",
    argsSchema: z.object({
      topic: z.string().describe("The project, topic, or person to look up"),
    }),
  },
  async ({ topic }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Using Doppel's memory tools, tell me everything you can find about "${topic}". Use the \`recall\` tool to search for it, the \`known_entities\` tool to check if it's a known entity, and the \`ask\` tool to synthesize a comprehensive overview. I want to know: when I last interacted with it, what I was doing, any relevant people or apps involved, and any patterns.`,
          },
        },
      ],
    };
  },
);

server.registerPrompt(
  "work-patterns",
  {
    description: "Analyze the user's work habits and routines based on Doppel's observations",
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Using Doppel's memory tools, analyze my work patterns and habits. Call the `patterns` tool, `recent_activity` with limit 50, and `known_entities` for apps. Give me insights about: my most productive times, apps I switch between most, tasks I repeat often, and any suggestions for improving my workflow.",
          },
        },
      ],
    };
  },
);

/* -------------------------------------------------------------------------- */
/*  Start                                                                     */
/* -------------------------------------------------------------------------- */

const MCP_PORT = Number(process.env.DOPPEL_MCP_PORT ?? 4320);
const httpMode = process.argv.includes("--http");

async function main() {
  loadVectors();
  loadEmbeddingModel().catch(() => {});

  if (httpMode) {
    /* ---- Streamable HTTP mode ---- */
    const http = require("node:http");
    const { randomUUID } = require("node:crypto");
    const { StreamableHTTPServerTransport } = require(
      require("node:path").join(
        __dirname, "..", "node_modules", "@modelcontextprotocol", "sdk",
        "dist", "cjs", "server", "streamableHttp.js",
      ),
    );

    /* One transport per session, keyed by session ID. */
    const sessions = new Map();

    const httpServer = http.createServer(async (req, res) => {
      /* CORS — needed for browser-based connectors */
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      /* Only serve the /mcp path */
      const url = new URL(req.url, `http://localhost:${MCP_PORT}`);
      if (url.pathname !== "/mcp") {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not found. MCP endpoint is /mcp" }));
        return;
      }

      const sessionId = req.headers["mcp-session-id"];

      if (sessionId && sessions.has(sessionId)) {
        /* Existing session — route to its transport */
        const transport = sessions.get(sessionId);
        await transport.handleRequest(req, res);
      } else if (!sessionId && req.method === "POST") {
        /* New session — initialize */
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        /* handleRequest will set the session header in the response */
        await transport.handleRequest(req, res);
        if (transport.sessionId) sessions.set(transport.sessionId, transport);
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Bad request — missing or invalid session" }));
      }
    });

    httpServer.listen(MCP_PORT, "127.0.0.1", () => {
      console.error(`[doppel-mcp] HTTP server running at http://127.0.0.1:${MCP_PORT}/mcp`);
      console.error(`[doppel-mcp] Brain: ${BRAIN_DIR}`);
    });
  } else {
    /* ---- Stdio mode (default) ---- */
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[doppel-mcp] Server running (v3.0.0). Brain: ${BRAIN_DIR}`);
    console.error(`[doppel-mcp] Tools: recall, ask, remember, screen_now, recent_activity, known_entities, user_context, patterns, daily_summary, available_dates, focused_recall, episode_timeline, morning_brief, about_user, check_inbox, claim_task, report_result`);
    console.error(`[doppel-mcp] Resources: doppel://brain/stats, doppel://brain/entities, doppel://activity/today`);
    console.error(`[doppel-mcp] Prompts: daily-review, project-context, work-patterns`);
  }
}

main().catch((err) => {
  console.error("[doppel-mcp] Fatal:", err);
  process.exit(1);
});
