const db = require("./db");
const claude = require("./claude");
const screen = require("./screen");
const brain = require("./brain");
const nudge = require("./nudge");

/**
 * Looking at the screen and saying what it sees.
 *
 * This is the difference between an agent that knows *that* you switched to
 * Excel and one that knows you were reconciling October invoices and got stuck
 * on a formula. The window title gives you the first; only actually reading
 * the screen gives you the second.
 *
 * Two costs are managed carefully, because this runs all day:
 *
 *   tokens   the system prompt is a frozen cached prefix; only the screenshot
 *            and a one-line context note change per call. Screenshots go at
 *            1366px, the documented cost-effective size for this.
 *   privacy  Claude is asked to flag a sensitive screen before describing it,
 *            and the brain refuses to write details for anything so flagged.
 *            Nothing is ever sent anywhere except the Gemini API, and only
 *            while the user has this switched on.
 */

/** Don't look more often than this, however much the screen churns. */
const MIN_INTERVAL_MS = 3_000;
/** If nothing changes, look occasionally anyway — work happens inside one window. */
const IDLE_INTERVAL_MS = 60_000;
/** But back off when consecutive idle looks aren't worth much. */
const MAX_IDLE_MS = 300_000;
/** Below this salience, an idle look counts as "not much happening". */
const LOW_SALIENCE = 0.4;
/** A gap this long triggers a "welcome back" context recovery. */
const GAP_MS = 15 * 60_000;

let timer = null;
let running = false;
let runningPromise = null;
let lastLookAt = 0;
let captureFailCount = 0;
let lastWindowKey = "";
let pendingReason = null;
let onNarration = () => {};
/** Current idle interval — grows when consecutive idle looks are low-value. */
let currentIdleMs = IDLE_INTERVAL_MS;
let consecutiveLowIdle = 0;

/**
 * Screen change detection. Compare screenshots locally and skip the API call
 * when the screen hasn't changed, or use cheaper effort for minor changes.
 */
let lastScreenBase64 = "";
let unchangedCount = 0;
/** Below this diff %, treat as unchanged (cursor blink, clock tick, minor scroll). */
const DIFF_SKIP = 18;
/** Above this diff %, treat as a significant change (full effort). */
const DIFF_FULL = 28;

/**
 * Cheap text similarity: tokenize both strings, compute Jaccard overlap.
 * Returns true if ≥70% of the words are shared — meaning the model is
 * describing essentially the same screen. This runs *after* the API call
 * (can't avoid that cost) but prevents the observation from being recorded
 * and narrated, which is what clutters the feed.
 */
function textSimilar(a, b) {
  const tok = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean));
  const sa = tok(a);
  const sb = tok(b);
  if (sa.size === 0 || sb.size === 0) return false;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  return shared / Math.max(sa.size, sb.size) >= 0.7;
}

/* --------------------------------------------------------------------------- */

