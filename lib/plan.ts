import type { ObservedPath, Routine, RoutineStep } from "./types";

/**
 * The plan for the next run.
 *
 * Mimic stores an intent and the paths it has watched. What appears on screen
 * is derived here — the dominant path, re-ordered and re-parameterised by
 * everything the user has taught it. It is never a recording played back.
 */

export function dominantPath(routine: Routine): ObservedPath | undefined {
  return [...(routine.observedPaths ?? [])].sort(
    (a, b) => b.seenCount - a.seenCount || b.lastSeen - a.lastSeen,
  )[0];
}

export function planFor(routine: Routine): RoutineStep[] {
  const ids = routine.order?.length
    ? routine.order
    : (dominantPath(routine)?.stepIds ?? routine.stepLibrary.map((s) => s.id));
  return ids
    .map((id) => routine.stepLibrary.find((s) => s.id === id))
    .filter((s): s is RoutineStep => Boolean(s));
}

/** The steps that will actually execute, once the user's skips are honoured. */
export function activePlan(routine: Routine): RoutineStep[] {
  return planFor(routine).filter((s) => !routine.skipped?.includes(s.id));
}

export function hardRuleSteps(routine: Routine): RoutineStep[] {
  return planFor(routine).filter((s) => s.hardRule);
}

export function alternatePaths(routine: Routine): ObservedPath[] {
  const dominant = dominantPath(routine);
  return (routine.observedPaths ?? []).filter((p) => p.id !== dominant?.id);
}

export function guessCount(routine: Routine): number {
  return activePlan(routine).filter((s) => s.certainty === "guessing").length;
}

/** Eligible for the second graduation: trusted, proven with you present, not drifting. */
export function unattendedEligible(routine: Routine): boolean {
  return (
    routine.stage === "trusted" &&
    !routine.drifting &&
    routine.presentRunsPassed >= routine.presentRunsRequired
  );
}

/** A short, human summary of what a step will really do. */
export function actionSummary(step: RoutineStep): string {
  const a = step.action;
  const base = (p?: string) => (p ? p.split(/[\\/]/).pop() : "");
  switch (a.kind) {
    case "move":
      return `${a.match} from ${base(a.from)} into ${base(a.to)}`;
    case "rename":
      return `${a.match} in ${base(a.dir)}`;
    case "copy":
      return `${a.match} from ${base(a.from)} into ${base(a.to)}`;
    case "trash":
      return `${a.match} out of ${base(a.dir)}`;
    case "await-file":
      return `waits for ${a.match} in ${base(a.dir)}`;
    case "open":
      return `opens ${base(a.file) || a.match}`;
    case "activate":
      return `brings up ${a.match}`;
    case "type":
      return `types into the window in front`;
    case "hotkey":
      return `presses ${a.keys}`;
    case "click":
      return `clicks at ${a.x}, ${a.y}`;
    case "wait":
      return `waits ${Math.round((a.ms ?? 300) / 100) / 10}s`;
    default:
      return "watches, but doesn't act";
  }
}
