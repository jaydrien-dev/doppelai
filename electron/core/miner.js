const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const db = require("./db");

/**
 * Where routines come from.
 *
 * Mimic does not record clicks. It cuts the raw event stream into sessions,
 * reduces each session to a *signature* — what was being achieved, stripped of
 * the particular files involved — and looks for signatures that keep coming
 * back. A signature seen enough times becomes a routine, and the different
 * orderings it has been seen in become its observed paths.
 *
 * Confidence is repetition, not certainty: it rises in a jump each time the
 * same shape lands again, and it only reaches 100 once the orderings agree.
 */

/** A gap this long means the user moved on to something else. */
const IDLE_GAP_MS = 90_000;
/** Below this a "session" is just noise. */
const MIN_STEPS = 2;
/** Seen this many times and it stops being a coincidence. */
const MIN_OCCURRENCES = 2;
/** A deliberate demonstration is worth roughly this many accidental sightings. */
const TEACHING_WEIGHT = 6;

const HOME = os.homedir();

/* ---------------------------------------------------------------- normalise */

/** Downloads/report-March.csv → "Downloads", so the shape survives the specifics. */
function folderName(dir) {
  if (!dir) return "somewhere";
  const rel = path.relative(HOME, dir);
  if (!rel || rel.startsWith("..")) return path.basename(dir) || dir;
  return rel.split(path.sep).join("/");
}

function kindOf(ext) {
  const e = (ext || "").toLowerCase();
  if ([".csv", ".xlsx", ".xls"].includes(e)) return "spreadsheet";
  if ([".pdf"].includes(e)) return "PDF";
  if ([".doc", ".docx", ".rtf", ".txt", ".md"].includes(e)) return "document";
  if ([".png", ".jpg", ".jpeg", ".heic", ".gif", ".webp"].includes(e)) return "image";
  if ([".zip", ".7z", ".rar"].includes(e)) return "archive";
  return e ? `${e.replace(".", "")} file` : "file";
}

const APP_NAMES = {
  excel: "Excel",
  winword: "Word",
  outlook: "Outlook",
  chrome: "Chrome",
  msedge: "Edge",
  firefox: "Firefox",
  explorer: "File Explorer",
  notepad: "Notepad",
  code: "VS Code",
  acrord32: "Acrobat",
  powerpnt: "PowerPoint",
  teams: "Teams",
  slack: "Slack",
};

const APP_GLYPH = {
  excel: "sheet",
  winword: "doc",
  outlook: "mail",
  chrome: "browser",
  msedge: "browser",
  firefox: "browser",
  explorer: "files",
  notepad: "doc",
  code: "doc",
  acrord32: "pdf",
  powerpnt: "doc",
  teams: "chat",
  slack: "chat",
  olk: "mail",
};

const appLabel = (app) => APP_NAMES[(app || "").toLowerCase()] ?? app ?? "something";
const appGlyph = (app) => APP_GLYPH[(app || "").toLowerCase()] ?? "browser";

const glyphForExt = (ext) => {
  const e = (ext || "").toLowerCase();
  if ([".csv", ".xlsx", ".xls"].includes(e)) return "sheet";
  if (e === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".heic", ".gif", ".webp"].includes(e)) return "files";
  return "doc";
};

/* -------------------------------------------------------------- event → step */

/**
 * Reduce one raw event to a candidate step: a stable key (what makes two
 * sessions "the same thing"), plain language, and — crucially — an action
 * Mimic could actually carry out again.
 */
function toStep(event) {
  switch (event.kind) {
    case "file.moved": {
      const fromDir = folderName(event.fromDir);
      const toDir = folderName(event.dir);
      if (fromDir === toDir) {
        return {
          key: `rename:${toDir}:${event.ext}`,
          label: `Rename the new ${kindOf(event.ext)}`,
          detail: `In ${toDir}.`,
          glyph: "files",
          action: {
            kind: "rename",
            dir: event.dir,
            match: `*${event.ext}`,
            example: event.name,
            from: path.basename(event.from),
          },
        };
      }
      return {
        key: `move:${fromDir}>${toDir}:${event.ext}`,
        label: `Move the ${kindOf(event.ext)} into ${path.basename(event.dir)}`,
        detail: `From ${fromDir} to ${toDir}.`,
        glyph: glyphForExt(event.ext),
        action: {
          kind: "move",
          from: event.fromDir,
          to: event.dir,
          match: `*${event.ext}`,
          example: event.name,
        },
      };
    }

    case "file.created":
      return {
        key: `appears:${folderName(event.dir)}:${event.ext}`,
        label: `Wait for the ${kindOf(event.ext)} to land`,
        detail: `In ${folderName(event.dir)}.`,
        glyph: glyphForExt(event.ext),
        action: { kind: "await-file", dir: event.dir, match: `*${event.ext}` },
      };

    case "file.removed":
      return {
        key: `remove:${folderName(event.dir)}:${event.ext}`,
        label: `Clear the old ${kindOf(event.ext)} out`,
        detail: `From ${folderName(event.dir)}.`,
        glyph: "files",
        action: { kind: "trash", dir: event.dir, match: `*${event.ext}` },
      };

    case "window.focus":
      return {
        key: `app:${(event.app || "").toLowerCase()}`,
        label: `Bring up ${appLabel(event.app)}`,
        detail: event.title ? `The window called "${trim(event.title)}".` : "",
        glyph: appGlyph(event.app),
        action: { kind: "activate", match: appLabel(event.app), app: event.app },
      };

    case "clip.copy":
      return {
        key: `copy:${event.shape}`,
        label: `Copy ${event.shape}`,
        detail: "Out of whatever was in front of you.",
        glyph: "doc",
        action: { kind: "none" },
      };

    default:
      return null;
  }
}

