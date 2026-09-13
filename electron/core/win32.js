const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

/**
 * The bridge to Windows itself.
 *
 * Two shapes, both PowerShell so there is nothing to compile and nothing to
 * rebuild when Electron moves:
 *
 *   watchWindows()  a long-lived process emitting a line per window change
 *   act(actions)    a short-lived process that drives the GUI and reports back
 *
 * Everything here is deliberately behind one small interface, so a native
 * driver could replace it later without anything above noticing.
 */

const PS = "powershell.exe";
const SCRIPTS = path.join(__dirname, "ps");

const baseArgs = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

const supported = process.platform === "win32";

/* ------------------------------------------------------------------ watcher */

let watcher = null;

/**
 * Start streaming foreground-window changes. Returns a stop function.
 * `onWindow` receives { app, title, procId, at }.
 */
function watchWindows(onWindow, onError) {
  if (!supported) return () => {};
  stopWatching();

  const script = path.join(SCRIPTS, "watch-windows.ps1");
  watcher = spawn(PS, [...baseArgs, script], { windowsHide: true });

  const rl = readline.createInterface({ input: watcher.stdout });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text.startsWith("{")) return;
    try {
      onWindow(JSON.parse(text));
    } catch {
      /* a partial line; the next one will be whole */
    }
  });

  watcher.stderr.on("data", (chunk) => onError?.(String(chunk).trim()));
  watcher.on("exit", (code) => {
    if (code !== 0 && code !== null) onError?.(`window watcher exited (${code})`);
    watcher = null;
  });

  return stopWatching;
}

function stopWatching() {
  if (!watcher) return;
  try {
    watcher.kill();
  } catch {
    /* already gone */
  }
  watcher = null;
}

/* -------------------------------------------------------------------- actor */

/**
 * Run a batch of GUI actions. Resolves to one result per action;
 * execution stops at the first failure, so results may be shorter than input.
 */
function act(actions) {
  if (!supported) {
    return Promise.resolve(
      actions.map((a) => ({ kind: a.kind, ok: false, detail: "Only supported on Windows" })),
    );
  }

  const planFile = path.join(
    os.tmpdir(),
    `doppel-plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(planFile, JSON.stringify(actions), "utf8");

  return new Promise((resolve) => {
    const script = path.join(SCRIPTS, "act.ps1");
    const child = spawn(PS, [...baseArgs, script, "-Plan", planFile], { windowsHide: true });

    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));

    child.on("close", () => {
      fs.rm(planFile, { force: true }, () => {});
      const line = out.trim().split("\n").filter(Boolean).pop();
      if (!line) {
        resolve([
          { kind: actions[0]?.kind ?? "gui", ok: false, detail: err.trim() || "No response" },
        ]);
        return;
      }
      try {
        const parsed = JSON.parse(line);
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        resolve([{ kind: "gui", ok: false, detail: err.trim() || line.slice(0, 200) }]);
      }
    });
  });
}

/** Every visible window with a title, for picking a target. */
async function listWindows() {
  const [result] = await act([{ kind: "list-windows" }]);
  if (!result?.ok || !Array.isArray(result.detail)) return [];
  return result.detail;
}

module.exports = { supported, watchWindows, stopWatching, act, listWindows };
