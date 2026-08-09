const fs = require("node:fs");
const path = require("node:path");
const { clipboard } = require("electron");
const crypto = require("node:crypto");

const db = require("./db");
const win32 = require("./win32");

/**
 * What Mimic actually sees.
 *
 * Three sources, each behind its own permission and all behind the global
 * pause: the foreground window, changes inside the folders you've allowed, and
 * — only if you turn it on — the shape of what you copy.
 *
 * Nothing here reaches the network. Clipboard contents are never stored; only
 * a fingerprint, so a repeat can be recognised without the text being kept.
 */

const MAX_EVENTS = 6000;
const FILE_SETTLE_MS = 260;
const MOVE_WINDOW_MS = 4000;
const CLIPBOARD_POLL_MS = 1200;

const IGNORED = [
  /(^|[\\/])\.git([\\/]|$)/i,
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])\.mimic([\\/]|$)/i,
  /(^|[\\/])~\$/,
  /\.(tmp|crdownload|part|partial|swp)$/i,
  /(^|[\\/])desktop\.ini$/i,
  /(^|[\\/])thumbs\.db$/i,
];

let watchers = [];
let stopWindowWatch = null;
let clipboardTimer = null;
let lastClipHash = null;

/** Files seen disappearing recently, so a reappearance elsewhere reads as a move. */
const vanished = new Map();
const settling = new Map();

let onEvent = () => {};

/* --------------------------------------------------------------------------- */

const ignored = (p) => IGNORED.some((re) => re.test(p));

function record(event) {
  const full = {
    id: crypto.randomUUID(),
    at: Date.now(),
    ...event,
  };

  db.update(
    (s) => {
      s.events.push(full);
      if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
      s.stats.eventsSeen += 1;
    },
    { silent: true },
  );

  onEvent(full);
  return full;
}

function active() {
  const s = db.get();
  return !s.observation.paused;
}

/* ------------------------------------------------------------------ windows */

function startWindows() {
  const s = db.get();
  if (!s.permissions.windows) return;

  stopWindowWatch = win32.watchWindows(
    (w) => {
      if (!active() || !db.get().permissions.windows) return;
      record({
        kind: "window.focus",
        app: w.app,
        title: w.title,
      });
    },
    (err) => console.error("[mimic] window watcher:", err),
  );
}

/* -------------------------------------------------------------------- files */

function startFiles() {
  const s = db.get();
  if (!s.permissions.files) return;

  for (const root of s.observation.roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const w = fs.watch(root, { recursive: true }, (_type, filename) => {
        if (!filename) return;
        const full = path.join(root, String(filename));
        if (ignored(full)) return;
        queueFile(root, full);
      });
      w.on("error", (err) => console.error(`[mimic] watch ${root}:`, err.message));
      watchers.push(w);
    } catch (err) {
      console.error(`[mimic] cannot watch ${root}:`, err.message);
    }
  }
}

/**
 * Filesystem events arrive in bursts and out of order, so each path is allowed
 * to settle before it is judged. Only then can a create/delete pair on the same
 * basename be recognised for what it usually is: a move.
 */
function queueFile(root, full) {
  if (!active() || !db.get().permissions.files) return;

  clearTimeout(settling.get(full));
  settling.set(
    full,
    setTimeout(() => {
      settling.delete(full);
      judgeFile(root, full);
    }, FILE_SETTLE_MS),
  );
}

function judgeFile(root, full) {
  const name = path.basename(full);
  const exists = fs.existsSync(full);
  const now = Date.now();

  // Forget stale disappearances.
  for (const [key, entry] of vanished) {
    if (now - entry.at > MOVE_WINDOW_MS) vanished.delete(key);
  }

  if (!exists) {
    vanished.set(name, { at: now, path: full, root });
    // Held briefly: if nothing reappears, it really was a removal.
    setTimeout(() => {
      const entry = vanished.get(name);
      if (!entry || entry.path !== full) return;
      vanished.delete(name);
      record({
        kind: "file.removed",
        path: full,
        root,
        dir: path.dirname(full),
        name,
        ext: path.extname(full).toLowerCase(),
      });
    }, MOVE_WINDOW_MS);
    return;
  }

  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return;
  }
  if (stat.isDirectory()) return;

  const priorSameName = vanished.get(name);
  if (priorSameName && priorSameName.path !== full) {
    vanished.delete(name);
    record({
      kind: "file.moved",
      path: full,
      from: priorSameName.path,
      fromDir: path.dirname(priorSameName.path),
      dir: path.dirname(full),
      root,
      name,
      ext: path.extname(full).toLowerCase(),
    });
    return;
  }

  // Brand new, or simply written to.
  const fresh = now - stat.birthtimeMs < 8000;
  record({
    kind: fresh ? "file.created" : "file.changed",
    path: full,
    root,
    dir: path.dirname(full),
    name,
    ext: path.extname(full).toLowerCase(),
    size: stat.size,
  });
}

/* ---------------------------------------------------------------- clipboard */

function startClipboard() {
  if (!db.get().permissions.clipboard) return;

  clipboardTimer = setInterval(() => {
    if (!active() || !db.get().permissions.clipboard) return;
    let text = "";
    try {
      text = clipboard.readText();
    } catch {
      return;
    }
    if (!text) return;

    // Only a fingerprint is kept. The text itself is never written down.
    const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
    if (hash === lastClipHash) return;
    lastClipHash = hash;

    record({
      kind: "clip.copy",
      hash,
      length: text.length,
      shape: /^https?:\/\//i.test(text)
        ? "a link"
        : /^[\d\s.,£$€%-]+$/.test(text)
          ? "some numbers"
          : "some text",
    });
  }, CLIPBOARD_POLL_MS);
}

/* --------------------------------------------------------------------------- */

function start(handler) {
  onEvent = handler ?? (() => {});
  stop();
  startWindows();
  startFiles();
  startClipboard();
}

function stop() {
  stopWindowWatch?.();
  stopWindowWatch = null;

  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* already closed */
    }
  }
  watchers = [];

  if (clipboardTimer) clearInterval(clipboardTimer);
  clipboardTimer = null;

  for (const timer of settling.values()) clearTimeout(timer);
  settling.clear();
  vanished.clear();
}

/** Called when permissions or watched folders change. */
function restart() {
  start(onEvent);
}

module.exports = { start, stop, restart, record };
