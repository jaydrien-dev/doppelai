const crypto = require("node:crypto");

const db = require("./db");
const claude = require("./claude");
const screenLib = require("./screen");
const brain = require("./brain");
const actions = require("./actions");
const win32 = require("./win32");
const keys = require("./keys");
const bgAgent = require("./bg-agent");

/**
 * Doppel's hands.
 *
 * A task runs as an agent loop: Claude looks at the screen, decides on an
 * action, we carry it out, and it looks again. It has three kinds of tool —
 * the computer itself, the guarded file operations, and its own memory.
 *
 * Background tasks run concurrently — the user can kick off several at once
 * and keep talking to Doppel while they work. Foreground tasks (driving the
 * screen) are exclusive: only one at a time.
 *
 * Every file action still goes through actions.js, so the folder allowlist,
 * the trash-instead-of-delete rule, and the inverse journal all apply exactly
 * as they do to a supervised routine.
 */

const MAX_STEPS = 40;
const MAX_TOKENS = 4096;
const COMPUTER_BETA = "computer-use-2025-11-24";
const AGENT_MAX_EDGE = 2200;

/** How long a finished task stays in the list so the UI can show completion. */
const CLEANUP_DELAY = 120_000;

/* ------------------------------------------------------------ mutable state */

const tasks = new Map();       // id → task object (mutated in place)
const approvals = new Map();   // id → { resolve }
let foregroundId = null;       // only one foreground task at a time
let publish = () => {};
let onComplete = () => {};

const setPublisher = (fn) => { publish = fn; };
const setOnComplete = (fn) => { onComplete = fn; };

const snapshot = () =>
  [...tasks.values()].map((t) => JSON.parse(JSON.stringify(t)));

const emit = () => publish(snapshot());

/* ------------------------------------------------------------------ prompts */

const SYSTEM = `You are Doppel, an agent that drives one person's computer on their behalf — their apps, their sessions.

You can see the screen and drive it: pointer, clicks, typing, keys, scroll. You also have a guarded file tool and your own memory.

# CRITICAL: Verify the window before typing
Before typing or pressing keys, take a screenshot to confirm the right window is focused. Keystrokes go to whatever is focused — typing into the wrong app ruins their work.

# How to work
- Screenshot before and after anything that changes the screen.
- Prefer the guarded file tool over driving a file manager by hand.
- Work at the scope asked for. Finish the whole task. If you can't, say what's missing.
- Destructive/irreversible actions always stop and ask — the tools handle this.
- If stuck, stop cleanly and explain.

# Voice
Brief, first person, warm. Say what you'll do before your first action. No emoji. Call finish when done.`;

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

function makeAskPermission(task) {
  return ({ rule, detail, action }) => {
    return new Promise((resolve) => {
      approvals.set(task.id, { resolve });
      task.status = "parked";
      task.parked = { rule, detail, action, at: Date.now() };
      emit();
    });
  };
}

function answerApproval(id, choice) {
  const approval = approvals.get(id);
  if (!approval) return { ok: false };
  approvals.delete(id);
  const task = tasks.get(id);
  if (!task) return { ok: false };
  task.parked = null;
  task.status = choice === "stop" ? "stopping" : "running";
  emit();
  approval.resolve(choice);
  return { ok: true };
}

/* ------------------------------------------------------------------ stop/fin */

function makeStopFn(task) {
  return (status, summary, detail = {}) => {
    task.status = status;
    task.summary = {
      outcome: status === "finished" ? "done" : "stopped",
      text: summary,
      changed: detail.changed?.length ? detail.changed : task.changes,
      incomplete: detail.incomplete ?? [],
      durationSec: Math.round((Date.now() - task.startedAt) / 1000),
      steps: task.step,
    };
    emit();

    const record = {
      id: task.id,
      routineId: task.routineId,
      routineTitle: task.title,
      at: Date.now(),
      durationSec: task.summary.durationSec,
      corrections: 0,
      outcome: status === "finished" ? "clean" : "stopped",
      note: summary,
      minutesSaved: status === "finished" ? Math.max(1, Math.round(task.summary.durationSec / 12)) : 0,
      supervised: task.supervised,
      unattended: !task.supervised,
      agent: true,
      reasoning: {
        saw: task.mode === "foreground"
          ? `${task.step} steps, driving the machine directly.`
          : `${task.step} steps, working in the background.`,
        inferred: task.instruction,
        applied: task.recalled ? `${task.recalled} things I already knew.` : undefined,
      },
      steps: task.narration.map((n) => ({ label: n.text, state: "done" })),
      changes: task.summary.changed,
      journal: task.journal,
      reversible: task.journal.length > 0 && !task.irreversible,
      rolledBack: false,
      recording: false,
    };

    db.update((s) => {
      if (!s.runs) s.runs = [];
      s.runs.unshift(record);
      if (s.runs.length > 500) s.runs.length = 500;
    });

    brain.remember({
      kind: "task",
      at: Date.now(),
      app: "Doppel",
      activity: `I did this myself: ${task.instruction}`,
      intent: summary,
      detail: task.summary.changed.slice(0, 6).join("; "),
      salience: status === "finished" ? 0.8 : 0.6,
    });

    onComplete();

    /* Remove from the pool after a short delay so the UI can show the result. */
    setTimeout(() => {
      tasks.delete(task.id);
      approvals.delete(task.id);
      if (foregroundId === task.id) foregroundId = null;
      emit();
    }, CLEANUP_DELAY);

    return { ok: true, summary: task.summary, runId: record.id };
  };
}