const SYSTEM = `You are Doppel's visual cortex — an agent on one person's machine that learns how they work. You turn screenshots into searchable memory. The screenshot is discarded after you answer; if you don't write it, it's gone.

Record:
- **Activity**: What they're doing, specifically. Not "spreadsheet open" but "reconciling October invoices, stuck on row 340".
- **Text**: Meaningful text verbatim — headings, field values, errors, file names, queries. Skip chrome/toolbars.
- **Figures**: All numbers that matter — amounts, dates, IDs, versions, counts. Exact.
- **Location**: App, document, specific view/sheet/folder/thread. Enough to navigate back.
- **Changed**: What differs from prior observations.
- **Entities**: Named people, clients, projects, apps that are fixtures, not passing mentions.

**Salience**: Use the full 0-1 range honestly. Most screens (idle, settings, empty desktop) score low. Real work scores high. If everything is 0.8 the memory becomes noise.

**Redundancy**: You see your last few observations. If the screen is essentially the same — same app, document, task, nothing new — set salience 0 and leave activity empty. Only write again for genuinely new content: different document, new error, new numbers, changed task.

**Sensitive**: Mark sensitive and leave all other fields empty if you see: passwords, credentials, card/account numbers, medical/legal records, private messages, identity documents. When in doubt, mark sensitive.

Voice: first person, warm, understated, short sentences. Admit uncertainty ("looks like", "can't read"). Never guess numbers. No emoji.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "sensitive",
    "activity",
    "intent",
    "detail",
    "location",
    "text",
    "figures",
    "changed",
    "entities",
    "salience",
    "boundary",
  ],
  properties: {
    sensitive: {
      type: "boolean",
      description: "True if this screen must not be described or remembered at all.",
    },
    activity: {
      type: "string",
      description: "What the person is doing, specifically. Empty if sensitive.",
    },
    intent: {
      type: "string",
      description: "What they seem to be trying to achieve. Empty if unclear or sensitive.",
    },
    detail: {
      type: "string",
      description: "Anything else worth remembering that the other fields don't cover.",
    },
    location: {
      type: "string",
      description:
        "Where on the machine this is: application, document, and the specific view, sheet, " +
        "folder, thread or record. Enough to navigate back to.",
    },
    text: {
      type: "array",
      description:
        "The meaningful text on screen, quoted exactly. Headings, field labels and values, " +
        "the sentence being typed, error messages, subject lines, file names, search queries. " +
        "Not menus or toolbars. Empty if sensitive.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what", "value"],
        properties: {
          what: { type: "string", description: "What this text is, e.g. 'error message'." },
          value: { type: "string", description: "The text itself, verbatim." },
        },
      },
    },
    figures: {
      type: "array",
      description:
        "Numbers and identifiers that carry meaning: amounts, totals, dates, reference and " +
        "invoice numbers, versions, counts, times. Exact. Empty if sensitive.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what", "value"],
        properties: {
          what: { type: "string", description: "What the figure is." },
          value: { type: "string", description: "The figure exactly as shown." },
        },
      },
    },
    changed: {
      type: "string",
      description:
        "What is different from the previous observations shown to you. Empty if nothing " +
        "obviously changed or there is nothing to compare against.",
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name", "note"],
        properties: {
          kind: {
            type: "string",
            enum: ["person", "client", "project", "app", "file", "account", "thing"],
          },
          name: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    salience: {
      type: "number",
      description: "0 for a screen not worth remembering, 1 for genuinely important work.",
    },
    boundary: {
      type: "string",
      enum: ["start", "middle", "end", "none"],
      description: "Whether this looks like the start, middle or end of a piece of work.",
    },
  },
};

/* --------------------------------------------------------------------------- */

/**
 * `force` covers a look the user explicitly asked for, which should happen
 * even when the automatic cadence is switched off — but never when observation
 * is paused or the permission hasn't been granted.
 */
function allowed({ force = false } = {}) {
  const state = db.get();
  if (state.observation.paused) return false;
  if (state.permissions.screen !== true) return false;
  if (!claude.configured()) return false;
  if (!force && state.ai?.autoWatch === false) return false;
  return true;
}

/** Take one look. Returns the observation, or a reason it didn't happen. */
async function look({ reason = "scheduled", force = false } = {}) {
  if (running) {
    /* If the user explicitly asked, wait for the current look to finish
       then take a fresh one instead of bouncing with "busy". */
    if (force && runningPromise) {
      await runningPromise;
      return look({ reason, force });
    }
    return { ok: false, reason: "busy" };
  }
  if (!allowed({ force })) return { ok: false, reason: whyNot() };
  if (!force && Date.now() - lastLookAt < MIN_INTERVAL_MS) {
    return { ok: false, reason: "too-soon" };
  }

  running = true;
  const doLook = async () => {
  try {
    const thorough = db.get().ai?.detail !== "light";

    /* Reading small print needs pixels. The light setting trades that for a
       third of the token cost per look. */
    const shot = await screen.capture({ maxEdge: thorough ? 1600 : 1366 });
    if (!shot.ok) {
      captureFailCount++;
      lastLookAt = Date.now(); /* prevent immediate retry */
      return { ok: false, reason: "no-screen", detail: shot.detail };
    }
    captureFailCount = 0;

    /* Compare the screenshot locally. A pixel diff below DIFF_SKIP means
       nothing worth noticing changed (cursor blink, clock tick). Between
       DIFF_SKIP and DIFF_FULL is a minor change — use cheaper effort.
       Above DIFF_FULL is a real context switch — full effort. */
    const diff = lastScreenBase64
      ? screen.diffPercent(lastScreenBase64, shot.base64)
      : 100;

    if (!force && diff < DIFF_SKIP) {
      unchangedCount++;
      lastLookAt = Date.now();
      return { ok: false, reason: "unchanged" };
    }
    lastScreenBase64 = shot.base64;
    unchangedCount = 0;

    const majorChange = diff >= DIFF_FULL;

    /* Context recovery: if enough time has passed since our last look, build
       a "welcome back" summary from what happened before the gap. This is
       what makes coming back to the desk feel like someone kept notes. */
    const gap = lastLookAt > 0 ? Date.now() - lastLookAt : 0;
    if (gap >= GAP_MS) {
      const before = brain
        .recentEpisodes(6)
        .filter((e) => !e.sensitive && e.activity);
      if (before.length > 0) {
        const last = before[0];
        const gapMins = Math.round(gap / 60_000);
        const recoveryText =
          gapMins >= 60
            ? `Welcome back. You've been away about ${Math.round(gapMins / 60)} ${gapMins >= 120 ? "hours" : "hour"}. `
            : `Welcome back. You've been away about ${gapMins} minutes. `;
        const recovery = {
          id: `recovery-${Date.now()}`,
          at: Date.now(),
          app: last.app,
          text: recoveryText + `Before you left: ${last.activity.charAt(0).toLowerCase()}${last.activity.slice(1)}`,
          intent: last.intent || "",
          salience: 0.7,
          sensitive: false,
          reason: "context recovery",
          recovery: true,
        };
        recordNarration(recovery);
        onNarration(recovery);
      }
    }

    /* Give it the last few observations so "what changed" is answerable and
       it doesn't re-transcribe a screen it already described. */
    const recent = brain
      .recentEpisodes(3)
      .filter((e) => !e.sensitive && e.activity)
      .reverse()
      .map((e) => `- ${new Date(e.at).toISOString().slice(11, 16)} ${e.activity}`)
      .join("\n");

    const result = await claude.ask({
      system: SYSTEM,
      effort: "low",
      thinking: false,
      maxTokens: majorChange ? 1000 : 600,
      fast: true,
      schema: SCHEMA,
      messages: [
        {
          role: "user",
          content: [
            screen.asImageBlock(shot),
            {
              type: "text",
              text:
                `Their screen right now, ${shot.width}x${shot.height}.` +
                (recent ? `\n\nWhat I saw just before this:\n${recent}` : "") +
                `\n\nRead it and write down everything worth keeping.`,
            },
          ],
        },
      ],
    });

    lastLookAt = Date.now();

    if (!result.ok) {
      if (result.reason === "refused") {
        /* A refusal on a screenshot is usually a screen we shouldn't be
           reading anyway. Record the moment, not the content. */
        brain.remember({
          kind: "screen",
          at: shot.at,
          sensitive: true,
          salience: 0.1,
        });
      }
      return result;
    }

    const observation = result.value;

    /* The model was told to return empty activity / salience 0 when the
       screen hasn't meaningfully changed. Honour that — don't record noise. */
    if (!force && !observation.sensitive && !observation.activity && observation.salience <= 0) {
      lastLookAt = Date.now();
      return { ok: false, reason: "redundant" };
    }

    /* Text-level dedup: if this observation's activity is essentially the
       same as a recent one, skip it. The pixel diff catches identical frames
       but misses "same document, minor scroll" where the model rephrases
       the same thought. This saves the tokens we'd spend recording it. */
    if (!force && !observation.sensitive && observation.activity) {
      const recentActivities = brain
        .recentEpisodes(3)
        .filter((e) => !e.sensitive && e.activity)
        .map((e) => e.activity);
      if (recentActivities.some((prev) => textSimilar(prev, observation.activity))) {
        lastLookAt = Date.now();
        return { ok: false, reason: "redundant" };
      }
    }

    const context = currentWindow();

    const episode = brain.remember({
      kind: "screen",
      at: shot.at,
      app: context.app,
      window: context.title,
      activity: observation.activity,
      intent: observation.intent,
      detail: observation.detail,
      location: observation.location,
      changed: observation.changed,
      /* The exact words and numbers, which is what makes recall able to find
         "invoice 4471" months later rather than "some invoice work". */
      fragments: [
        ...(observation.text ?? []).map((t) => ({ ...t, kind: "text" })),
        ...(observation.figures ?? []).map((f) => ({ ...f, kind: "figure" })),
      ],
      entities: observation.entities,
      salience: observation.salience,
      sensitive: observation.sensitive,
      boundary: observation.boundary,
    });

    /* Adaptation narration: when the same intent shows up in a different
       place, that's proof Doppel follows the intent, not the layout. Worth
       saying so — it's a product differentiator the user should see. */
    let adaptationNote = null;
    if (!observation.sensitive && observation.intent) {
      const prev = brain
        .recentEpisodes(20)
        .find(
          (e) =>
            !e.sensitive &&
            e.intent &&
            e.intent === observation.intent &&
            e.location &&
            observation.location &&
            e.location !== observation.location,
        );
      if (prev) {
        adaptationNote =
          `Same work, different place. Last time this was in ${prev.location}; ` +
          `now it's ${observation.location}. The intent hasn't changed, so neither has mine.`;
      }
    }

    const narration = {
      id: episode.id,
      at: episode.at,
      app: context.app,
      text: observation.sensitive
        ? "Something private is on screen. I've looked away."
        : observation.activity,
      intent: observation.sensitive ? "" : observation.intent,
      adaptation: adaptationNote,
      salience: observation.salience,
      sensitive: Boolean(observation.sensitive),
      reason,
      usage: result.usage,
    };

    recordNarration(narration);
    onNarration(narration);
    if (db.get().nudges?.enabled !== false) {
      nudge.evaluate(episode, narration);
    }

    return { ok: true, observation, episode, narration };
  } catch (err) {
    return { ok: false, reason: "error", detail: claude.describe(err) };
  } finally {
    running = false;
    runningPromise = null;
  }
  };
  runningPromise = doLook();
  return runningPromise;
}