const trim = (s, n = 46) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ------------------------------------------------------------------ sessions */

/** Cut the stream wherever the user stopped for a while. */
function sessionize(events) {
  const sessions = [];
  let current = [];
  let last = 0;

  for (const event of events) {
    if (current.length && event.at - last > IDLE_GAP_MS) {
      sessions.push(current);
      current = [];
    }
    current.push(event);
    last = event.at;
  }
  if (current.length) sessions.push(current);
  return sessions;
}

/** Collapse a session into ordered, de-duplicated steps. */
function distil(session) {
  const steps = [];
  const seenApps = new Set();

  for (const event of session) {
    const step = toStep(event);
    if (!step) continue;

    // The same step twice running is one step.
    if (steps.length && steps[steps.length - 1].key === step.key) continue;

    /* Alternating between two windows is one habit, not one per switch.
       Without this, tabbing back and forth all afternoon becomes a hundred-step
       "routine" whose signature never repeats and whose name is unreadable.
       File steps may legitimately recur — only window focus is collapsed. */
    if (step.key.startsWith("app:")) {
      if (seenApps.has(step.key)) continue;
      seenApps.add(step.key);
    }

    steps.push({ ...step, at: event.at });
  }

  return steps;
}

/** The identity of a piece of work: its steps, order ignored. */
const shapeOf = (steps) => [...new Set(steps.map((s) => s.key))].sort().join("|");
/** The identity of one way of doing it. */
const pathOf = (steps) => steps.map((s) => s.key).join(">");

/* -------------------------------------------------------------- confidence */

/**
 * Repetition is the only thing that moves this, and it moves in steps.
 * Reaching 100 also needs the orderings to agree — if every sighting was
 * different, Mimic genuinely does not know how the task goes yet.
 */
function confidenceFor(occurrences, paths, weight) {
  const seen = occurrences + weight;
  if (seen < MIN_OCCURRENCES) return Math.min(24, seen * 12);

  const base = [0, 18, 44, 62, 76, 86, 93, 97, 100];
  let value = base[Math.min(seen, base.length - 1)];

  const dominant = Math.max(...paths.map((p) => p.seenCount));
  const agreement = dominant / occurrences;
  if (agreement < 0.6) value = Math.min(value, 72);
  else if (agreement < 0.85) value = Math.min(value, 88);

  return Math.max(0, Math.min(100, Math.round(value)));
}

/* --------------------------------------------------------------- assemble */

/**
 * "VS Code, Chrome and Explorer" — unique, capped, and readable.
 *
 * Flipping between two windows twenty times is one habit, not twenty; joining
 * every sighting produces a title nobody can read and that says nothing.
 */
