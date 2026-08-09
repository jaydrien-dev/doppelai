const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

/**
 * Mimic's memory. A single JSON document written atomically to the user's
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

/** Folders Mimic watches out of the box. All inside the user's own home. */
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
      /** Folders Mimic may watch and act within. Nothing outside these is touched. */
      roots: defaultRoots(),
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
    },

    /** The little presence in the corner. */
    overlay: {
      enabled: true,
      position: null,
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

    /** What Mimic has said about what it's seeing, newest first. */
    narration: [],

    routines: [],
    runs: [],
    entities: [],
    jobs: [],

    away: {
      active: false,
      grantedAt: 0,
      expiresAt: 0,
      routineIds: [],
      actionCap: 12,
      actionsUsed: 0,
      keepAlive: true,
    },

    devices: [],
    stats: { eventsSeen: 0, sessionsSeen: 0, looks: 0, visionTokens: 0 },
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
      account: { ...base.account, ...(loaded.account ?? {}) },
    };
  }
  return {
    ...base,
    ...loaded,
    permissions: { ...base.permissions, ...loaded.permissions },
    ai: { ...base.ai, ...(loaded.ai ?? {}) },
    overlay: { ...base.overlay, ...(loaded.overlay ?? {}) },
    account: { ...base.account, ...(loaded.account ?? {}) },
    stats: { ...base.stats, ...(loaded.stats ?? {}) },
  };
}

function init() {
  dir = app.getPath("userData");
  file = path.join(dir, "mimic-state.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "trash"), { recursive: true });

  try {
    state = migrate(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    state = emptyState();
  }
  return state;
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
    console.error("[mimic] could not save state:", err.message);
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
      console.error("[mimic] listener failed:", err.message);
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
  const key = s.ai?.apiKey ?? "";
  return {
    version: s.version,
    createdAt: s.createdAt,
    observation: s.observation,
    permissions: s.permissions,
    /* The key itself never crosses to the renderer — only enough to show
       which one is in use. */
    ai: {
      configured: Boolean(key || process.env.ANTHROPIC_API_KEY),
      fromEnvironment: !key && Boolean(process.env.ANTHROPIC_API_KEY),
      verified: Boolean(s.ai?.verified),
      lastError: s.ai?.lastError ?? null,
      autoWatch: s.ai?.autoWatch !== false,
      detail: s.ai?.detail === "light" ? "light" : "thorough",
      hint: key ? `…${key.slice(-6)}` : "",
    },
    overlay: s.overlay,
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
    routines: s.routines,
    runs: s.runs.slice(0, 200),
    entities: s.entities,
    jobs: s.jobs,
    away: s.away,
    devices: s.devices,
    stats: s.stats,
    narration: (s.narration ?? []).slice(0, 40),
    recentEvents: s.events.slice(-40).reverse(),
  };
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
  STATE_VERSION,
};