/** Say plainly why a look didn't happen, so the interface can be honest. */
function whyNot() {
  const state = db.get();
  if (state.observation.paused) return "paused";
  if (state.permissions.screen !== true) return "no-permission";
  if (!claude.configured()) return "no-key";
  return "not-allowed";
}

/** The last window we were told about, for labelling the observation. */
let latestWindow = { app: null, title: null };
const noteWindow = (w) => {
  latestWindow = { app: w.app, title: w.title };
  const key = `${w.app}|${w.title}`;
  if (key !== lastWindowKey) {
    lastWindowKey = key;
    pendingReason = "the window changed";
    /* A real context switch — reset everything so the first look in the
       new window happens immediately and isn't skipped by change detection. */
    currentIdleMs = IDLE_INTERVAL_MS;
    consecutiveLowIdle = 0;
    lastScreenBase64 = "";
  }
};
const currentWindow = () => latestWindow;

function recordNarration(entry) {
  db.update(
    (s) => {
      s.narration.unshift(entry);
      if (s.narration.length > 80) s.narration.length = 80;
      s.stats.looks = (s.stats.looks ?? 0) + 1;
      if (entry.usage) {
        s.stats.visionTokens =
          (s.stats.visionTokens ?? 0) +
          (entry.usage.input_tokens ?? 0) +
          (entry.usage.output_tokens ?? 0);
      }
    },
    { silent: true },
  );
}

