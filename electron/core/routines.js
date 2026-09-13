const crypto = require("node:crypto");

const db = require("./db");
const brain = require("./brain");
const agent = require("./agent");

/**
 * Routines — learned automation from observed patterns.
 *
 * A routine is born when brain.detectPatterns() finds repeated behaviour and
 * the user accepts it. From then on, Doppel can re-run it on a schedule or
 * on demand. The pattern detection is automatic; the activation is always
 * a conscious choice.
 *
 * Schedules are inferred from when the episodes actually happened — if the
 * person does something every weekday morning, the routine suggests "daily
 * at 09:00, Mon-Fri". The user can change this later.
 */

let scheduler = null;

/* -------------------------------------------------------- schedule inference */

/**
 * Given the timestamps of a cluster of episodes, guess a schedule.
 *
 * If they're all in the same hour bracket and most are weekdays, suggest
 * "daily at that hour, weekdays only". Otherwise, manual.
 */
function inferSchedule(episodeIds) {
  const episodes = brain.recentEpisodes(2000).filter((e) => episodeIds.includes(e.id));
  if (episodes.length < 3) return { kind: "manual", timeHint: "", daysOfWeek: [] };

  /* Collect hours and days of week. */
  const hours = [];
  const days = new Set();
  for (const ep of episodes) {
    const d = new Date(ep.at);
    hours.push(d.getHours());
    days.add(d.getDay());
  }

  /* Find the most common hour. */
  const hourCounts = {};
  for (const h of hours) hourCounts[h] = (hourCounts[h] ?? 0) + 1;
  const peakHour = Number(
    Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0][0],
  );

  /* How concentrated is the time? If >60% within ±1 hour, it's a schedule. */
  const nearPeak = hours.filter((h) => Math.abs(h - peakHour) <= 1).length;
  const timeClustered = nearPeak / hours.length > 0.6;

  if (!timeClustered) return { kind: "manual", timeHint: "", daysOfWeek: [] };

  const timeHint = `${String(peakHour).padStart(2, "0")}:00`;
  const daysOfWeek = [...days].sort();

  /* If mostly weekdays (Mon=1..Fri=5), suggest daily weekday. */
  const weekdayCount = daysOfWeek.filter((d) => d >= 1 && d <= 5).length;
  if (weekdayCount >= 4) {
    return { kind: "daily", timeHint, daysOfWeek: [1, 2, 3, 4, 5] };
  }

  return { kind: "daily", timeHint, daysOfWeek };
}

/* ------------------------------------------------------------- proposals */

/**
 * Generate routine proposals from detected patterns.
 *
 * Filters out patterns the user has already accepted or rejected.
 */
function proposals() {
  const state = db.get();
  const existing = (state.routines ?? []).map((r) => r.patternId);
  const rejected = state.rejectedPatterns ?? [];
  const skip = new Set([...existing, ...rejected]);

  const patterns = brain.detectPatterns({ minCount: 3, windowDays: 14 });

  return patterns
    .filter((p) => !skip.has(p.id))
    .map((p) => ({
      patternId: p.id,
      title: p.label,
      instruction: p.instruction,
      sourceApp: p.app,
      schedule: inferSchedule(p.episodeIds),
      reason: `I noticed you do this ${p.count} times in the last two weeks.`,
      count: p.count,
    }));
}

/* --------------------------------------------------- accept / reject / manage */

function accept(patternId) {
  const props = proposals();
  const proposal = props.find((p) => p.patternId === patternId);
  if (!proposal) return { ok: false, detail: "That pattern isn't available any more." };

  const routine = {
    id: crypto.randomUUID(),
    patternId: proposal.patternId,
    instruction: proposal.instruction,
    title: proposal.title,
    sourceApp: proposal.sourceApp,
    schedule: proposal.schedule,
    enabled: true,
    createdAt: Date.now(),
    lastRunAt: null,
    lastOutcome: null,
    runCount: 0,
  };

  db.update((s) => {
    s.routines.push(routine);
  });

  return { ok: true, routine };
}

function reject(patternId) {
  db.update((s) => {
    if (!s.rejectedPatterns.includes(patternId)) {
      s.rejectedPatterns.push(patternId);
    }
  });
  return { ok: true };
}

function remove(routineId) {
  db.update((s) => {
    s.routines = s.routines.filter((r) => r.id !== routineId);
  });
  return { ok: true };
}

function toggle(routineId) {
  let found = false;
  db.update((s) => {
    const r = s.routines.find((r) => r.id === routineId);
    if (r) {
      r.enabled = !r.enabled;
      found = true;
    }
  });
  return { ok: found };
}

function list() {
  return db.get().routines ?? [];
}

/* ------------------------------------------------------------ execution */

async function runNow(routineId) {
  const state = db.get();
  const routine = (state.routines ?? []).find((r) => r.id === routineId);
  if (!routine) return { ok: false, detail: "Routine not found." };

  const result = await agent.run({
    instruction: routine.instruction,
    routineId: routine.id,
    title: routine.title,
    mode: "background",
  });

  if (result.ok) {
    db.update((s) => {
      const r = s.routines.find((r) => r.id === routineId);
      if (r) {
        r.lastRunAt = Date.now();
        r.runCount += 1;
      }
    });
  }

  return result;
}

/* ------------------------------------------------------------ scheduler */

/**
 * Start the scheduler. Checks every 10 minutes whether any routine is due.
 *
 * A routine is due when:
 *   - It's enabled
 *   - The current time is within ±30 minutes of its timeHint
 *   - The current day of week matches
 *   - It hasn't already run today
 */
function startScheduler() {
  if (scheduler) return;

  scheduler = setInterval(() => {
    const now = new Date();
    const state = db.get();
    const routines = state.routines ?? [];

    for (const routine of routines) {
      if (!routine.enabled) continue;
      if (routine.schedule.kind === "manual") continue;

      /* Already ran today? */
      if (routine.lastRunAt) {
        const lastRun = new Date(routine.lastRunAt);
        if (lastRun.toDateString() === now.toDateString()) continue;
      }

      /* Check day of week. */
      if (routine.schedule.daysOfWeek.length > 0) {
        if (!routine.schedule.daysOfWeek.includes(now.getDay())) continue;
      }

      /* Check time window (±30 minutes of timeHint). */
      if (routine.schedule.timeHint) {
        const [hh, mm] = routine.schedule.timeHint.split(":").map(Number);
        const hintMinutes = hh * 60 + mm;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (Math.abs(nowMinutes - hintMinutes) > 30) continue;
      }

      /* Due — run it. */
      console.log(`[doppel] routine due: "${routine.title}"`);
      runNow(routine.id).catch((err) => {
        console.error(`[doppel] routine failed: ${err.message}`);
      });
    }
  }, 10 * 60_000);
}

function stopScheduler() {
  if (scheduler) {
    clearInterval(scheduler);
    scheduler = null;
  }
}

module.exports = {
  proposals,
  accept,
  reject,
  remove,
  toggle,
  list,
  runNow,
  startScheduler,
  stopScheduler,
  inferSchedule,
};
