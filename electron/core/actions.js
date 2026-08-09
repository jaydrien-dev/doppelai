const fs = require("node:fs");
const path = require("node:path");
const { shell } = require("electron");

const db = require("./db");
const win32 = require("./win32");

/**
 * The only place Mimic touches anything real.
 *
 * Three rules hold here, whatever the trust level and whether or not the user
 * is in the room:
 *
 *   1. Nothing outside the folders you've allowed is ever read or written.
 *   2. Nothing is destroyed. "Delete" means moved into Mimic's own trash,
 *      where it can be fetched back.
 *   3. Every action writes down how to undo itself before it does anything.
 *      An action with no honest inverse marks the whole run irreversible and
 *      says so rather than pretending.
 */

const GUI_KINDS = ["activate", "click", "type", "hotkey", "wait"];
const FILE_KINDS = ["move", "rename", "copy", "trash", "zip", "mkdir", "await-file", "open"];

/* ------------------------------------------------------------------ helpers */

const globToRegExp = (glob) =>
  new RegExp(
    `^${String(glob)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );

function within(target, roots) {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

/**
 * The newest file in `dir` matching `glob`, ignoring anything still arriving.
 *
 * `dir` is guarded because it can arrive from a model-authored action that
 * simply omitted the field — better an honest empty result than a crash deep
 * in the filesystem layer.
 */
function newestMatch(dir, glob) {
  if (typeof dir !== "string" || !dir) return null;
  if (!fs.existsSync(dir)) return null;
  const re = globToRegExp(glob || "*");
  let best = null;

  for (const name of fs.readdirSync(dir)) {
    if (!re.test(name)) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (Date.now() - stat.mtimeMs < 700) continue; // still being written
    if (!best || stat.mtimeMs > best.mtimeMs) best = { path: full, name, mtimeMs: stat.mtimeMs };
  }
  return best;
}

/** Never overwrite. "report.csv" beside an existing one becomes "report (2).csv". */
function freePath(target) {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 2; i < 500; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function applyNamePattern(name, pattern) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const today = stamp();
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}[ _-]*/, "");

  switch (pattern) {
    case "The old name, then the date":
      return `${stripped} ${today}${ext}`;
    case "Leave the name alone":
      return name;
    case "Date first, then the old name":
    default:
      return `${today} ${stripped}${ext}`;
  }
}

const parked = (rule, detail) => ({ ok: false, parked: true, rule, detail });
const failed = (detail) => ({ ok: false, parked: false, detail });

/* ------------------------------------------------------------------- guards */

/**
 * Decide, before anything happens, whether this action may run at all.
 * Returns null when it may, or a park result when it may not.
 */
function guard(action, { permissions, roots }) {
  if (GUI_KINDS.includes(action.kind)) {
    if (!permissions.actGui) {
      return parked("gui", "Driving other applications isn't switched on yet.");
    }
    return null;
  }

  if (!FILE_KINDS.includes(action.kind)) {
    return parked("unknown", `I don't know how to do "${action.kind}" for real.`);
  }

  /* Every file action needs somewhere to work. An action that names no folder
     is malformed rather than dangerous, but it stops here either way. */
  const NEEDS = {
    move: ["from", "to"],
    copy: ["from", "to"],
    rename: ["dir"],
    trash: ["dir"],
    zip: ["dir"],
    mkdir: ["dir"],
    "await-file": ["dir"],
  };
  for (const key of NEEDS[action.kind] ?? []) {
    if (typeof action[key] !== "string" || !action[key]) {
      return parked("unknown", `That ${action.kind} didn't say which "${key}" folder to use.`);
    }
  }

  if (!permissions.actFiles && action.kind !== "open") {
    return parked("files", "Moving and renaming files isn't switched on yet.");
  }

  if (action.kind === "trash" && !permissions.actTrash) {
    return parked("delete", "Clearing things away isn't switched on yet.");
  }

  // Every folder this action would touch has to be one you've allowed.
  for (const key of ["dir", "from", "to", "file"]) {
    const value = action[key];
    if (!value) continue;
    const dir = key === "file" ? path.dirname(value) : value;
    if (!within(dir, roots)) {
      return parked("outside", `${dir} isn't one of the folders I'm allowed in.`);
    }
  }

  return null;
}

