const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

/* Lazy-loaded to avoid circular dependency — vault.init needs db.paths. */
let vault = null;
function getVault() {
  if (!vault) vault = require("./vault");
  return vault;
}

/**
 * Doppel's memory. A single JSON document written atomically to the user's
 * application data folder — no server, no database, nothing leaves the machine.
 *
 * There is deliberately no seed data. A fresh install knows nothing and has to
 * earn everything it knows by watching.
 */

const STATE_VERSION = 3;

let dir = null;
let file = null;
let state = null;
let writeTimer = null;
const listeners = new Set();

function home(...parts) {
  return path.join(os.homedir(), ...parts);
}

/** Folders Doppel watches out of the box. All inside the user's own home. */
function defaultRoots() {
  return [home("Downloads"), home("Desktop"), home("Documents")].filter((p) =>
    fs.existsSync(p),
  );
}

function emptyState() {
  return {
    version: STATE_VERSION,
    createdAt: Date.now(),

    observation: {
      paused: false,
      /** Folders Doppel may watch and act within. Nothing outside these is touched. */
      roots: defaultRoots(),
      /** Which display to watch. Null = primary. */
      displayId: null,
    },

    permissions: {
      /* --- what it may watch --- */
      windows: true,
      files: true,
      clipboard: false,
      /** Read the screen with a vision model. The big one; off until asked for. */
      screen: false,

      /* --- what it may do --- */
      actFiles: true,
      actWrite: true,
      actTrash: false,
      /** Open applications and documents. */
      actLaunch: true,
      /** Drive any application: pointer, keyboard, keys. Covers everything else. */
      actGui: false,
    },

    /** Where the intelligence comes from. The key never leaves this machine. */
    ai: {
      apiKey: "",
      verified: false,
      lastError: null,
      /** Look at the screen automatically, or only when asked. */
      autoWatch: true,
      /**
       * How closely to read a screen.
       *   light     a bigger picture, cheaper, ~1366px
       *   thorough  every word, number and control it can make out, ~2200px
       */
      detail: "thorough",
      /** OpenAI key for Whisper transcription. */
      openaiKey: "",
      /** TypeSafe key for Jev (System One model — powers computer bots). */
      typesafeKey: "",
    },

    /** The little presence in the corner. */
    overlay: {
      enabled: true,
      position: null,
    },

    /** The voice hotkey panel. */
    whisper: {
      enabled: true,
      hotkey: "CommandOrControl+Shift+Space",
      position: null,
      autoDismiss: 0,
      micSensitivity: 80,
    },

    /** Proactive suggestions surfaced by the nudge system. */
    nudges: {
      enabled: true,
    },

    /**
     * Identity. The token is this machine's own credential and never crosses
     * to the interface. Nothing about the trained agent lives here — that is
     * the whole point of the split.
     */
    account: {
      server: "http://127.0.0.1:4319",
      token: "",
      accountId: null,
      email: null,
      deviceId: null,
      deviceName: "",
      pairedAt: null,
      pendingEmail: null,
      lastError: null,
    },

    /** Raw observations, capped. This is the evidence everything else derives from. */
    events: [],

    /** What Doppel has said about what it's seeing, newest first. */
    narration: [],

    entities: [],

    devices: [],
    stats: { eventsSeen: 0, sessionsSeen: 0, looks: 0, visionTokens: 0, lastRunAt: 0 },

    /** Installed add-ons and their configuration. */
    addons: { installed: {} },

    /** Security — biometric lock, etc. */
    security: {
      /** Require Windows Hello to unlock Doppel. */
      biometric: false,
      /** Minutes of inactivity before re-locking. 0 = session only. */
      lockTimeout: 0,
    },

    /** API usage metering — accumulated per calendar month. */
    usage: {
      current: { month: "", inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, calls: 0 },
      months: {},
    },

    /** Token economy — plan, balance, daily usage. */
    billing: {
      plan: "free",
      tokenBalance: 0,
      dailyUsed: 0,
      dailyDate: "",
      totalSpent: 0,
      history: [],
    },
  };
}