/* --------------------------------------------------------------------------- */

/**
 * The watching loop.
 *
 * It looks when the window changes (the moment most likely to be a new piece
 * of work) and otherwise on a slow idle cadence, so long stretches inside one
 * application still get noticed.
 */
function start(handler) {
  onNarration = handler ?? (() => {});
  stop();
  currentIdleMs = IDLE_INTERVAL_MS;
  consecutiveLowIdle = 0;
  timer = setInterval(async () => {
    if (!allowed()) return;
    /* If captures keep failing (GPU busy, display off), back off hard.
       This applies to ALL looks including window changes — hammering a
       GPU that's already struggling just produces more DXGI errors. */
    if (captureFailCount > 0) {
      const backoffMs = Math.min(MAX_IDLE_MS, MIN_INTERVAL_MS * Math.pow(3, captureFailCount));
      if (Date.now() - lastLookAt < backoffMs) return;
    }
    const since = Date.now() - lastLookAt;
    const reason = pendingReason;
    if (reason && since >= MIN_INTERVAL_MS) {
      pendingReason = null;
      await look({ reason });
    } else if (since >= currentIdleMs) {
      const result = await look({ reason: "nothing had changed for a while" });
      /* If the idle look wasn't worth much, back off so we don't keep
         describing the same screen every 90 seconds. Resets on the next
         real window change in noteWindow(). */
      if (result?.ok && result.observation) {
        const sal = result.observation.salience ?? 0;
        if (sal < LOW_SALIENCE) {
          consecutiveLowIdle++;
          currentIdleMs = Math.min(MAX_IDLE_MS, IDLE_INTERVAL_MS * Math.pow(2, consecutiveLowIdle));
        } else {
          consecutiveLowIdle = 0;
          currentIdleMs = IDLE_INTERVAL_MS;
        }
      }
    }
  }, 2000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, look, noteWindow, MIN_INTERVAL_MS };