/** Hard rules park regardless of trust — this is what makes them hard. */
function hardRuleFor(action) {
  if (action.kind === "trash") return "delete";
  if (GUI_KINDS.includes(action.kind) && action.kind !== "wait") return "irreversible";
  return null;
}

/* -------------------------------------------------------------------- runner */

/**
 * Carry out one action for real.
 *
 * `overrides` carries what the user has taught: a corrected parameter value,
 * or an approval that lets a hard rule through this once.
 */
async function run(action, { runId, overrides = {}, approved = false } = {}) {
  const state = db.get();
  const roots = [...state.observation.roots, db.paths.trash];
  const permissions = state.permissions;

  const blocked = guard(action, { permissions, roots });
  if (blocked) return blocked;

  const rule = hardRuleFor(action);
  if (rule && !approved) {
    return parked(
      rule,
      rule === "delete"
        ? "This clears something away. I never do that without asking."
        : "I can't undo this once it's done, so I'd rather you said.",
    );
  }

  try {
    switch (action.kind) {
      /* ---------------------------------------------------------- files -- */

      case "await-file": {
        const found = newestMatch(action.dir, overrides.match ?? action.match);
        if (!found) {
          return {
            ok: true,
            detail: `Nothing new in ${path.basename(action.dir)} yet.`,
            changes: [],
            inverse: [],
            noop: true,
          };
        }
        return {
          ok: true,
          detail: `${found.name} is there.`,
          changes: [],
          inverse: [],
          produced: found.path,
        };
      }

      case "move": {
        const match = overrides.match ?? action.match;
        const found = newestMatch(action.from, match);
        if (!found) return { ok: true, detail: "Nothing to move.", changes: [], inverse: [], noop: true };

        fs.mkdirSync(action.to, { recursive: true });
        const target = freePath(path.join(action.to, found.name));
        fs.renameSync(found.path, target);

        return {
          ok: true,
          detail: `${found.name} → ${path.basename(action.to)}`,
          changes: [`Moved ${found.name} into ${path.basename(action.to)}`],
          inverse: [{ kind: "move-exact", from: target, to: found.path }],
          produced: target,
        };
      }

      case "rename": {
        const match = overrides.match ?? action.match;
        const found = newestMatch(action.dir, match);
        if (!found) return { ok: true, detail: "Nothing to rename.", changes: [], inverse: [], noop: true };

        const pattern = overrides.pattern ?? "Date first, then the old name";
        const nextName = applyNamePattern(found.name, pattern);
        if (nextName === found.name) {
          return { ok: true, detail: "Already named right.", changes: [], inverse: [], noop: true };
        }

        const target = freePath(path.join(action.dir, nextName));
        fs.renameSync(found.path, target);

        return {
          ok: true,
          detail: `${found.name} → ${path.basename(target)}`,
          changes: [`Renamed ${found.name} to ${path.basename(target)}`],
          inverse: [{ kind: "move-exact", from: target, to: found.path }],
          produced: target,
        };
      }

      case "copy": {
        const found = newestMatch(action.from, overrides.match ?? action.match);
        if (!found) return { ok: true, detail: "Nothing to copy.", changes: [], inverse: [], noop: true };

        fs.mkdirSync(action.to, { recursive: true });
        const target = freePath(path.join(action.to, found.name));
        fs.copyFileSync(found.path, target);

        return {
          ok: true,
          detail: `Copied ${found.name}`,
          changes: [`Copied ${found.name} into ${path.basename(action.to)}`],
          inverse: [{ kind: "remove-exact", path: target }],
          produced: target,
        };
      }

      case "trash": {
        const found = newestMatch(action.dir, overrides.match ?? action.match);
        if (!found) return { ok: true, detail: "Nothing to clear.", changes: [], inverse: [], noop: true };

        const bin = path.join(db.paths.trash, runId ?? "loose");
        fs.mkdirSync(bin, { recursive: true });
        const target = freePath(path.join(bin, found.name));
        fs.renameSync(found.path, target);

        return {
          ok: true,
          detail: `${found.name} put aside`,
          changes: [`Put ${found.name} in Mimic's trash — still recoverable`],
          inverse: [{ kind: "move-exact", from: target, to: found.path }],
        };
      }

      case "zip": {
        const source = action.dir;
        if (!fs.existsSync(source)) return failed(`${source} isn't there.`);
        const target = freePath(`${source} ${stamp()}.zip`);
        // Compress-Archive is the only zip on a stock Windows box.
        const { spawnSync } = require("node:child_process");
        const out = spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Compress-Archive -Path '${source}\\*' -DestinationPath '${target}' -Force`,
          ],
          { windowsHide: true },
        );
        if (out.status !== 0) return failed(String(out.stderr || "Could not make the archive."));

        return {
          ok: true,
          detail: path.basename(target),
          changes: [`Made ${path.basename(target)}`],
          inverse: [{ kind: "remove-exact", path: target }],
          produced: target,
        };
      }

      case "mkdir": {
        const existed = fs.existsSync(action.dir);
        fs.mkdirSync(action.dir, { recursive: true });
        return {
          ok: true,
          detail: path.basename(action.dir),
          changes: existed ? [] : [`Made the folder ${path.basename(action.dir)}`],
          inverse: existed ? [] : [{ kind: "rmdir-exact", path: action.dir }],
        };
      }

      case "open": {
        const target = action.file ?? newestMatch(action.dir, action.match)?.path;
        if (!target) return { ok: true, detail: "Nothing to open.", changes: [], inverse: [], noop: true };
        await shell.openPath(target);
        return { ok: true, detail: path.basename(target), changes: [], inverse: [] };
      }

      /* ------------------------------------------------------------ gui -- */

      case "activate":
      case "click":
      case "type":
      case "hotkey":
      case "wait": {
        const [result] = await win32.act([{ ...action, ...overrides }]);
        if (!result?.ok) return failed(result?.detail ?? "The window didn't respond.");
        return {
          ok: true,
          detail: String(result.detail ?? ""),
          changes: action.kind === "wait" ? [] : [`${action.kind} in ${result.detail || "the window"}`],
          inverse: [],
          irreversible: action.kind !== "wait" && action.kind !== "activate",
        };
      }

      default:
        return parked("unknown", `I don't know how to do "${action.kind}".`);
    }
  } catch (err) {
    return failed(err.message);
  }
}

/* ----------------------------------------------------------------- rollback */

/** Replay a run's inverses, newest first. This is what "Put it back" runs. */
function undo(inverses) {
  const done = [];
  const failures = [];

  for (const step of [...inverses].reverse()) {
    try {
      switch (step.kind) {
        case "move-exact": {
          if (!fs.existsSync(step.from)) throw new Error(`${path.basename(step.from)} has moved on`);
          fs.mkdirSync(path.dirname(step.to), { recursive: true });
          fs.renameSync(step.from, freePath(step.to));
          done.push(`Put ${path.basename(step.to)} back`);
          break;
        }
        case "remove-exact": {
          if (fs.existsSync(step.path)) fs.rmSync(step.path, { force: true });
          done.push(`Removed ${path.basename(step.path)}`);
          break;
        }
        case "rmdir-exact": {
          if (fs.existsSync(step.path) && fs.readdirSync(step.path).length === 0) {
            fs.rmdirSync(step.path);
            done.push(`Removed the folder ${path.basename(step.path)}`);
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      failures.push(err.message);
    }
  }

  return { ok: failures.length === 0, done, failures };
}

module.exports = { run, undo, hardRuleFor, newestMatch, within, GUI_KINDS, FILE_KINDS };
