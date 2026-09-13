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
 *   recall          — Hybrid semantic+keyword search over memory
 *   ask             — AI-powered Q&A over memory (uses Claude API)
 *   remember        — Store information into Doppel's brain from external AIs
 *   recent_activity — Last N observations
 *   screen_now      — Current screen context and what user is doing
 *   known_entities  — People, apps, projects Doppel has learned about
 *   user_context    — Full current state: app, narration, watched folders
 *   patterns        — Behavioral patterns: app usage, time distribution
 *   daily_summary   — All observations + digest for a given date
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
  version: "2.0.0",
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

async function main() {
  loadVectors();
  loadEmbeddingModel().catch(() => {});

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[doppel-mcp] Server running (v2.0.0). Brain: ${BRAIN_DIR}`);
  console.error(`[doppel-mcp] Tools: recall, ask, remember, screen_now, recent_activity, known_entities, user_context, patterns, daily_summary`);
  console.error(`[doppel-mcp] Resources: doppel://brain/stats, doppel://brain/entities, doppel://activity/today`);
  console.error(`[doppel-mcp] Prompts: daily-review, project-context, work-patterns`);
}

main().catch((err) => {
  console.error("[doppel-mcp] Fatal:", err);
  process.exit(1);
});
