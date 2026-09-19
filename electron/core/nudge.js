const { randomUUID } = require("node:crypto");

const brain = require("./brain");
const claude = require("./claude");

/**
 * The nudge system — the piece that makes Doppel proactive.
 *
 * After every vision look, `evaluate()` checks whether Doppel has something
 * worth saying without being asked. The result is a nudge: a short message
 * in Doppel's voice, optionally with an action the user can take.
 *
 * The rule is simple: speak up when you know something useful, shut up when
 * you don't. A nudge that fires every minute is a notification; one that
 * fires when it matters is an assistant.
 */

/** How long between any two nudges, regardless of type. */
const GLOBAL_COOLDOWN_MS = 3 * 60_000;

/** How long before the same kind of nudge may fire again. */
const KIND_COOLDOWN_MS = 10 * 60_000;

/** Most active nudges before oldest is auto-dismissed. */
const MAX_ACTIVE = 3;

/** How many consecutive low-salience looks before a stuck nudge. */
const STUCK_THRESHOLD = 3;

/** Minimum recall score to consider a memory match meaningful. */
const MEMORY_MATCH_THRESHOLD = 2.5;

/* ------------------------------------------------------------ mutable state */

let publish = () => {};
const active = [];
const lastByKind = {};
let lastNudgeAt = 0;
let lowSalienceRun = 0;
let lastWindow = null;

/* -------------------------------------------------------------------- init */

function init(publisher) {
  publish = publisher ?? (() => {});
}

/* ------------------------------------------------------------- evaluation */

/**
 * Called after every vision look. Decides whether to surface a nudge.
 *
 * This is deliberately cheap — mostly local checks. The only API call is
 * for the rare `offer` nudge, and even that uses effort: "low".
 */
async function evaluate(episode, narration) {
  if (!episode || narration.sensitive) return;

  const now = Date.now();
  if (now - lastNudgeAt < GLOBAL_COOLDOWN_MS) return;

  /* Track consecutive low-salience looks for stuck detection.
     Reset when the window changes. */
  const windowKey = `${episode.app}|${episode.window}`;
  if (windowKey !== lastWindow) {
    lowSalienceRun = 0;
    lastWindow = windowKey;
  }
  if (episode.salience < 0.3) lowSalienceRun++;
  else lowSalienceRun = 0;

  /* Try each detector in priority order. First one wins. */

  const nudge =
    checkTaskEnd(episode, now) ??
    checkStuck(episode, now) ??
    (await checkMemory(episode, now)) ??
    checkOpenThreads(episode, now);

  if (!nudge) return;

  push(nudge);
}

/* ------------------------------------------------------------- detectors */

function checkTaskEnd(episode, now) {
  if (episode.boundary !== "end") return null;
  if (!allowed("task-end", now)) return null;

  return make("task-end", {
    text: episode.intent
      ? `Looks like you've finished ${episode.intent.toLowerCase()}.`
      : "Looks like that piece of work is done.",
    detail: null,
    action: null,
    episodeId: episode.id,
    at: now,
  });
}

function checkStuck(episode, now) {
  if (lowSalienceRun < STUCK_THRESHOLD) return null;
  if (!allowed("stuck", now)) return null;

  return make("stuck", {
    text: "You've been on this screen for a while and not much is changing. Need a hand?",
    detail: episode.location || episode.app || null,
    action: "Tell me more",
    episodeId: episode.id,
    at: now,
  });
}

async function checkMemory(episode, now) {
  if (!allowed("memory", now)) return null;
  if (!episode.activity || episode.salience < 0.4) return null;

  /* Use the synchronous lexical recall — fast and free. Semantic recall is
     async and heavier; only use it if the lexical pass finds something
     promising. */
  const pack = brain.recall(episode.activity, { limit: 5, budgetTokens: 800, now });

  /* Filter out the episode itself and anything from the last 10 minutes. */
  const relevant = pack.episodes.filter(
    (e) => e.id !== episode.id && Math.abs(e.at - episode.at) > 10 * 60_000,
  );

  if (relevant.length === 0) return null;

  const best = relevant[0];
  const age = describeAge(best.at, now);

  /* If there's a strong match with similar entities or location, this
     could be a repeated task — offer to handle it. */
  const sameEntities =
    episode.entityIds?.length > 0 &&
    best.entityIds?.some((id) => episode.entityIds.includes(id));
  const sameLocation = best.location && best.location === episode.location;

  if (sameEntities || sameLocation) {
    if (allowed("offer", now)) {
      return make("offer", {
        text: `I've seen you do this before, ${age}. Want me to handle it?`,
        detail: best.activity,
        action: "Do it",
        episodeId: episode.id,
        at: now,
      });
    }
  }

  return make("memory", {
    text: `I remember this. ${age}, ${best.activity.charAt(0).toLowerCase()}${best.activity.slice(1)}`,
    detail: null,
    action: "Show me",
    episodeId: episode.id,
    at: now,
  });
}

function checkOpenThreads(episode, now) {
  if (!allowed("open-thread", now)) return null;
  if (!episode.intent) return null;

  const digests = brain.recentDigests(4);
  const intentWords = new Set(brain.tokenize(episode.intent));

  for (const digest of digests) {
    for (const thread of digest.openThreads ?? []) {
      const threadWords = brain.tokenize(thread);
      const overlap = threadWords.filter((w) => intentWords.has(w)).length;
      if (overlap >= 2) {
        const age = describeAge(digest.at, now);
        return make("open-thread", {
          text: `${age}, you left something unfinished: ${thread}`,
          detail: null,
          action: "Tell me more",
          episodeId: episode.id,
          at: now,
        });
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------ management */

function push(nudge) {
  /* Enforce max active — oldest goes first. */
  while (active.length >= MAX_ACTIVE) active.shift();

  active.push(nudge);
  lastNudgeAt = nudge.at;
  lastByKind[nudge.kind] = nudge.at;
  publish(snapshot());
}

function dismiss(id) {
  const idx = active.findIndex((n) => n.id === id);
  if (idx !== -1) active.splice(idx, 1);
  publish(snapshot());
}

/**
 * The user clicked a nudge's action button. Depending on the kind, this
 * triggers recall or starts the agent.
 */
function act(id) {
  const nudge = active.find((n) => n.id === id);
  if (!nudge) return { ok: false };
  dismiss(id);
  return { ok: true, nudge };
}

function snapshot() {
  return [...active];
}

/* ----------------------------------------------------------------- helpers */

function allowed(kind, now) {
  const last = lastByKind[kind] ?? 0;
  return now - last >= KIND_COOLDOWN_MS;
}

function make(kind, fields) {
  return { id: randomUUID(), kind, ...fields };
}

function describeAge(then, now) {
  const mins = Math.round((now - then) / 60_000);
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
}

module.exports = { init, evaluate, dismiss, act, snapshot };