function appNames(apps, cap = 3) {
  const unique = [...new Set(apps.map((a) => a.label.replace("Bring up ", "")))];
  const shown = unique.slice(0, cap);
  const rest = unique.length - shown.length;
  const list =
    shown.length <= 1
      ? (shown[0] ?? "something")
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${list} and ${rest} more` : list;
}

function describe(steps) {
  const moves = steps.filter((s) => s.action?.kind === "move");
  const renames = steps.filter((s) => s.action?.kind === "rename");
  const removes = steps.filter((s) => s.action?.kind === "trash");
  const apps = steps.filter((s) => s.action?.kind === "activate");

  const parts = [];
  if (moves.length) {
    const target = path.basename(moves[0].action.to);
    parts.push(`get the right files into ${target}`);
  }
  if (renames.length) parts.push("give them the names you use");
  if (removes.length) parts.push("clear out what's finished with");
  if (!parts.length && apps.length) parts.push(`move between ${appNames(apps)}`);
  if (!parts.length) parts.push("repeat the sequence you keep doing by hand");

  const title = moves.length
    ? `Filing what lands in ${folderName(moves[0].action.from)}`
    : renames.length
      ? `Naming the new ${path.basename(renames[0].action.dir)} files`
      : removes.length
        ? `Clearing out ${folderName(removes[0].action.dir)}`
        : apps.length
          ? `The ${appNames(apps, 2)} round`
          : "Something you keep repeating";

  const criteria = [];
  if (moves.length) criteria.push(`Nothing left behind in ${folderName(moves[0].action.from)}`);
  if (renames.length) criteria.push("Every file named the way you name them");
  if (removes.length) criteria.push("The old ones gone, recoverably");
  if (!criteria.length) criteria.push("The same end state you reach by hand");

  return { title, intent: `To ${parts.join(", and ")}.`, criteria };
}

/** Steps that touch nothing are useful evidence but not worth executing. */
const executable = (step) => step.action && step.action.kind !== "none";

function buildRoutine(existing, group, now) {
  const paths = group.paths;
  const dominant = [...paths].sort((a, b) => b.seenCount - a.seenCount)[0];
  const steps = dominant.steps;
  const { title, intent, criteria } = describe(steps);

  const weight = existing?.taughtWeight ?? 0;
  const confidence = confidenceFor(group.occurrences, paths, weight);
  const previous = existing?.confidence ?? 0;

  const stepLibrary = steps.map((s, i) => ({
    id: `${group.shape.slice(0, 8)}-${i}`,
    key: s.key,
    label: s.label,
    detail: s.detail,
    app: s.glyph,
    certainty: paths.length === 1 || confidence >= 90 ? "sure" : "guessing",
    duration: 1.4,
    action: s.action,
    hardRule: hardRuleFor(s.action),
    param: paramFor(s.action),
  }));

  const history = existing?.confidenceHistory ?? [];
  const changed = Math.round(previous) !== Math.round(confidence);

  return {
    id: existing?.id ?? `r-${group.shape.slice(0, 10)}`,
    shape: group.shape,
    title: existing?.renamed ? existing.title : title,
    intent,
    successCriteria: criteria,
    source: sourceLine(group, weight),
    hunch: intent.replace(/^To /, "You ").replace(/\.$/, "."),
    unsure: unsureLine(paths, confidence),

    stage: existing?.stage ?? (confidence >= 100 ? "ready" : "learning"),
    confidence,
    observations: group.occurrences,

    stepLibrary,
    observedPaths: paths.map((p, i) => ({
      id: `${group.shape.slice(0, 8)}-p${i}`,
      label: pathLabel(p, dominant, i),
      seenCount: p.seenCount,
      lastSeen: p.lastSeen,
      stepIds: p.steps.map((s) => {
        const match = stepLibrary.find((l) => l.key === s.key);
        return match ? match.id : null;
      }).filter(Boolean),
    })),

    lessons: existing?.lessons ?? [],
    confidenceHistory: changed ? [...history, { at: now, value: confidence }] : history,

    provingRunsRequired: existing?.provingRunsRequired ?? 4,
    provingRunsPassed: existing?.provingRunsPassed ?? 0,
    presentRunsRequired: existing?.presentRunsRequired ?? 3,
    presentRunsPassed: existing?.presentRunsPassed ?? 0,

    lastRunAt: existing?.lastRunAt,
    minutesPerRun: Math.max(2, Math.round(steps.length * 1.6)),
    discoveredAt: existing?.discoveredAt ?? group.firstSeen,

    order: existing?.order?.length
      ? existing.order.filter((id) => stepLibrary.some((s) => s.id === id))
      : stepLibrary.map((s) => s.id),
    skipped: existing?.skipped ?? [],
    resolvedQuestions: existing?.resolvedQuestions ?? [],

    recentOutcomes: existing?.recentOutcomes ?? [],
    drifting: existing?.drifting ?? false,
    relearning: existing?.relearning ?? false,

    quarantined: existing?.quarantined ?? false,
    sharedFrom: existing?.sharedFrom,
    starter: false,
    taughtDirectly: weight > 0,
    taughtWeight: weight,
  };
}

function sourceLine(group, weight) {
  const days = Math.max(1, Math.round((group.lastSeen - group.firstSeen) / 86_400_000));
  if (weight > 0) return "You showed me this one deliberately.";
  if (days <= 1) return `I've watched this ${group.occurrences} times today.`;
  return `I've watched this ${group.occurrences} times over ${days} days.`;
}

function unsureLine(paths, confidence) {
  if (confidence >= 100) return undefined;
  if (paths.length > 1) return "which order you actually do it in — I've seen more than one";
  return "whether I've seen the whole thing, or just the part you do at the machine";
}

function pathLabel(p, dominant, i) {
  if (p === dominant) return "The way you usually do it";
  return `A different order, seen ${p.seenCount} ${p.seenCount === 1 ? "time" : "times"}`;
}

