const crypto = require("node:crypto");

const db = require("./db");
const claude = require("./claude");
const brain = require("./brain");
const vision = require("./vision");

/**
 * Workflow recording — "watch me do this".
 *
 * The user says "watch me do this", demonstrates a task, and says "done".
 * During recording, Doppel captures the screen at high frequency (every
 * look forced, no dedup skips). When recording stops, the captured
 * episodes are distilled into a step-by-step procedure that becomes a
 * routine the user can replay.
 *
 * This is the thing no competitor has: Doppel learns by watching the
 * user once, not by being programmed. The procedure is written in
 * natural language, which means the agent adapts to layout changes
 * rather than breaking on pixel offsets.
 */

const LOOK_INTERVAL_MS = 4_000;

let session = null;
let lookTimer = null;

/* ----------------------------------------------------------------- session */

/**
 * Start a recording session.
 *
 * @param {string} [title] - Optional description of what the user is about to do.
 * @returns {{ ok: boolean, sessionId?: string }}
 */
function start(title) {
  if (session) return { ok: false, detail: "Already recording." };
  if (!claude.configured()) return { ok: false, detail: "Need an API key first." };

  session = {
    id: crypto.randomUUID(),
    title: title || "",
    startedAt: Date.now(),
    episodeIds: [],
  };

  /* Force a look every few seconds — no dedup, no skipping. */
  lookTimer = setInterval(() => {
    const allowed =
      !db.get().observation.paused &&
      db.get().permissions.screen &&
      claude.configured();
    if (!allowed) return;

    vision.look({ reason: "recording", force: true }).then((result) => {
      if (!session) return;
      if (result?.ok && result.episode) {
        session.episodeIds.push(result.episode.id);
      }
    });
  }, LOOK_INTERVAL_MS);

  /* Take the first look immediately. */
  vision.look({ reason: "recording started", force: true }).then((result) => {
    if (!session) return;
    if (result?.ok && result.episode) {
      session.episodeIds.push(result.episode.id);
    }
  });

  return { ok: true, sessionId: session.id };
}

/**
 * Stop recording and distill the captured episodes into a procedure.
 *
 * @returns {Promise<{ ok: boolean, procedure?: object, detail?: string }>}
 */
async function stop() {
  if (!session) return { ok: false, detail: "Not recording." };

  /* Stop the forced-look timer. */
  if (lookTimer) {
    clearInterval(lookTimer);
    lookTimer = null;
  }

  const captured = { ...session };
  session = null;

  if (captured.episodeIds.length < 2) {
    return { ok: false, detail: "Too short — I need at least two observations to learn from." };
  }

  /* Gather the recorded episodes. */
  const allEpisodes = brain.recentEpisodes(2000);
  const steps = allEpisodes
    .filter((e) => captured.episodeIds.includes(e.id))
    .sort((a, b) => a.at - b.at)
    .map((e) => ({
      at: e.at,
      app: e.app,
      window: e.window,
      activity: e.activity,
      intent: e.intent,
      detail: e.detail,
      location: e.location,
      changed: e.changed,
      fragments: e.fragments,
    }));

  /* Ask Claude to distill the recording into a replayable procedure. */
  const procedure = await distill(captured.title, steps);
  if (!procedure.ok) return procedure;

  return {
    ok: true,
    sessionId: captured.id,
    procedure: procedure.value,
    episodeCount: steps.length,
    durationSec: Math.round((steps[steps.length - 1].at - steps[0].at) / 1000),
  };
}

/**
 * Is a recording in progress?
 */
function active() {
  if (!session) return null;
  return {
    sessionId: session.id,
    title: session.title,
    startedAt: session.startedAt,
    steps: session.episodeIds.length,
    durationSec: Math.round((Date.now() - session.startedAt) / 1000),
  };
}

/**
 * Abort a recording without distilling.
 */
function abort() {
  if (!session) return { ok: false };
  if (lookTimer) {
    clearInterval(lookTimer);
    lookTimer = null;
  }
  session = null;
  return { ok: true };
}

/* ------------------------------------------------------------ distillation */

