export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Relative, plain-language time. Kept relative on purpose: it reads the way
 * Doppel talks, and it keeps the prototype free of timezone accidents.
 */
export function ago(then: number | undefined, now: number): string {
  if (then === undefined) return "not yet";
  const delta = Math.max(0, now - then);
  if (delta < 90 * 1000) return "just now";
  const mins = Math.round(delta / MIN);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(delta / HOUR);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(delta / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${DAY_NAMES[new Date(then).getUTCDay()]}`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

export function minutesSince(then: number, now: number) {
  return Math.max(0, Math.floor((now - then) / MIN));
}