/* ------------------------------------------------------------- tool handlers */

async function runComputer(input, task) {
  const state = db.get();
  if (!state.permissions.actGui) {
    return {
      error: true,
      text: "Driving applications isn't switched on. The person needs to allow it in Permissions.",
    };
  }

  const shot = task.lastShot;
  const action = String(input.action ?? "");

  if (action === "screenshot") {
    const next = await screenLib.capture({ maxEdge: AGENT_MAX_EDGE });
    if (!next.ok) return { error: true, text: next.detail };
    task.lastShot = next;
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

  if (action !== "wait") task.irreversible = true;

  const results = await win32.act(plan);
  const failed = results.find((r) => !r.ok);
  if (failed) return { error: true, text: failed.detail };

  task.changes.push(`${action}${input.text ? ` "${trim(input.text)}"` : ""}`);

  const next = await waitForStable();
  if (next) {
    task.lastShot = next;
    return { image: next, text: results.map((r) => r.detail).filter(Boolean).join("; ") };
  }
  return { text: results.map((r) => r.detail).filter(Boolean).join("; ") };
}

async function runFileAction(input, task, askPerm) {
  const action = { ...input };
  const kind = action.kind;

  const overrides = {};
  if (action.pattern) overrides.pattern = action.pattern;

  let approved = false;
  const rule = actions.hardRuleFor(action);
  if (rule) {
    const choice = await askPerm({
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

  const result = await actions.run(action, { runId: task.id, overrides, approved });

  if (result.parked) {
    const choice = await askPerm({ rule: result.rule, detail: result.detail, action });
    if (choice === "stop") return { error: true, text: "The person stopped it here.", stop: true };
    if (choice === "skip") return { text: "Skipped — the person said no to that one." };

    const retry = await actions.run(action, { runId: task.id, overrides, approved: true });
    if (!retry.ok) return { error: true, text: retry.detail };
    absorb(retry, task);
    return { text: `${kind}: ${retry.detail}` };
  }

  if (!result.ok) return { error: true, text: result.detail };
  absorb(result, task);
  return { text: `${kind}: ${result.detail}` };
}

function absorb(result, task) {
  task.journal.push(...(result.inverse ?? []));
  task.changes.push(...(result.changes ?? []));
  if (result.irreversible) task.irreversible = true;
}

async function runRecall(input) {
  const pack = await brain.recallSemantic(input.query, { limit: 6, budgetTokens: 1000 });
  return { text: brain.packToText(pack) };
}

/* ------------------------------------------------------------------ the loop */

/**
 * Start a task. Returns immediately with { ok, taskId }.
 *
 * Background tasks run concurrently — start as many as you want.
 * Foreground tasks are exclusive (only one can drive the screen).
 *
 * The loop runs asynchronously; progress is broadcast via the publisher.
 */
async function run({ instruction, routineId = null, title = null, supervised = true, mode = "background" }) {
  if (mode === "foreground" && foregroundId) {
    return { ok: false, reason: "busy", detail: "A foreground task is already running." };
  }
  if (!claude.configured()) return { ok: false, reason: "no-key" };

  const screenOnly = /^(what('?s| is| am i)|(describe|read|look at|check|show))\b/i.test(instruction)
    && /\b(screen|looking at|on my|this page|this doc)/i.test(instruction)
    && instruction.length < 120;

  const pack = screenOnly
    ? { entities: [], digests: [], episodes: [], tokens: 0 }
    : await brain.recallSemantic(instruction, { limit: 8, budgetTokens: 1500 });

  const task = {
    id: crypto.randomUUID(),
    routineId,
    title: title ?? instruction.slice(0, 80),
    instruction,
    status: "running",
    mode,
    step: 0,
    startedAt: Date.now(),
    narration: [],
    changes: [],
    journal: [],
    irreversible: false,
    parked: null,
    summary: null,
    supervised,
    lastShot: null,
    recalled: pack.entities.length + pack.episodes.length,
  };

  tasks.set(task.id, task);
  if (mode === "foreground") foregroundId = task.id;
  emit();

  const stopFn = makeStopFn(task);
  const askPerm = makeAskPermission(task);

  if (mode === "foreground") {
    runForeground(task, pack, instruction, stopFn, askPerm).catch((err) => {
      stopFn("stopped", `I hit a problem: ${claude.describe(err)}`);
    });
  } else {
    bgAgent.runLoop({
      task,
      instruction,
      pack,
      emit,
      askPermission: askPerm,
      stopFn,
    }).catch((err) => {
      stopFn("stopped", `I hit a problem: ${claude.describe(err)}`);
    });
  }

  return { ok: true, taskId: task.id };
}

/**
 * Foreground mode — drives the screen. Only one at a time.
 */
async function runForeground(task, pack, instruction, stopFn, askPerm) {
  const shot = await screenLib.capture({ maxEdge: AGENT_MAX_EDGE });
  if (!shot.ok) return stopFn("stopped", `Couldn't read the screen: ${shot.detail}`);

  task.lastShot = shot;
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

  while (task.step < MAX_STEPS) {
    if (task.status === "stopping") break;
    task.step += 1;
    emit();

    const request = {
      model: claude.MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      tools: toolsFor(task.lastShot),
      thinking: { type: "enabled", budget_tokens: 1024 },
    };

    let response;
    try {
      response = await api.beta.messages.create({ ...request, betas });
    } catch (err) {
      if (err?.status === 400 && betas.length) {
        betas = [];
        response = await api.beta.messages.create({ ...request, betas: [] });
      } else {
        throw err;
      }
    }

    claude.trackUsage(response?.usage);

    if (claude.refused(response)) {
      return stopFn("stopped", "I was declined on that one, so I've left it alone.");
    }

    messages.push({ role: "assistant", content: response.content });

    const said = claude.textOf(response);
    if (said) {
      task.narration.push({ at: Date.now(), text: said });
      emit();
    }

    const calls = response.content.filter((b) => b.type === "tool_use");
    if (calls.length === 0) break;

    const finish = calls.find((c) => c.name === "finish");
    if (finish) {
      return stopFn(
        finish.input.outcome === "done" ? "finished" : "stopped",
        finish.input.summary,
        finish.input,
      );
    }

    const results = [];
    for (const call of calls) {
      const outcome = await executeFg(call, task, askPerm);
      if (outcome.stop) return stopFn("stopped", "Stopped where the person asked.");
      results.push(toResult(call.id, outcome));
    }

    messages.push({ role: "user", content: results });
  }

  return stopFn(
    "stopped",
    task.step >= MAX_STEPS
      ? "I've used up the steps I allow myself for one task. Stopping here rather than grinding on."
      : "I stopped without a clear finish.",
  );
}

async function executeFg(call, task, askPerm) {
  try {
    if (call.name === "computer") return await runComputer(call.input, task);
    if (call.name === "file_action") return await runFileAction(call.input, task, askPerm);
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

function abort(id) {
  if (id) {
    const task = tasks.get(id);
    if (!task) return;
    if (approvals.has(id)) answerApproval(id, "stop");
    task.status = "stopping";
    emit();
  } else {
    for (const [tid, task] of tasks) {
      if (!["finished", "stopped"].includes(task.status)) {
        if (approvals.has(tid)) answerApproval(tid, "stop");
        task.status = "stopping";
      }
    }
    emit();
  }
}

/* --------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trim = (s, n = 40) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const short = (p) => (p ? String(p).split(/[\\/]/).pop() : "somewhere");

async function waitForStable() {
  const hashShot = (shot) =>
    crypto.createHash("md5").update(shot.base64).digest("hex");

  await sleep(150);
  let prev = await screenLib.capture({ maxEdge: AGENT_MAX_EDGE });
  if (!prev.ok) return null;
  let prevHash = hashShot(prev);

  for (let i = 0; i < 4; i++) {
    await sleep(200);
    const next = await screenLib.capture({ maxEdge: AGENT_MAX_EDGE });
    if (!next.ok) return prev;
    const nextHash = hashShot(next);
    if (nextHash === prevHash) return next;
    prev = next;
    prevHash = nextHash;
  }
  return prev;
}

module.exports = { run, abort, answerApproval, snapshot, setPublisher, setOnComplete, MAX_STEPS };
