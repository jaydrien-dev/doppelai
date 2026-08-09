const crypto = require("node:crypto");

const db = require("./db");
const claude = require("./claude");
const screenLib = require("./screen");
const brain = require("./brain");
const actions = require("./actions");
const win32 = require("./win32");
const keys = require("./keys");

/**
 * Mimic's hands.
 *
 * A task runs as an agent loop: Claude looks at the screen, decides on an
 * action, we carry it out, and it looks again. It has three kinds of tool —
 * the computer itself, the guarded file operations, and its own memory.
 *
 * The important design decision is that **the agent does not get its own
 * permission model**. Every file action still goes through actions.js, so the
 * folder allowlist, the trash-instead-of-delete rule, and the inverse journal
 * all apply exactly as they do to a supervised routine. Anything that trips a
 * hard rule suspends the loop and waits for a human answer — including when
 * nobody is watching, in which case it waits rather than assuming yes.
 *
 * Claude Opus 5 verifies its own work without being asked, so this prompt
 * deliberately contains no "double-check your work" instruction; adding one
 * makes it over-verify. It does contain scope discipline and a conciseness
 * instruction, both of which it needs.
 */

const MAX_STEPS = 40;
const MAX_TOKENS = 8000;
const COMPUTER_BETA = "computer-use-2025-11-24";

let current = null;
let pendingApproval = null;
let publish = () => {};

const setPublisher = (fn) => {
  publish = fn;
};
const snapshot = () => (current ? JSON.parse(JSON.stringify(current)) : null);
const emit = () => publish(snapshot());

/* ------------------------------------------------------------------ prompts */

const SYSTEM = `You are Mimic, an agent that works on one person's computer, on their behalf, using their own applications and their own logged-in sessions.

You can see their screen and you can drive it: move the pointer, click, type, press keys, scroll. You can also move, rename, copy and archive files through a separate guarded tool, and you can search your own memory of watching this person work.

# How to work
Look before you act. Take a screenshot first and after anything that changes what is on screen, because the machine is not in the state you last imagined it.

Prefer the guarded file tool over driving a file manager by hand. It is faster, it cannot miss, and every operation it performs can be undone. Reach for the pointer and keyboard when the work genuinely lives inside an application.

Work at the scope you were asked for. Interpret ambiguity the way a careful colleague would: make routine judgment calls yourself, and stop and ask only when different readings would lead to materially different work. If you think the request is mistaken or there is a better approach, say so in a sentence and carry on with what was asked — do not quietly narrow, widen, or transform it. Finish the whole task, not just the easy part, and report completion only when it is genuinely done. If you cannot finish something, do the rest and say plainly what is missing and why.

# What you must not do quietly
Some actions stop and ask every time, whatever you have been trusted with: clearing a file away, anything you cannot undo, anything outside the folders you are allowed in, and anything you do not recognise. You do not need to police these yourself — the tools will refuse and tell you — but do not design plans that depend on them going through unattended.

If you get stuck, stop cleanly and say where you got to. Leaving work half-done and unreported is the worst outcome available to you; it is much better to stop early and explain.

# Talking to the person
Your text between tool calls is what they read while you work. Write it for a colleague who stepped away, not for a log file. Before your first action, say in one sentence what you are about to do. While working, speak up when you find something load-bearing or change direction — not to narrate routine clicks.

Keep it brief and readable. Lead with the outcome. Do not pad with caveats or restate what you just did if the result is obvious.

Voice: first person, warm, understated, slightly dry. Short sentences. Admit uncertainty freely. Never use exclamation marks or emoji, and never praise yourself.

Call the finish tool when the work is done or you have stopped.`;

/* -------------------------------------------------------------------- tools */

function toolsFor(shot) {
  return [
    {
      type: "computer_20251124",
      name: "computer",
      display_width_px: shot.width,
      display_height_px: shot.height,
    },
    {
      name: "file_action",
      description:
        "Perform a guarded file operation. Only works inside the folders the user has allowed. " +
        "Every operation records how to undo itself. Prefer this over driving a file manager by hand.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: {
            type: "string",
            enum: ["move", "rename", "copy", "trash", "zip", "mkdir", "open", "await-file"],
          },
          from: { type: "string", description: "Source folder, absolute." },
          to: { type: "string", description: "Destination folder, absolute." },
          dir: { type: "string", description: "The folder to work in, absolute." },
          file: { type: "string", description: "A specific file, absolute." },
          match: { type: "string", description: "Glob for which files, e.g. *.csv" },
          pattern: {
            type: "string",
            description: "For rename: 'Date first, then the old name' | 'The old name, then the date' | 'Leave the name alone'",
          },
        },
      },
    },
    {
      name: "recall",
      description:
        "Search your own memory of watching this person work — people, projects, files, and what they were doing. " +
        "Use it when the task refers to something you are expected to already know.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: { query: { type: "string" } },
      },
    },
    {
      name: "finish",
      description: "Declare the task finished or stopped. Always call this last.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["outcome", "summary", "changed", "incomplete"],
        properties: {
          outcome: { type: "string", enum: ["done", "stopped", "blocked"] },
          summary: { type: "string", description: "One or two sentences, in your own voice." },
          changed: { type: "array", items: { type: "string" } },
          incomplete: { type: "array", items: { type: "string" } },
        },
      },
    },
  ];
}

