const crypto = require("node:crypto");

const db = require("./db");
const actions = require("./actions");

/**
 * The run engine, living where the work actually happens.
 *
 * A supervised run is stepped deliberately so it can be watched, but each step
 * is a real action against real files. Pause, step back and correct all apply
 * to work that has genuinely been done, which is the whole point of watching.
 *
 * If a step cannot be completed honestly, the run stops cleanly: it puts back
 * what it can, reports what it finished and what it didn't, and asks. It never
 * leaves the job half-done and quiet about it.
 */

const STEP_MIN_MS = 1200;
const STEP_MAX_MS = 2000;

let run = null;
let timer = null;
let publish = () => {};

const now = () => Date.now();

/* --------------------------------------------------------------------------- */

const routineById = (id) => db.get().routines.find((r) => r.id === id);

function planFor(routine) {
  const ids = routine.order?.length ? routine.order : routine.stepLibrary.map((s) => s.id);
  return ids
    .map((id) => routine.stepLibrary.find((s) => s.id === id))
    .filter(Boolean);
}

const activePlan = (routine) =>
  planFor(routine).filter((s) => !routine.skipped?.includes(s.id));

function snapshot() {
  return run ? JSON.parse(JSON.stringify(run)) : null;
}

function emit() {
  publish(snapshot());
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/* ------------------------------------------------------------------ starting */

function start(routineId, { supervised, unattended = false, from = "desk" } = {}) {
  const routine = routineById(routineId);
  if (!routine) return { ok: false, reason: "No such routine." };

  clearTimer();
  const plan = planFor(routine);

  const stepStates = {};
  for (const step of plan) {
    stepStates[step.id] = routine.skipped?.includes(step.id) ? "skipped" : "pending";
  }

  run = {
    id: crypto.randomUUID(),
    routineId,
    routineTitle: routine.title,
    runIndex: routine.provingRunsPassed + 1,
    stepIndex: -1,
    status: "running",
    stepStates,
    stepDetails: {},
    overrides: { ...(routine.overrides ?? {}) },
    order: plan.map((s) => s.id),
    skipped: [...(routine.skipped ?? [])],
    correctionsThisRun: [],
    startedAt: now(),
    elapsedSec: 0,
    journal: [],
    /** Inverses grouped per step, so stepping back undoes exactly that step. */
    stepJournal: {},
    changes: [],
    stepChanges: {},
    irreversible: false,
    parkedReason: null,
    parkedRule: null,
    supervised: supervised ?? ["ready", "supervised"].includes(routine.stage),
    unattended,
    dispatchedFrom: from,
    summary: null,
  };

  emit();
  schedule(500);
  return { ok: true, run: snapshot() };
}

/* ------------------------------------------------------------------- driving */

function schedule(ms) {
  clearTimer();
  timer = setTimeout(tick, ms);
}

async function tick() {
  if (!run || run.status !== "running") return;

  const routine = routineById(run.routineId);
  if (!routine) return stopCleanly("The routine went away underneath me.");

  const next = run.stepIndex + 1;
  const stepId = run.order[next];

  if (!stepId) return finish();

  run.stepIndex = next;

  if (run.skipped.includes(stepId)) {
    run.stepStates[stepId] = "skipped";
    emit();
    return schedule(320);
  }

  const step = routine.stepLibrary.find((s) => s.id === stepId);
  if (!step) return schedule(120);

  run.stepStates[stepId] = "active";
  emit();

  const startedAt = now();
  const result = await actions.run(step.action, {
    runId: run.id,
    overrides: run.overrides[stepId] ?? {},
    approved: false,
  });

  if (!run || run.status !== "running") return; // paused or stopped mid-action

  /* It stopped itself rather than cross a line. */
  if (result.parked) {
    run.status = "parked";
    run.parkedRule = result.rule;
    run.parkedReason = result.detail;
    run.stepStates[stepId] = "parked";
    emit();
    return;
  }

  if (!result.ok) {
    run.stepDetails[stepId] = result.detail;
    return stopCleanly(`I couldn't finish "${step.label.toLowerCase()}". ${result.detail}`);
  }

  commit(stepId, step, result, startedAt);
  emit();

  const spent = now() - startedAt;
  schedule(Math.max(STEP_MIN_MS - spent, 380));
}

/** Record what a completed step actually did. */
function commit(stepId, step, result, startedAt) {
  run.stepStates[stepId] = run.correctionsThisRun.some((c) => c.stepId === stepId)
    ? "corrected"
    : "done";
  run.stepDetails[stepId] = result.detail || (result.noop ? "Nothing needed doing." : "Done.");
  run.stepJournal[stepId] = [...(run.stepJournal[stepId] ?? []), ...(result.inverse ?? [])];
  run.stepChanges[stepId] = [...(run.stepChanges[stepId] ?? []), ...(result.changes ?? [])];
  run.journal.push(...(result.inverse ?? []));
  run.changes.push(...(result.changes ?? []));
  if (result.irreversible) run.irreversible = true;
  run.elapsedSec += Math.max(0.4, (now() - startedAt) / 1000);
}

/* ------------------------------------------------------------------ controls */

function pause() {
  if (!run || run.status !== "running") return;
  clearTimer();
  run.status = "paused";
  emit();
}

function resume() {
  if (!run || !["paused", "correcting"].includes(run.status)) return;
  run.status = "running";
  emit();
  schedule(320);
}

/**
 * Step back. The work already done is genuinely undone first — otherwise
 * "step back" would be a lie about the state of the machine.
 */
function stepBack() {
  if (!run || run.stepIndex <= 0) return;
  clearTimer();

  const currentId = run.order[run.stepIndex];
  const previousId = run.order[run.stepIndex - 1];

  /* Undo exactly what these two steps did, newest first. Anything else would
     leave the screen saying one thing and the disk saying another. */
  const toUndo = [...(run.stepJournal[currentId] ?? []), ...(run.stepJournal[previousId] ?? [])];
  const undone = actions.undo(toUndo);

  for (const id of [currentId, previousId]) {
    const changes = run.stepChanges[id] ?? [];
    for (const change of changes) {
      const i = run.changes.lastIndexOf(change);
      if (i >= 0) run.changes.splice(i, 1);
    }
    const inverses = run.stepJournal[id] ?? [];
    for (const inverse of inverses) {
      const i = run.journal.lastIndexOf(inverse);
      if (i >= 0) run.journal.splice(i, 1);
    }
    delete run.stepJournal[id];
    delete run.stepChanges[id];
    delete run.stepDetails[id];
  }

  run.stepStates[currentId] = run.skipped.includes(currentId) ? "skipped" : "pending";
  run.stepStates[previousId] = "pending";
  run.stepIndex -= 2;
  run.status = "paused";
  run.stepDetails[previousId] = undone.done.length
    ? `Undone. ${undone.done.join(". ")}`
    : "Nothing needed undoing.";
  emit();
}

function openCorrection() {
  if (!run || ["finished", "stopped"].includes(run.status)) return;
  clearTimer();
  run.status = "correcting";
  emit();
}

function closeCorrection() {
  if (!run || run.status !== "correcting") return;
  run.status = "paused";
  emit();
}

/**
 * A correction is written back to the routine, so it changes what happens next
 * time and not merely what happens now.
 */
function correct({ stepId, value, pattern, skip, move }) {
  if (!run) return;
  const routine = routineById(run.routineId);
  if (!routine) return;
  const step = routine.stepLibrary.find((s) => s.id === stepId);
  if (!step) return;

  let lesson;
  if (skip) lesson = `I'll leave "${step.label.toLowerCase()}" alone from now on.`;
  else if (move === "earlier") lesson = `I'll do "${step.label.toLowerCase()}" earlier.`;
  else if (move === "later") lesson = `I'll do "${step.label.toLowerCase()}" later.`;
  else lesson = `${step.param?.label ?? "This"} is ${value ?? pattern}.`;

  const entry = {
    id: crypto.randomUUID(),
    stepId,
    stepLabel: step.label,
    lesson,
    at: now(),
    runIndex: run.runIndex,
    kind: "correction",
  };

  const order = [...run.order];
  if (move) {
    const i = order.indexOf(stepId);
    const j = move === "earlier" ? i - 1 : i + 1;
    if (j >= 0 && j < order.length) [order[i], order[j]] = [order[j], order[i]];
  }

  const skipped = skip
    ? [...new Set([...run.skipped, stepId])]
    : run.skipped.filter((id) => id !== stepId);

  const override = {};
  if (value !== undefined) override.match = value;
  if (pattern !== undefined) override.pattern = pattern;

  db.update((s) => {
    const r = s.routines.find((x) => x.id === run.routineId);
    if (!r) return;
    r.order = order;
    r.skipped = skipped;
    r.lessons = [...(r.lessons ?? []), entry];
    r.overrides = { ...(r.overrides ?? {}), [stepId]: { ...(r.overrides?.[stepId] ?? {}), ...override } };
    const target = r.stepLibrary.find((x) => x.id === stepId);
    if (target) {
      target.certainty = "sure";
      if (value !== undefined && target.param) target.param.value = value;
      if (pattern !== undefined && target.param) target.param.value = pattern;
    }
  });

  run.order = order;
  run.skipped = skipped;
  run.overrides[stepId] = { ...(run.overrides[stepId] ?? {}), ...override };
  run.stepStates[stepId] = skip ? "skipped" : "corrected";
  run.correctionsThisRun.push(entry);
  run.status = "paused";
  emit();
  return entry;
}

/** Answering a parked hard rule. Approving lets this one action through, once. */
async function resolvePark(choice) {
  if (!run || run.status !== "parked") return;
  const stepId = run.order[run.stepIndex];
  const routine = routineById(run.routineId);
  const step = routine?.stepLibrary.find((s) => s.id === stepId);

  if (choice === "stop") return stopCleanly("You told me to stop before that step.");

  if (choice === "skip") {
    run.skipped = [...new Set([...run.skipped, stepId])];
    run.stepStates[stepId] = "skipped";
    run.status = "running";
    run.parkedReason = null;
    run.parkedRule = null;
    emit();
    return schedule(320);
  }

  // Approved: do exactly the thing that was parked, and nothing more.
  run.status = "running";
  run.parkedReason = null;
  run.parkedRule = null;
  emit();

  const startedAt = now();
  const result = await actions.run(step.action, {
    runId: run.id,
    overrides: run.overrides[stepId] ?? {},
    approved: true,
  });

  if (!run) return;
  if (!result.ok) {
    return stopCleanly(`I couldn't finish "${step.label.toLowerCase()}". ${result.detail}`);
  }

  commit(stepId, step, result, startedAt);
  emit();
  schedule(STEP_MIN_MS);
}

/** The user came back mid-run. Yield immediately, ask nothing until they say. */
function yieldToUser() {
  if (!run || !["running", "paused"].includes(run.status)) return;
  clearTimer();
  run.status = "yielded";
  emit();
}

function resolveYield(choice) {
  if (!run || run.status !== "yielded") return;
  if (choice === "resume") {
    run.status = "running";
    emit();
    return schedule(400);
  }
  return stopCleanly(
    choice === "handover" ? "You've taken it over." : "Stopped where you asked.",
  );
}

/* ------------------------------------------------------------------ endings */

function tally(routine) {
  const completed = [];
  const notCompleted = [];
  run.order.forEach((id, i) => {
    const step = routine?.stepLibrary.find((s) => s.id === id);
    if (!step || run.skipped.includes(id)) return;
    if (i <= run.stepIndex && ["done", "corrected"].includes(run.stepStates[id])) {
      completed.push(step.label);
    } else if (i > run.stepIndex || run.stepStates[id] === "parked") {
      notCompleted.push(step.label);
      if (["pending", "active"].includes(run.stepStates[id])) run.stepStates[id] = "unreached";
    }
  });
  return { completed, notCompleted };
}

function stopCleanly(reason) {
  if (!run) return;
  clearTimer();
  const routine = routineById(run.routineId);
  const { completed, notCompleted } = tally(routine);

  const record = write(routine, {
    outcome: "stopped",
    note: `${reason} I've put back what I could and left the rest alone.`,
    minutesSaved: 0,
    completed,
    notCompleted,
  });

  run.status = "stopped";
  run.summary = {
    outcome: "stopped",
    note: record.note,
    durationSec: record.durationSec,
    corrections: run.correctionsThisRun.length,
    minutesSaved: 0,
    changes: run.changes,
    completed,
    notCompleted,
    runId: record.id,
  };
  emit();
}

function finish() {
  if (!run) return;
  clearTimer();
  const routine = routineById(run.routineId);
  const corrections = run.correctionsThisRun.length;
  const clean = corrections === 0;
  const { completed, notCompleted } = tally(routine);

  const note = clean
    ? run.changes.length
      ? `Done. ${run.changes.length} ${run.changes.length === 1 ? "thing" : "things"} changed, nothing needed you.`
      : "Done. There was nothing to do this time."
    : `You corrected me ${corrections} ${corrections === 1 ? "time" : "times"}. I've kept ${corrections === 1 ? "it" : "them"}.`;

  const minutesSaved = clean ? (routine?.minutesPerRun ?? 0) : 0;
  const record = write(routine, {
    outcome: clean ? "clean" : "corrected",
    note,
    minutesSaved,
    completed,
    notCompleted,
  });

  const proving = ["ready", "supervised"].includes(routine?.stage);
  let earned = false;

  db.update((s) => {
    const r = s.routines.find((x) => x.id === run.routineId);
    if (!r) return;
    const outcome = clean ? "clean" : "corrected";
    r.recentOutcomes = [...(r.recentOutcomes ?? []), outcome].slice(-3);
    const bad = r.recentOutcomes.filter((o) => o === "stopped" || o === "corrected").length;
    r.drifting = r.relearning ? false : bad >= 2;
    r.lastRunAt = now();
    if (proving) {
      r.stage = "supervised";
      if (clean) r.provingRunsPassed += 1;
      if (clean) r.quarantined = false;
      earned = r.provingRunsPassed >= r.provingRunsRequired;
    } else if (clean) {
      r.presentRunsPassed = (r.presentRunsPassed ?? 0) + 1;
    }
  });

  run.status = "finished";
  run.summary = {
    outcome: clean ? "clean" : "corrected",
    note,
    durationSec: record.durationSec,
    corrections,
    minutesSaved,
    changes: run.changes,
    completed,
    notCompleted,
    runId: record.id,
    earned,
  };
  emit();
}

function write(routine, { outcome, note, minutesSaved, completed, notCompleted }) {
  const record = {
    id: run.id,
    routineId: run.routineId,
    routineTitle: run.routineTitle,
    at: now(),
    durationSec: Math.round(run.elapsedSec * 10) / 10,
    corrections: run.correctionsThisRun.length,
    outcome,
    note,
    minutesSaved,
    supervised: run.supervised,
    unattended: run.unattended,
    reasoning: {
      saw: `${completed.length + notCompleted.length} steps, from watching you do this ${routine?.observations ?? 0} times.`,
      inferred: routine?.intent ?? "",
      applied: routine?.lessons?.[routine.lessons.length - 1]?.lesson,
    },
    steps: [
      ...completed.map((label) => ({ label, state: "done" })),
      ...notCompleted.map((label) => ({ label, state: "unreached" })),
    ],
    changes: run.changes,
    journal: run.journal,
    reversible: run.journal.length > 0 && !run.irreversible,
    rolledBack: false,
    recording: outcome === "clean" || outcome === "autonomous",
  };

  db.update((s) => {
    s.runs.unshift(record);
    if (s.runs.length > 500) s.runs.length = 500;
    if (s.away.active) s.away.actionsUsed += completed.length;
  });

  return record;
}

function abort() {
  clearTimer();
  run = null;
  emit();
}

/** Put back everything a run did, for real. */
function rollback(runId) {
  const state = db.get();
  const record = state.runs.find((r) => r.id === runId);
  if (!record) return { ok: false, detail: "I don't have that run." };
  if (record.rolledBack) return { ok: false, detail: "Already put back." };
  if (!record.reversible) return { ok: false, detail: "I can't undo this one." };

  const result = actions.undo(record.journal ?? []);
  db.update((s) => {
    const r = s.runs.find((x) => x.id === runId);
    if (r) {
      r.rolledBack = result.ok;
      r.rollbackNote = result.ok ? result.done.join(". ") : result.failures.join(". ");
    }
  });
  return result;
}

function setPublisher(fn) {
  publish = fn;
}

module.exports = {
  start,
  pause,
  resume,
  stepBack,
  openCorrection,
  closeCorrection,
  correct,
  resolvePark,
  yieldToUser,
  resolveYield,
  stopCleanly,
  abort,
  rollback,
  setPublisher,
  snapshot,
  planFor,
  activePlan,
};