function migrate(loaded) {
  const base = emptyState();
  if (!loaded || typeof loaded !== "object") return base;
  if (loaded.version !== STATE_VERSION) {
    // Older shapes are not worth carrying forward wholesale, but the two
    // things a person would be genuinely annoyed to re-enter are their watched
    // folders and their API key.
    return {
      ...base,
      observation: { ...base.observation, ...(loaded.observation ?? {}) },
      permissions: { ...base.permissions, ...(loaded.permissions ?? {}) },
      ai: { ...base.ai, ...(loaded.ai ?? {}) },
      overlay: { ...base.overlay, ...(loaded.overlay ?? {}) },
      whisper: { ...base.whisper, ...(loaded.whisper ?? {}) },
      nudges: { ...base.nudges, ...(loaded.nudges ?? {}) },
      account: { ...base.account, ...(loaded.account ?? {}) },
      addons: { ...base.addons, ...(loaded.addons ?? {}) },
      security: { ...base.security, ...(loaded.security ?? {}) },
      usage: { ...base.usage, ...(loaded.usage ?? {}) },
      billing: { ...base.billing, ...(loaded.billing ?? {}) },
    };
  }
  return {
    ...base,
    ...loaded,
    permissions: { ...base.permissions, ...loaded.permissions },
    ai: { ...base.ai, ...(loaded.ai ?? {}) },
    overlay: { ...base.overlay, ...(loaded.overlay ?? {}) },
    whisper: { ...base.whisper, ...(loaded.whisper ?? {}) },
    nudges: { ...base.nudges, ...(loaded.nudges ?? {}) },
    account: { ...base.account, ...(loaded.account ?? {}) },
    stats: { ...base.stats, ...(loaded.stats ?? {}) },
    addons: { ...base.addons, ...(loaded.addons ?? {}) },
    security: { ...base.security, ...(loaded.security ?? {}) },
    usage: { ...base.usage, ...(loaded.usage ?? {}) },
    billing: { ...base.billing, ...(loaded.billing ?? {}) },
  };
}

function init() {
  dir = app.getPath("userData");
  file = path.join(dir, "doppel-state.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "trash"), { recursive: true });

  /* Initialise the vault for encrypting secrets and brain data. */
  const v = getVault();
  if (!v.ready()) v.init(dir);

  try {
    state = migrate(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    state = emptyState();
  }

  /* Migrate plaintext API keys to encrypted storage. A key that isn't
     empty and isn't already a base64 safeStorage blob gets encrypted
     in place on first read after the update. */
  migrateSecrets(state);

  return state;
}

function migrateSecrets(s) {
  const v = getVault();
  if (!s.ai) return;

  /* API key — encrypt if it looks like plaintext (Gemini keys start with "AI",
     old Anthropic keys start with "sk-"). */
  if (s.ai.apiKey && (s.ai.apiKey.startsWith("AI") || s.ai.apiKey.startsWith("sk-"))) {
    s.ai.apiKey = v.encryptSecret(s.ai.apiKey);
    schedule(); // persist the encrypted version
  }

  /* OpenAI key — starts with "sk-" when plaintext. */
  if (s.ai.openaiKey && s.ai.openaiKey.startsWith("sk-")) {
    s.ai.openaiKey = v.encryptSecret(s.ai.openaiKey);
    schedule();
  }

  /* TypeSafe key — starts with "ts_" when plaintext. */
  if (s.ai.typesafeKey && s.ai.typesafeKey.startsWith("ts_")) {
    s.ai.typesafeKey = v.encryptSecret(s.ai.typesafeKey);
    schedule();
  }
}

/**
 * Decrypt the API key (Gemini). Never read `state.ai.apiKey` directly
 * from outside db.js — use this instead.
 */
function apiKey() {
  const raw = get().ai?.apiKey ?? "";
  if (!raw) return "";
  return getVault().decryptSecret(raw);
}

/**
 * Decrypt the OpenAI API key.
 */
function openaiKey() {
  const raw = get().ai?.openaiKey ?? "";
  if (!raw) return "";
  return getVault().decryptSecret(raw);
}

/**
 * Decrypt the TypeSafe API key (Jev).
 */
function typesafeKey() {
  const raw = get().ai?.typesafeKey ?? "";
  if (!raw) return "";
  return getVault().decryptSecret(raw);
}

function get() {
  if (!state) init();
  return state;
}

/** Atomic write, debounced — this file is touched on every observation. */
function flush() {
  if (!state) return;
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state), "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error("[doppel] could not save state:", err.message);
  }
}