const DISTILL_SYSTEM = `You are Doppel, a personal agent that learns tasks by watching one person do them once.

You are shown a timestamped sequence of screen observations from a recording session. The user demonstrated a task; your job is to turn that into a **replayable procedure** — clear enough that another agent (you, later) can carry it out unassisted.

Write the procedure as numbered steps in natural language. Each step should describe:
- What to do (the action, not a pixel location)
- Where to do it (the app, the menu, the field name)
- What to expect (the result, so the agent knows it worked)

Focus on the **intent** and **what** of each step, not the exact screen coordinates or the exact text being typed. The procedure should survive layout changes and work the next day.

If the recording shows a task that uses specific data (file names, values, people), parameterise it: use placeholders like [filename], [date], [recipient] so the routine works with different inputs.

Be concise. A five-step task should have five steps, not fifteen.`;

const DISTILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "steps", "app", "parameters", "summary"],
  properties: {
    title: {
      type: "string",
      description: "A short name for this procedure. Not a sentence.",
    },
    app: {
      type: "string",
      description: "The primary application this procedure runs in.",
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "location", "expected"],
        properties: {
          action: {
            type: "string",
            description: "What to do, clearly enough to execute.",
          },
          location: {
            type: "string",
            description: "Where in the app — menu, field, button, panel.",
          },
          expected: {
            type: "string",
            description: "What should happen if the step worked.",
          },
        },
      },
    },
    parameters: {
      type: "array",
      description: "Placeholders used in the steps, so the routine can be parameterised.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "example"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          example: { type: "string" },
        },
      },
    },
    summary: {
      type: "string",
      description:
        "A one-sentence description of the whole procedure, for the user to read.",
    },
  },
};

async function distill(title, steps) {
  const stepsText = steps
    .map(
      (s, i) =>
        `[${i + 1}] ${new Date(s.at).toISOString().slice(11, 19)} | ` +
        `${s.app ?? "unknown"} — ${s.activity || s.intent || "(no activity)"}` +
        (s.location ? ` | location: ${s.location}` : "") +
        (s.changed ? ` | changed: ${s.changed}` : "") +
        (s.detail ? ` | ${s.detail}` : ""),
    )
    .join("\n");

  const userContent =
    (title ? `The user said this is: "${title}"\n\n` : "") +
    `Here are the ${steps.length} observations from the recording:\n\n${stepsText}\n\n` +
    `Turn this into a replayable procedure.`;

  const result = await claude.ask({
    system: DISTILL_SYSTEM,
    messages: [{ role: "user", content: userContent }],
    schema: DISTILL_SCHEMA,
    effort: claude.EFFORT.plan,
    maxTokens: 3000,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    value: {
      ...result.value,
      recordedAt: Date.now(),
      episodeCount: steps.length,
    },
  };
}

/**
 * Save a distilled procedure as a routine.
 */
function saveAsRoutine(procedure) {
  const routine = {
    id: crypto.randomUUID(),
    patternId: `recorded-${Date.now()}`,
    instruction: procedureToInstruction(procedure),
    title: procedure.title,
    sourceApp: procedure.app,
    schedule: { kind: "manual", timeHint: "", daysOfWeek: [] },
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

/**
 * Convert a distilled procedure into a natural language instruction
 * that the agent can follow.
 */
function procedureToInstruction(procedure) {
  const params = (procedure.parameters ?? [])
    .map((p) => `  - ${p.name}: ${p.description} (e.g. "${p.example}")`)
    .join("\n");

  const steps = (procedure.steps ?? [])
    .map(
      (s, i) =>
        `${i + 1}. ${s.action}` +
        (s.location ? ` (in ${s.location})` : "") +
        (s.expected ? ` → expect: ${s.expected}` : ""),
    )
    .join("\n");

  return (
    `In ${procedure.app}: ${procedure.summary}\n\n` +
    (params ? `Parameters:\n${params}\n\n` : "") +
    `Steps:\n${steps}`
  );
}

module.exports = {
  start,
  stop,
  active,
  abort,
  saveAsRoutine,
  distill,
};