/* ------------------------------------------------------------------ approval */

/**
 * Suspend the loop until a human answers. With nobody watching this simply
 * never resolves until they come back — which is the correct behaviour for an
 * action that was defined as always needing a person.
 */
function askPermission({ rule, detail, action }) {
  return new Promise((resolve) => {
    pendingApproval = { resolve };
    current.status = "parked";
    current.parked = { rule, detail, action, at: Date.now() };
    emit();
  });
}

function answerApproval(choice) {
  if (!pendingApproval) return { ok: false };
  const { resolve } = pendingApproval;
  pendingApproval = null;
  current.parked = null;
  current.status = choice === "stop" ? "stopping" : "running";
  emit();
  resolve(choice);
  return { ok: true };
}

/* ------------------------------------------------------------- tool handlers */

async function runComputer(input, shot) {
  const state = db.get();
  if (!state.permissions.actGui) {
    return {
      error: true,
      text: "Driving applications isn't switched on. The person needs to allow it in Permissions.",
    };
  }

  const action = String(input.action ?? "");

  if (action === "screenshot") {
    const next = await screenLib.capture();
    if (!next.ok) return { error: true, text: next.detail };
    current.lastShot = next;
    return { image: next };
  }

  if (action === "cursor_position") {
    const [result] = await win32.act([{ kind: "cursor-pos" }]);
    return { text: result?.ok ? `Pointer at ${result.detail.x}, ${result.detail.y}` : "Couldn't read it." };
  }

  const at = async (coord) =>
    coord ? await screenLib.toPointer(coord, shot) : null;

  let plan = null;

  switch (action) {
    case "mouse_move": {
      const p = await at(input.coordinate);
      plan = [{ kind: "move", x: p.x, y: p.y }];
      break;
    }
    case "left_click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "triple_click": {
      const p = await at(input.coordinate);
      plan = [
        {
          kind: "click",
          x: p.x,
          y: p.y,
          button: action.startsWith("right") ? "right" : action.startsWith("middle") ? "middle" : "left",
          double: action === "double_click",
          triple: action === "triple_click",
        },
      ];
      break;
    }
    case "left_mouse_down": {
      const p = await at(input.coordinate);
      plan = [{ kind: "mouse-down", x: p.x, y: p.y }];
      break;
    }
    case "left_mouse_up": {
      const p = input.coordinate ? await at(input.coordinate) : null;
      plan = [{ kind: "mouse-up", ...(p ? { x: p.x, y: p.y } : {}) }];
      break;
    }
    case "left_click_drag": {
      const from = await at(input.start_coordinate ?? input.coordinate);
      const to = await at(input.coordinate);
      plan = [{ kind: "drag", x1: from.x, y1: from.y, x2: to.x, y2: to.y }];
      break;
    }
    case "scroll": {
      const p = input.coordinate ? await at(input.coordinate) : null;
      plan = [
        {
          kind: "scroll",
          ...(p ? { x: p.x, y: p.y } : {}),
          direction: input.scroll_direction ?? "down",
          amount: input.scroll_amount ?? 3,
        },
      ];
      break;
    }
    case "type":
      plan = [{ kind: "type", text: String(input.text ?? "") }];
      break;
    case "key": {
      const sequence = keys.toSequence(input.text);
      if (sequence.some((k) => k === null)) {
        return {
          error: true,
          text: `I can't send "${input.text}" on Windows. Try a different key combination.`,
        };
      }
      plan = sequence.map((k) => ({ kind: "hotkey", keys: k }));
      break;
    }
    case "hold_key": {
      const k = keys.toSendKeys(input.text);
      if (!k) return { error: true, text: `I can't hold "${input.text}" on Windows.` };
      plan = [{ kind: "hold-key", keys: k, ms: Math.round((input.duration ?? 1) * 1000) }];
      break;
    }
    case "wait":
      plan = [{ kind: "wait", ms: Math.round((input.duration ?? 1) * 1000) }];
      break;
    default:
      return {
        error: true,
        text:
          `I don't know the action "${action}" on this machine. I can do: screenshot, mouse_move, ` +
          `left_click, right_click, middle_click, double_click, triple_click, left_mouse_down, ` +
          `left_mouse_up, left_click_drag, scroll, type, key, hold_key, wait, cursor_position.`,
      };
  }

  /* Driving the machine cannot be undone, so the run is marked irreversible
     the moment the first such action lands. */
  if (action !== "wait") current.irreversible = true;

  const results = await win32.act(plan);
  const failed = results.find((r) => !r.ok);
  if (failed) return { error: true, text: failed.detail };

  current.changes.push(`${action}${input.text ? ` "${trim(input.text)}"` : ""}`);

  /* Give the screen a beat to settle, then show the result — otherwise the
     model reasons about a frame that no longer exists. */
  await sleep(450);
  const next = await screenLib.capture();
  if (next.ok) {
    current.lastShot = next;
    return { image: next, text: results.map((r) => r.detail).filter(Boolean).join("; ") };
  }
  return { text: results.map((r) => r.detail).filter(Boolean).join("; ") };
}

