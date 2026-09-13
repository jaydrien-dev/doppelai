const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * Windows UI Automation — Doppel's invisible hands.
 *
 * Uses the same spawn-PowerShell pattern as win32.js, but drives the
 * System.Windows.Automation API instead of mouse_event/SendKeys. This
 * means Doppel can find buttons by name, read text fields, click menu
 * items, and fill forms — all without moving the visible pointer or
 * typing into the foreground window.
 *
 * The user keeps working. Doppel works underneath.
 */

const PS = "powershell.exe";
const SCRIPT = path.join(__dirname, "ps", "ui-auto.ps1");
const baseArgs = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

/**
 * Run a batch of UI Automation actions. Same shape as win32.act() —
 * array of actions in, array of results out.
 *
 * Timeout is generous (20s) because some apps are slow to expose their
 * automation tree on first query.
 */
function run(actions, { timeout = 20_000, background = false } = {}) {
  const planFile = path.join(
    os.tmpdir(),
    `doppel-uiauto-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(planFile, JSON.stringify(actions), "utf8");

  const args = [...baseArgs, SCRIPT, "-Plan", planFile];
  if (background) args.push("-Background");

  return new Promise((resolve) => {
    const child = spawn(PS, args, {
      windowsHide: true,
      timeout,
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));

    child.on("close", () => {
      fs.rm(planFile, { force: true }, () => {});
      const line = out.trim().split("\n").filter(Boolean).pop();
      if (!line) {
        resolve([{ kind: actions[0]?.kind ?? "ui-auto", ok: false, detail: err.trim() || "No response" }]);
        return;
      }
      try {
        const parsed = JSON.parse(line);
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        resolve([{ kind: "ui-auto", ok: false, detail: err.trim() || line.slice(0, 500) }]);
      }
    });
  });
}

module.exports = { run };
