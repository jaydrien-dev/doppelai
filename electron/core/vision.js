const db = require("./db");
const claude = require("./claude");
const screen = require("./screen");
const brain = require("./brain");

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
 *            Nothing is ever sent anywhere except Anthropic's API, and only
 *            while the user has this switched on.
 */

/** Don't look more often than this, however much the screen churns. */
const MIN_INTERVAL_MS = 12_000;
/** If nothing changes, look occasionally anyway — work happens inside one window. */
const IDLE_INTERVAL_MS = 90_000;

let timer = null;
let running = false;
let lastLookAt = 0;
let lastWindowKey = "";
let pendingReason = null;
let onNarration = () => {};

/* --------------------------------------------------------------------------- */

const SYSTEM = `You are the visual cortex of an agent called Mimic that runs on one person's computer and learns how they work, so it can eventually do parts of their work for them.

You are shown a screenshot of their screen. You are not talking to the user — you are the part of Mimic that turns pixels into something it can remember, search, and act on months later. Everything you write goes into its memory verbatim. Nothing else is kept: after you answer, the screenshot is thrown away. If you don't write it down, it is gone.

So read the screen closely and record it in detail.

**What they're doing.** In plain language, specifically. Not "a spreadsheet is open" but "reconciling October invoices against the bank export, stuck on row 340 where the totals disagree". Say what they seem to be trying to achieve, which is usually bigger than the screen.

**The actual words.** Transcribe the text that carries meaning, exactly as written — headings, the row or record being worked on, field labels and their values, the sentence being typed, error messages word for word, button labels on anything mid-decision, subject lines, file names, tab titles, search queries. Prefer exact quotes to paraphrase; a number remembered approximately is worse than useless. Skip pure chrome: menu bars, toolbars, ambient UI, boilerplate.

**Numbers and identifiers.** Every figure that means something: amounts, totals, dates, invoice and reference numbers, versions, counts, times, percentages. Record them exactly, each with a word on what it is.

**Where they are.** The application, the document, the specific view, sheet, folder, thread or record. Enough that Mimic could navigate back to this exact place.

**What changed** since the previous observations you're shown, if anything. This is how Mimic learns sequences rather than snapshots.

**The lasting things.** Named people, clients, projects, recurring documents, accounts. Only name something that looks like a fixture of their work, not a passing mention.

**Salience.** Score honestly and use the whole range. Most screens are worth little — an empty desktop, idle scrolling, a settings dialog. Real work in progress is worth a lot. If everything scores 0.8 the memory becomes noise and recall stops working.

**Sensitive screens override all of the above.** Mark sensitive and write nothing else — leave every other field empty — if you can see: a password, PIN or credential field; card numbers, account numbers, sort codes or payment details; medical or legal records; someone's private messages; identity documents; anything that is plainly somebody else's confidential information. Do not transcribe it "just in case" and do not describe it in general terms. Mimic will record that a moment happened and nothing more. When in doubt, mark it sensitive — the cost of over-marking is one forgotten minute, and the cost of under-marking is a password written into a file that lives forever.

Write the prose fields in Mimic's voice: first person, warm, understated, slightly dry. Short sentences. Admit uncertainty freely — "looks like", "I think", "can't read the small print" — rather than inventing detail you cannot actually see. Never guess at a number you can't read. Never use exclamation marks or emoji.`;

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
  if (running) return { ok: false, reason: "busy" };
  if (!allowed({ force })) return { ok: false, reason: whyNot() };
  if (!force && Date.now() - lastLookAt < MIN_INTERVAL_MS) {
    return { ok: false, reason: "too-soon" };
  }

  running = true;
  try {
    const thorough = db.get().ai?.detail !== "light";

    /* Reading small print needs pixels. The light setting trades that for a
       third of the token cost per look. */
    const shot = await screen.capture({ maxEdge: thorough ? 2200 : 1366 });
    if (!shot.ok) return { ok: false, reason: "no-screen", detail: shot.detail };

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
      effort: thorough ? claude.EFFORT.plan : claude.EFFORT.observe,
      maxTokens: thorough ? 4000 : 1500,
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

    const narration = {
      id: episode.id,
      at: episode.at,
      app: context.app,
      text: observation.sensitive
        ? "Something private is on screen. I've looked away."
        : observation.activity,
      intent: observation.sensitive ? "" : observation.intent,
      salience: observation.salience,
      sensitive: Boolean(observation.sensitive),
      reason,
      usage: result.usage,
    };

    recordNarration(narration);
    onNarration(narration);

    return { ok: true, observation, episode, narration };
  } catch (err) {
    return { ok: false, reason: "error", detail: claude.describe(err) };
  } finally {
    running = false;
  }
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
  timer = setInterval(async () => {
    if (!allowed()) return;
    const since = Date.now() - lastLookAt;
    const reason = pendingReason;
    if (reason && since >= MIN_INTERVAL_MS) {
      pendingReason = null;
      await look({ reason });
    } else if (since >= IDLE_INTERVAL_MS) {
      await look({ reason: "nothing had changed for a while" });
    }
  }, 4000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, look, noteWindow, MIN_INTERVAL_MS };