async function runFileAction(input) {
  const action = { ...input };
  const kind = action.kind;

  const overrides = {};
  if (action.pattern) overrides.pattern = action.pattern;

  let approved = false;
  const rule = actions.hardRuleFor(action);
  if (rule) {
    const choice = await askPermission({
      rule,
      detail:
        rule === "delete"
          ? `It wants to clear ${action.match ?? "a file"} out of ${short(action.dir)}.`
          : "It wants to do something that can't be undone.",
      action,
    });
    if (choice === "stop") return { error: true, text: "The person stopped it here.", stop: true };
    if (choice === "skip") return { text: "Skipped — the person said no to that one." };
    approved = true;
  }

  const result = await actions.run(action, { runId: current.id, overrides, approved });

  if (result.parked) {
    const choice = await askPermission({ rule: result.rule, detail: result.detail, action });
    if (choice === "stop") return { error: true, text: "The person stopped it here.", stop: true };
    if (choice === "skip") return { text: "Skipped — the person said no to that one." };

    const retry = await actions.run(action, { runId: current.id, overrides, approved: true });
    if (!retry.ok) return { error: true, text: retry.detail };
    absorb(retry);
    return { text: `${kind}: ${retry.detail}` };
  }

  if (!result.ok) return { error: true, text: result.detail };
  absorb(result);
  return { text: `${kind}: ${result.detail}` };
}

function absorb(result) {
  current.journal.push(...(result.inverse ?? []));
  current.changes.push(...(result.changes ?? []));
  if (result.irreversible) current.irreversible = true;
}

async function runRecall(input) {
  const pack = await brain.recallSemantic(input.query, { limit: 10, budgetTokens: 1500 });
  return { text: brain.packToText(pack) };
}

/* ------------------------------------------------------------------ the loop */

/**
 * Run one task to completion.
 *
 * `instruction` is plain language — either something the user typed or the
 * intent of a learned routine.
 */
async function run({ instruction, routineId = null, title = null, supervised = true }) {
  if (current && !["finished", "stopped"].includes(current.status)) {
    return { ok: false, reason: "busy" };
  }
  if (!claude.configured()) return { ok: false, reason: "no-key" };

  const shot = await screenLib.capture();
  if (!shot.ok) return { ok: false, reason: "no-screen", detail: shot.detail };

  /* Everything Mimic already knows that bears on this task. This is the whole
     point of the brain — the agent starts informed rather than blank. */
  const pack = await brain.recallSemantic(instruction, { limit: 12, budgetTokens: 2500 });

  current = {
    id: crypto.randomUUID(),
    routineId,
    title: title ?? instruction.slice(0, 80),
    instruction,
    status: "running",
    step: 0,
    startedAt: Date.now(),
    narration: [],
    changes: [],
    journal: [],
    irreversible: false,
    parked: null,
    summary: null,
    supervised,
    lastShot: shot,
    recalled: pack.entities.length + pack.episodes.length,
  };
  emit();

  const api = claude.anthropic();
  const messages = [
    {
      role: "user",
      content: [
        screenLib.asImageBlock(shot),
        {
          type: "text",
          text:
            `Here is the screen right now (${shot.width}x${shot.height}).\n\n` +
            `What I already know that might bear on this:\n${brain.packToText(pack)}\n\n` +
            `The task:\n${instruction}`,
        },
      ],
    },
  ];

  let betas = [COMPUTER_BETA];

  try {
    while (current.step < MAX_STEPS) {
      if (current.status === "stopping") break;
      current.step += 1;
      emit();

      const request = {
        model: claude.MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages,
        tools: toolsFor(current.lastShot),
        thinking: { type: "adaptive" },
        output_config: { effort: claude.EFFORT.act },
      };

      let response;
      try {
        response = await api.beta.messages.create({ ...request, betas });
      } catch (err) {
        /* If this deployment doesn't know the computer-use beta string, say so
           once and carry on without it rather than failing the whole task. */
        if (err?.status === 400 && betas.length) {
          betas = [];
          response = await api.beta.messages.create({ ...request, betas: [] });
        } else {
          throw err;
        }
      }

      if (claude.refused(response)) {
        return stop("stopped", "I was declined on that one, so I've left it alone.");
      }

      messages.push({ role: "assistant", content: response.content });

      const said = claude.textOf(response);
      if (said) {
        current.narration.push({ at: Date.now(), text: said });
        emit();
      }

      const calls = response.content.filter((b) => b.type === "tool_use");
      if (calls.length === 0) break;

      const finish = calls.find((c) => c.name === "finish");
      if (finish) {
        return stop(
          finish.input.outcome === "done" ? "finished" : "stopped",
          finish.input.summary,
          finish.input,
        );
      }

      const results = [];
      for (const call of calls) {
        const outcome = await execute(call);
        if (outcome.stop) return stop("stopped", "Stopped where the person asked.");
        results.push(toResult(call.id, outcome));
      }

      messages.push({ role: "user", content: results });
    }

    return stop(
      "stopped",
      current.step >= MAX_STEPS
        ? "I've used up the steps I allow myself for one task. Stopping here rather than grinding on."
        : "I stopped without a clear finish.",
    );
  } catch (err) {
    return stop("stopped", `I hit a problem: ${claude.describe(err)}`);
  }
}