/** Rules that hold whatever the trust level. Derived, never hand-set. */
function hardRuleFor(action) {
  if (!action) return undefined;
  if (action.kind === "trash") return "delete";
  if (["click", "type", "hotkey", "activate"].includes(action.kind)) return undefined;
  return undefined;
}

/** The one knob the user can turn on this step from "Correct this step". */
function paramFor(action) {
  if (!action) return undefined;
  if (action.kind === "move") {
    return {
      label: "Which files I move",
      value: action.match,
      options: [action.match, "*", `*${path.extname(action.example || "")}`].filter(
        (v, i, a) => v && a.indexOf(v) === i,
      ),
    };
  }
  if (action.kind === "rename") {
    return {
      label: "How I name them",
      value: "Date first, then the old name",
      options: [
        "Date first, then the old name",
        "The old name, then the date",
        "Leave the name alone",
      ],
    };
  }
  return undefined;
}

/* ----------------------------------------------------------------- the mine */

/**
 * Re-derive every routine from the event journal. Cheap enough to run whenever
 * a session closes, and idempotent — nothing the user has taught it is lost,
 * because corrections live on the routine and are merged back in.
 */
function mine({ now = Date.now() } = {}) {
  const state = db.get();
  const sessions = sessionize(state.events);

  const groups = new Map();

  for (const session of sessions) {
    const steps = distil(session).filter(executable);
    if (steps.length < MIN_STEPS) continue;

    const shape = shapeOf(steps);
    const order = pathOf(steps);
    const at = steps[steps.length - 1].at;

    let group = groups.get(shape);
    if (!group) {
      group = {
        shape,
        occurrences: 0,
        firstSeen: steps[0].at,
        lastSeen: at,
        paths: [],
      };
      groups.set(shape, group);
    }

    group.occurrences += 1;
    group.firstSeen = Math.min(group.firstSeen, steps[0].at);
    group.lastSeen = Math.max(group.lastSeen, at);

    let p = group.paths.find((x) => x.order === order);
    if (!p) {
      p = { order, seenCount: 0, lastSeen: at, steps };
      group.paths.push(p);
    }
    p.seenCount += 1;
    p.lastSeen = Math.max(p.lastSeen, at);
    p.steps = steps;
  }

  const kept = [...groups.values()].filter(
    (g) => g.occurrences + weightFor(state, g.shape) >= MIN_OCCURRENCES,
  );

  const next = kept.map((group) => {
    const existing = state.routines.find((r) => r.shape === group.shape);
    return buildRoutine(existing, group, now);
  });

  // Routines the user is part-way through keep their place even if the raw
  // evidence has aged out of the journal.
  const preserved = state.routines.filter(
    (r) => !next.some((n) => n.shape === r.shape) && r.stage !== "learning",
  );

  db.update((s) => {
    s.routines = [...next, ...preserved].sort((a, b) => b.confidence - a.confidence);
    s.stats.sessionsSeen = sessions.length;
  });

  return db.get().routines;
}

function weightFor(state, shape) {
  const existing = state.routines.find((r) => r.shape === shape);
  return existing?.taughtWeight ?? 0;
}

/**
 * "Watch this": everything observed between arming and finishing is one
 * session, and it counts for far more than an accidental sighting.
 */
function creditTeaching(fromAt, toAt) {
  const state = db.get();
  const taught = state.events.filter((e) => e.at >= fromAt && e.at <= toAt);
  const steps = distil(taught).filter(executable);
  if (steps.length < MIN_STEPS) return { ok: false, reason: "not-enough" };

  const shape = shapeOf(steps);
  db.update((s) => {
    const existing = s.routines.find((r) => r.shape === shape);
    if (existing) existing.taughtWeight = (existing.taughtWeight ?? 0) + TEACHING_WEIGHT;
    else s.pendingTeaching = { shape, weight: TEACHING_WEIGHT };
  });

  // A routine that did not exist yet needs one mine pass before the weight can
  // be attached, so carry it in and apply it on the way back through.
  const before = db.get().routines.find((r) => r.shape === shape);
  mine();
  if (!before) {
    db.update((s) => {
      const made = s.routines.find((r) => r.shape === shape);
      if (made) made.taughtWeight = TEACHING_WEIGHT;
      delete s.pendingTeaching;
    });
    mine();
  }

  const routine = db.get().routines.find((r) => r.shape === shape);
  return { ok: true, routineId: routine?.id, confidence: routine?.confidence ?? 0 };
}

module.exports = {
  mine,
  creditTeaching,
  sessionize,
  distil,
  toStep,
  appLabel,
  IDLE_GAP_MS,
  TEACHING_WEIGHT,
};