function schedule() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush();
  }, 400);
}

/**
 * Mutate and notify. `mutator` receives the live state and may change it in
 * place; anything it returns is ignored.
 */
function update(mutator, { silent = false } = {}) {
  const s = get();
  mutator(s);
  schedule();
  if (!silent) notify();
  return s;
}

function notify() {
  const snapshot = publicState();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error("[doppel] listener failed:", err.message);
    }
  }
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * What the interface is allowed to see. The raw event journal is huge and
 * mostly noise, so only the tail travels.
 */
function publicState() {
  const s = get();
  const key = apiKey();
  const oaiKey = openaiKey();
  return {
    version: s.version,
    createdAt: s.createdAt,
    observation: s.observation,
    permissions: s.permissions,
    /* The key itself never crosses to the renderer — only enough to show
       which one is in use. */
    ai: {
      configured: Boolean(key || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      fromEnvironment: !key && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      verified: Boolean(s.ai?.verified),
      lastError: s.ai?.lastError ?? null,
      autoWatch: s.ai?.autoWatch !== false,
      detail: s.ai?.detail === "light" ? "light" : "thorough",
      hint: key ? `…${key.slice(-6)}` : "",
      openaiConfigured: Boolean(oaiKey || process.env.OPENAI_API_KEY),
      openaiHint: oaiKey ? `…${oaiKey.slice(-6)}` : "",
      typesafeConfigured: Boolean(typesafeKey() || process.env.TYPESAFE_API_KEY),
      typesafeHint: typesafeKey() ? `…${typesafeKey().slice(-6)}` : "",
    },
    overlay: s.overlay,
    whisper: s.whisper,
    nudgeSettings: s.nudges,
    /* Identity, minus the credential itself. */
    account: {
      signedIn: Boolean(s.account?.token),
      email: s.account?.email ?? null,
      accountId: s.account?.accountId ?? null,
      deviceId: s.account?.deviceId ?? null,
      deviceName: s.account?.deviceName ?? "",
      pairedAt: s.account?.pairedAt ?? null,
      pendingEmail: s.account?.pendingEmail ?? null,
      lastError: s.account?.lastError ?? null,
      server: s.account?.server ?? "",
    },
    entities: s.entities,
    devices: s.devices,
    stats: s.stats,
    addons: s.addons ?? { installed: {} },
    security: {
      biometric: Boolean(s.security?.biometric),
      lockTimeout: s.security?.lockTimeout ?? 0,
    },
    usage: s.usage,
    billing: {
      plan: s.billing?.plan ?? "free",
      tokenBalance: s.billing?.tokenBalance ?? 0,
      dailyUsed: s.billing?.dailyUsed ?? 0,
      dailyDate: s.billing?.dailyDate ?? "",
      totalSpent: s.billing?.totalSpent ?? 0,
    },
    narration: (s.narration ?? []).slice(0, 40),
    recentEvents: s.events.slice(-40).reverse(),
    inbox: readInbox(),
    workflows: readWorkflows(),
  };
}

function readInbox() {
  try {
    const inboxFile = path.join(dir ?? app.getPath("userData"), "inbox.json");
    const raw = JSON.parse(fs.readFileSync(inboxFile, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function readWorkflows() {
  try {
    const wfFile = path.join(dir ?? app.getPath("userData"), "workflows.json");
    const raw = JSON.parse(fs.readFileSync(wfFile, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function reset() {
  state = emptyState();
  flush();
  notify();
  return state;
}

const paths = {
  get dir() {
    return dir ?? app.getPath("userData");
  },
  get trash() {
    return path.join(paths.dir, "trash");
  },
  get stateFile() {
    return file;
  },
};

module.exports = {
  init,
  get,
  update,
  subscribe,
  notify,
  publicState,
  reset,
  flush,
  defaultRoots,
  paths,
  apiKey,
  openaiKey,
  typesafeKey,
  STATE_VERSION,
};