async function execute(call) {
  try {
    if (call.name === "computer") return await runComputer(call.input, current.lastShot);
    if (call.name === "file_action") return await runFileAction(call.input);
    if (call.name === "recall") return await runRecall(call.input);
    return { error: true, text: `I don't have a tool called ${call.name}.` };
  } catch (err) {
    return { error: true, text: claude.describe(err) };
  }
}

function toResult(id, outcome) {
  const content = [];
  if (outcome.text) content.push({ type: "text", text: outcome.text });
  if (outcome.image) content.push(screenLib.asImageBlock(outcome.image));
  if (content.length === 0) content.push({ type: "text", text: "Done." });

  return {
    type: "tool_result",
    tool_use_id: id,
    content,
    ...(outcome.error ? { is_error: true } : {}),
  };
}

function stop(status, summary, detail = {}) {
  if (!current) return { ok: false };

  current.status = status;
  current.summary = {
    outcome: status === "finished" ? "done" : "stopped",
    text: summary,
    changed: detail.changed?.length ? detail.changed : current.changes,
    incomplete: detail.incomplete ?? [],
    durationSec: Math.round((Date.now() - current.startedAt) / 1000),
    steps: current.step,
  };
  emit();

  const record = {
    id: current.id,
    routineId: current.routineId,
    routineTitle: current.title,
    at: Date.now(),
    durationSec: current.summary.durationSec,
    corrections: 0,
    outcome: status === "finished" ? "clean" : "stopped",
    note: summary,
    minutesSaved: status === "finished" ? Math.max(1, Math.round(current.summary.durationSec / 12)) : 0,
    supervised: current.supervised,
    unattended: !current.supervised,
    agent: true,
    reasoning: {
      saw: `${current.step} steps, driving the machine directly.`,
      inferred: current.instruction,
      applied: current.recalled ? `${current.recalled} things I already knew.` : undefined,
    },
    steps: current.narration.map((n) => ({ label: n.text, state: "done" })),
    changes: current.summary.changed,
    journal: current.journal,
    reversible: current.journal.length > 0 && !current.irreversible,
    rolledBack: false,
    recording: false,
  };

  db.update((s) => {
    s.runs.unshift(record);
    if (s.runs.length > 500) s.runs.length = 500;
  });

  /* What it just did is itself worth remembering. */
  brain.remember({
    kind: "task",
    at: Date.now(),
    app: "Mimic",
    activity: `I did this myself: ${current.instruction}`,
    intent: summary,
    detail: current.summary.changed.slice(0, 6).join("; "),
    salience: status === "finished" ? 0.8 : 0.6,
  });

  return { ok: true, summary: current.summary, runId: record.id };
}

function abort() {
  if (!current) return;
  if (pendingApproval) answerApproval("stop");
  current.status = "stopping";
  emit();
}

/* --------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trim = (s, n = 40) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const short = (p) => (p ? String(p).split(/[\\/]/).pop() : "somewhere");

module.exports = { run, abort, answerApproval, snapshot, setPublisher, MAX_STEPS };
