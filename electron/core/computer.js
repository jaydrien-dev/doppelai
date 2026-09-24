const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");
const os = require("node:os");

const claude = require("./claude");
const db = require("./db");
const win32 = require("./win32");
const brain = require("./brain");

/**
 * Doppel Computer — headless bots.
 *
 * Architecture:
 *   Phase 0 — CLARIFY (Gemini, thinking enabled)
 *     If the goal is too vague, ask the user for details before committing.
 *
 *   Phase 1 — THINK (Gemini, thinking enabled)
 *     Understand the goal deeply. Generate ALL content upfront.
 *     Produce a structured plan of operations with everything pre-baked.
 *
 *   Phase 2 — EXECUTE (Jev validates, Node.js runs)
 *     Jev makes a fast typed decision on each step: proceed / skip / abort.
 *     Node.js executes via filesystem, shell, or blind keyboard automation.
 *
 * No screen captures. No vision. Cross-platform (Windows + macOS).
 * Runs entirely in the background — multiple bots can run concurrently.
 */

const MAX_ROUNDS = 12;
const MAX_OPS_PER_ROUND = 20;
const PLAN_MAX_TOKENS = 8000;

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const PLATFORM = IS_MAC ? "macOS" : IS_WIN ? "Windows" : process.platform;
const SHELL = IS_WIN ? "powershell.exe" : "/bin/bash";

const jev = require("./jev");

/* ------------------------------------------------------------------ config */

function configured() {
  return claude.configured();
}

function resetClient() { jev.resetClient(); }

/* -------------------------------------------------------------------- bots */

const bots = new Map();
let emitUpdate = null;

function setEmitter(fn) { emitUpdate = fn; }

function broadcast(bot) {
  if (emitUpdate) emitUpdate(sanitize(bot));
}

function sanitize(bot) {
  /* Build a result summary: the done message + any file paths touched */
  let result = null;
  if (bot.status === "done" || bot.status === "failed") {
    const doneStep = bot.steps.find((s) => s.action === "done");
    const filePaths = bot.steps
      .filter((s) => s.action === "write" || s.action === "append" || s.action === "copy")
      .map((s) => s.target)
      .filter(Boolean);
    const parts = [];
    if (doneStep?.detail) parts.push(doneStep.detail);
    if (filePaths.length > 0) parts.push(`Files: ${filePaths.join(", ")}`);
    result = parts.join("\n") || null;
  }

  return {
    id: bot.id,
    goal: bot.goal,
    status: bot.status,
    stepCount: bot.steps.length,
    currentAction: bot.steps[bot.steps.length - 1]?.action ?? null,
    error: bot.error,
    question: bot.question ?? null,
    result,
    createdAt: bot.createdAt,
    completedAt: bot.completedAt,
  };
}

async function createBot(goal) {
  if (!configured()) {
    return { ok: false, error: "Gemini API key required." };
  }

  const id = `bot_${crypto.randomBytes(6).toString("hex")}`;
  const bot = {
    id,
    goal: String(goal).trim(),
    status: "running",
    steps: [],
    createdAt: Date.now(),
    completedAt: null,
    error: null,
    question: null,
    aborted: false,
    _resolve: null, // for clarification wait
  };

  bots.set(id, bot);
  broadcast(bot);

  runLoop(bot).catch((err) => {
    bot.status = "failed";
    bot.error = err.message;
    bot.completedAt = Date.now();
    broadcast(bot);
  });

  return { ok: true, bot: sanitize(bot) };
}

/** User responds to a clarification question. */
function respondToBot(id, answer) {
  const bot = bots.get(id);
  if (!bot) return { ok: false, error: "Not found" };
  if (bot.status !== "clarifying") return { ok: false, error: "Not waiting for input" };
  bot.goal = `${bot.goal}\n\nUser clarification: ${answer}`;
  bot.question = null;
  bot.status = "running";
  if (bot._resolve) bot._resolve(answer);
  broadcast(bot);
  return { ok: true };
}

function stopBot(id) {
  const bot = bots.get(id);
  if (!bot) return { ok: false, error: "Not found" };
  if (bot.status !== "running" && bot.status !== "clarifying") return { ok: false, error: "Not running" };
  bot.aborted = true;
  bot.status = "stopped";
  bot.completedAt = Date.now();
  if (bot._resolve) bot._resolve(null);
  broadcast(bot);
  return { ok: true };
}

function listBots() { return [...bots.values()].map(sanitize); }

function botStatus(id) {
  const bot = bots.get(id);
  if (!bot) return null;
  return {
    ...sanitize(bot),
    steps: bot.steps.map((s) => ({
      action: s.action,
      target: s.target ?? null,
      detail: s.detail ?? null,
      at: s.at,
    })),
  };
}

function clearBot(id) {
  const bot = bots.get(id);
  if (!bot) return false;
  if (bot.status === "running" || bot.status === "clarifying") bot.aborted = true;
  if (bot._resolve) bot._resolve(null);
  bots.delete(id);
  return true;
}

/* -------------------------------------------------------- Phase 0: CLARIFY */

/**
 * Returns: "clear" — goal is good, proceed
 *          "answered" — user answered a question, re-check clarity
 *          "abort" — user didn't answer or bot was aborted
 */
async function maybeClarify(bot) {
  /* Fast Jev pre-check — if the goal is obviously clear, skip the full LLM call */
  const clarity = await jev.score(
    { goal: bot.goal, platform: PLATFORM },
    "This goal is clear, specific, and actionable — no clarification needed",
    0.5,
  );
  if (clarity > 0.75) return "clear";

  const result = await claude.ask({
    system: `You evaluate whether a user's goal is clear enough to execute as a computer bot.
The bot can: manage files, run shell commands, open apps/URLs, and type via keyboard automation.
It CANNOT: read the screen, use the mouse, or interact with GUI elements visually.

If the goal is clear and actionable, return: { "clear": true }
If the goal is too vague or ambiguous, return: { "clear": false, "question": "<your question>" }

Be practical — don't ask for clarification on things you can reasonably assume.
Only ask when the ambiguity would lead to doing the WRONG thing.`,
    messages: [
      { role: "user", content: `Goal: "${bot.goal}"\nPlatform: ${PLATFORM}\nHome: ${os.homedir()}\nFolders: ${(db.get().observation?.roots ?? []).join(", ")}` },
    ],
    schema: {
      type: "object",
      properties: {
        clear: { type: "boolean" },
        question: { type: "string" },
      },
      required: ["clear"],
    },
    effort: "medium",
    maxTokens: 300,
    thinking: true,
  });

  if (!result.ok) return "clear"; // if clarification fails, just proceed
  if (result.value.clear) return "clear";

  /* Ask the user */
  bot.question = result.value.question;
  bot.status = "clarifying";
  broadcast(bot);

  /* Wait for the user to respond (or abort) */
  const answer = await new Promise((resolve) => {
    bot._resolve = resolve;
    /* Timeout after 5 minutes */
    setTimeout(() => resolve(null), 5 * 60 * 1000);
  });
  bot._resolve = null;

  if (!answer || bot.aborted) return "abort";
  return "answered";
}

/* -------------------------------------------------------------- agent loop */

const PLAN_SYSTEM = `You are Doppel's bot engine. You accomplish goals by generating a plan of operations.

You run HEADLESS — no screen, no mouse, no GUI interaction.
You have direct access to the filesystem, shell, and keyboard automation.

IMPORTANT: Do ALL your thinking and content generation NOW, in this planning phase.
If the goal asks you to write something (report, email, code, document), generate the
FULL content and include it in a "write" operation. Don't defer content generation.

Available operations:

FILE OPERATIONS:
- { "op": "list", "path": "<dir>" } — list files/folders (returns names, sizes, dates)
- { "op": "move", "from": "<path>", "to": "<path>" } — move or rename a file/folder
- { "op": "copy", "from": "<path>", "to": "<path>" } — copy a file
- { "op": "mkdir", "path": "<dir>" } — create directory (recursive)
- { "op": "delete", "path": "<path>" } — move to trash (safe, reversible)
- { "op": "read", "path": "<path>" } — read a text file (first 500 lines)
- { "op": "write", "path": "<path>", "content": "<text>" } — write/overwrite a file
- { "op": "append", "path": "<path>", "content": "<text>" } — append to a file

SYSTEM:
- { "op": "shell", "cmd": "<command>" } — run a shell command
- { "op": "launch", "target": "<app name>" } — open an application
- { "op": "open_url", "url": "<url>" } — open a URL in the default browser

KEYBOARD AUTOMATION:
- { "op": "paste", "text": "<text>" } — copy text to clipboard and paste (Ctrl+V / Cmd+V). Best for long or multi-line text. Preserves formatting and newlines naturally.
- { "op": "type", "text": "<text>" } — type text character-by-character via keyboard. Use ONLY for short single-line input (search boxes, file names, URLs). Never use for multi-line content.
- { "op": "hotkey", "keys": "<keys>" } — press a keyboard shortcut
- { "op": "wait", "ms": <number> } — wait for an app to load/respond

VERIFICATION:
- { "op": "look", "check": "<what to verify>" } — capture the screen and describe what's visible. Use after paste/type into GUI apps to verify content was written. Returns a text description of the screen.

TERMINAL:
- { "op": "done", "summary": "<what was accomplished>" } — goal complete
- { "op": "failed", "reason": "<why>" } — cannot complete

Platform-specific notes are provided in context. Use the right path separator and commands.

Rules:
1. Return JSON: { "plan": [...operations], "thinking": "<your reasoning>" }
2. Use ABSOLUTE paths.
3. For file ops, "list" a directory first before moving/renaming files in it.
4. Generate ALL text content in the plan — don't leave placeholders.
5. For writing content into apps (Google Docs, Word, Notepad, email, etc.):
   a. Open the app/URL first, then "wait" at least 3000ms for it to fully load.
   b. Click into the content area with a hotkey or click before pasting.
   c. Use "paste" for ALL body text — it handles newlines, formatting, and long content correctly.
   d. Use "type" ONLY for short single-line fields (search boxes, file names, subject lines).
   e. NEVER split content into multiple type operations — write the full text in one "paste" op.
6. If you need to see results before planning more, end the plan — you'll get results and can continue.
7. Prefer fewer operations. Be direct.
8. When creating files locally (not in an app), prefer "write" over "paste" — it's instant and doesn't need an app open.

VERIFICATION — these are mandatory, not optional:
9. After "open_url": ALWAYS "look" to confirm the page loaded (not showing an error, 404, auth wall, or loading spinner). If it's not ready, "wait" longer and "look" again.
10. After "launch": ALWAYS "look" to confirm the app is visible and ready (not showing an update dialog, crash report, or login screen).
11. After "paste" or "type" into a GUI app: ALWAYS "look" to verify the content actually appeared in the right place. If the screen shows an empty document or the wrong field, the input went nowhere — retry.
12. After "hotkey" that should cause a visible change (save, new tab, close, etc.): "look" to confirm the expected result happened.
13. NEVER report "done" after any GUI interaction without a final "look" to verify the end state matches expectations.
14. File operations (write, append, move, copy, delete, mkdir) are auto-verified — the execution layer checks the filesystem after each one and will report failure if verification fails. You do NOT need to add manual checks for these.`;

async function runLoop(bot) {
  /* Phase 0: Clarify — loop until the bot has enough info (up to 5 rounds) */
  for (let c = 0; c < 5; c++) {
    const clarity = await maybeClarify(bot);
    if (clarity === "abort" || bot.aborted) {
      if (bot.status !== "stopped") {
        bot.status = "stopped";
        bot.completedAt = Date.now();
        broadcast(bot);
      }
      return;
    }
    if (clarity === "clear") break;
    /* clarity === "answered" — re-check with updated goal */
  }

  const roots = db.get().observation?.roots ?? [];
  const home = os.homedir();
  const results = [];

  for (let round = 0; round < MAX_ROUNDS && !bot.aborted; round++) {
    /* Phase 1: THINK */
    bot.steps.push({ action: "thinking", detail: round === 0 ? "Planning..." : "Replanning...", at: Date.now() });
    broadcast(bot);

    const plan = await generatePlan(bot.goal, home, roots, results, bot.steps);

    if (!plan.ok) {
      bot.status = "failed";
      bot.error = plan.detail ?? "Planning failed";
      bot.completedAt = Date.now();
      broadcast(bot);
      return;
    }

    const ops = plan.operations;
    if (!ops || ops.length === 0) {
      bot.status = "failed";
      bot.error = "Empty plan";
      bot.completedAt = Date.now();
      broadcast(bot);
      return;
    }

    /* Phase 2: EXECUTE */
    const opsToRun = ops.slice(0, MAX_OPS_PER_ROUND);
    for (let i = 0; i < opsToRun.length; i++) {
      if (bot.aborted) break;
      const op = opsToRun[i];

      /* Skip malformed operations — LLM sometimes outputs junk entries */
      if (!op || !op.op) {
        results.push({ op: "unknown", input: op ?? {}, ok: false, detail: "Skipped — no operation type" });
        continue;
      }

      if (op.op === "done") {
        bot.steps.push({ action: "done", detail: op.summary ?? "Complete", at: Date.now() });
        bot.status = "done";
        bot.completedAt = Date.now();
        broadcast(bot);
        return;
      }

      if (op.op === "failed") {
        bot.steps.push({ action: "failed", detail: op.reason, at: Date.now() });
        bot.status = "failed";
        bot.error = op.reason ?? "Bot determined goal cannot be completed";
        bot.completedAt = Date.now();
        broadcast(bot);
        return;
      }

      /* Jev gate */
      const gate = await jevGate(bot.goal, op, results, i, opsToRun.length);
      if (gate === "abort") {
        bot.steps.push({ action: "aborted", detail: `Jev aborted at: ${op.op}`, at: Date.now() });
        bot.status = "failed";
        bot.error = "Jev determined this step is unsafe or wrong";
        bot.completedAt = Date.now();
        broadcast(bot);
        return;
      }
      if (gate === "skip") {
        bot.steps.push({ action: "skipped", detail: op.op, at: Date.now() });
        results.push({ op: op.op, input: op, ok: true, detail: "Skipped by Jev" });
        broadcast(bot);
        continue;
      }

      const result = await executeOp(op);
      bot.steps.push({
        action: op.op,
        target: op.path ?? op.from ?? op.cmd ?? op.target ?? op.url ?? null,
        detail: result.detail ?? (result.ok ? "ok" : "failed"),
        at: Date.now(),
      });
      results.push({ op: op.op, input: op, ok: result.ok, detail: result.detail });
      broadcast(bot);
    }
  }

  if (bot.aborted) {
    bot.status = "stopped";
  } else {
    bot.status = "failed";
    bot.error = "Reached round limit";
  }
  bot.completedAt = Date.now();
  broadcast(bot);
}

/* --------------------------------------------------------- Phase 1: THINK */

async function generatePlan(goal, home, roots, prevResults, steps) {
  const pathNote = IS_WIN
    ? "Use backslashes in paths (Windows)."
    : "Use forward slashes in paths (macOS/Linux).";

  const hotkeyNote = IS_WIN
    ? 'Hotkey format: SendKeys notation — ^s = Ctrl+S, %{F4} = Alt+F4, {ENTER}, {TAB}'
    : 'Hotkey format: AppleScript keystroke — e.g. "s" using command down, "q" using command down';

  const shellNote = IS_WIN
    ? "Shell: PowerShell. Use PowerShell syntax."
    : "Shell: bash. Use bash syntax.";

  /* Recall relevant memories so the bot knows what the user knows */
  let memoryBlock = "";
  try {
    const pack = brain.recall(goal, { limit: 10, budgetTokens: 2000 });
    const lines = [];
    for (const e of pack.entities) lines.push(e.line);
    for (const d of pack.digests) lines.push(`${d.label}: ${d.summary}`);
    for (const ep of pack.episodes) lines.push(ep.line);
    if (lines.length > 0) memoryBlock = lines.join("\n");
  } catch { /* brain not ready — proceed without memory */ }

  /* Also load user profile if available */
  let profileBlock = "";
  try {
    const profile = require("./profile");
    const p = profile.getProfile();
    if (p?.portrait) profileBlock = p.portrait;
  } catch {}

  const context = [
    `Goal: ${goal}`,
    `Platform: ${PLATFORM}`,
    `Home directory: ${home}`,
    `Allowed folders: ${roots.join(", ") || home}`,
    `Current time: ${new Date().toLocaleString()}`,
    pathNote,
    hotkeyNote,
    shellNote,
  ];

  if (memoryBlock) {
    context.push(`\n--- DOPPEL'S MEMORY (what the user has been working on) ---`);
    context.push(memoryBlock);
    context.push(`--- END MEMORY ---`);
  }

  if (profileBlock) {
    context.push(`\nUser profile: ${profileBlock}`);
  }

  if (prevResults.length > 0) {
    context.push(`\nPrevious results (most recent):`);
    for (const r of prevResults.slice(-15)) {
      const inp = r.op === "list" ? r.input.path
        : r.op === "shell" ? r.input.cmd
        : r.input.from ?? r.input.path ?? r.input.url ?? "";
      context.push(`  ${r.op} ${inp} → ${r.ok ? "ok" : "FAILED"}: ${String(r.detail).slice(0, 500)}`);
    }
  }

  if (steps.length > 0) {
    context.push(`\nSteps completed so far: ${steps.length}`);
  }

  const result = await claude.ask({
    system: PLAN_SYSTEM,
    messages: [
      { role: "user", content: context.join("\n") },
    ],
    schema: {
      type: "object",
      properties: {
        thinking: { type: "string" },
        plan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string" },
              path: { type: "string" },
              from: { type: "string" },
              to: { type: "string" },
              content: { type: "string" },
              cmd: { type: "string" },
              target: { type: "string" },
              url: { type: "string" },
              text: { type: "string" },
              keys: { type: "string" },
              ms: { type: "number" },
              summary: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
      },
      required: ["plan"],
    },
    effort: "high",
    maxTokens: PLAN_MAX_TOKENS,
    thinking: true,
  });

  if (!result.ok) return { ok: false, detail: result.detail ?? result.reason };
  return { ok: true, operations: result.value.plan, thinking: result.value.thinking };
}

/* ----------------------------------------------- Phase 2: JEV GATE (fast) */

async function jevGate(goal, op, prevResults, stepIndex, totalSteps) {
  /* Skip Jev for cheap/safe ops and GUI automation — the bot already passed
     clarification + planning.  Only gate filesystem mutations and shell commands. */
  const safeOps = new Set([
    "wait", "list", "read", "look", "thinking", "done", "failed",
    "paste", "type", "hotkey", "launch", "open_url",
  ]);
  if (safeOps.has(op.op)) return "proceed";

  const failCount = prevResults.filter((r) => !r.ok).length;
  const lastResults = prevResults.slice(-5).map((r) =>
    `${r.op}(${r.input.path ?? r.input.from ?? r.input.cmd ?? r.input.target ?? "..."}) → ${r.ok ? "ok" : "FAILED"}`
  ).join("; ");

  const target = op.path ?? op.from ?? op.cmd ?? op.target ?? op.url ?? "";
  const hasContent = Boolean(op.content || op.text);

  const state = {
    goal,
    progress: `Step ${stepIndex + 1} of ${totalSteps}`,
    failedSoFar: failCount,
    operation: op.op,
    target: target.length > 200 ? target.slice(0, 200) + "..." : target,
    modifiesFiles: ["move", "copy", "delete", "write", "append", "mkdir"].includes(op.op),
    runsCode: op.op === "shell",
    hasLargeContent: hasContent && (op.content?.length ?? op.text?.length ?? 0) > 500,
    recentResults: lastResults || "none yet",
  };

  const { verdict, confidence } = await jev.decideWithScore(
    state,
    "Should this operation execute right now?",
    {
      proceed: "Execute — this step is safe and logical for the goal",
      skip:    "Skip — this step is redundant, already done, or unnecessary",
      abort:   "Abort — this step is dangerous, destructive, or clearly wrong for the goal",
    },
    "This operation is safe and reversible (no permanent data loss, no external side effects)",
    "proceed",
    0.8,
  );

  /* If Jev says proceed but rates it as very unsafe, downgrade to skip */
  if (verdict === "proceed" && confidence < 0.15) return "skip";
  return verdict;
}

/* -------------------------------------------------------- Phase 2: EXECUTE */

async function executeOp(op) {
  try {
    switch (op.op) {

      case "list": {
        const dir = op.path;
        if (!dir || !fs.existsSync(dir)) return { ok: false, detail: `Directory not found: ${dir}` };
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const items = entries.map((e) => {
          const full = path.join(dir, e.name);
          try {
            const stat = fs.statSync(full);
            return {
              name: e.name,
              type: e.isDirectory() ? "dir" : "file",
              size: stat.size,
              modified: stat.mtime.toISOString(),
            };
          } catch {
            return { name: e.name, type: e.isDirectory() ? "dir" : "file" };
          }
        });
        return { ok: true, detail: JSON.stringify(items) };
      }

      case "move": {
        if (!op.from || !op.to) return { ok: false, detail: "Missing from/to" };
        if (!fs.existsSync(op.from)) return { ok: false, detail: `Not found: ${op.from}` };
        const toDir = path.dirname(op.to);
        if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
        fs.renameSync(op.from, op.to);
        /* Verify: destination exists, source is gone */
        if (!fs.existsSync(op.to)) return { ok: false, detail: `Move failed — ${op.to} not found after move` };
        if (fs.existsSync(op.from)) return { ok: false, detail: `Move incomplete — source still exists at ${op.from}` };
        return { ok: true, detail: `Moved ${path.basename(op.from)} → ${path.basename(op.to)}` };
      }

      case "copy": {
        if (!op.from || !op.to) return { ok: false, detail: "Missing from/to" };
        if (!fs.existsSync(op.from)) return { ok: false, detail: `Not found: ${op.from}` };
        const copyDir = path.dirname(op.to);
        if (!fs.existsSync(copyDir)) fs.mkdirSync(copyDir, { recursive: true });
        fs.copyFileSync(op.from, op.to);
        /* Verify: destination exists and has content */
        if (!fs.existsSync(op.to)) return { ok: false, detail: `Copy failed — ${op.to} not found after copy` };
        const copyStat = fs.statSync(op.to);
        const srcStat = fs.statSync(op.from);
        if (copyStat.size !== srcStat.size) return { ok: false, detail: `Copy mismatch — src ${srcStat.size}B vs dest ${copyStat.size}B` };
        return { ok: true, detail: `Copied ${path.basename(op.from)} → ${path.basename(op.to)} (${copyStat.size}B)` };
      }

      case "mkdir": {
        if (!op.path) return { ok: false, detail: "Missing path" };
        fs.mkdirSync(op.path, { recursive: true });
        /* Verify */
        if (!fs.existsSync(op.path)) return { ok: false, detail: `mkdir failed — ${op.path} not found` };
        return { ok: true, detail: `Created ${op.path}` };
      }

      case "delete": {
        if (!op.path) return { ok: false, detail: "Missing path" };
        if (!fs.existsSync(op.path)) return { ok: false, detail: `Not found: ${op.path}` };
        const trashDir = path.join(db.paths().base, "trash");
        if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
        const trashName = `${Date.now()}_${path.basename(op.path)}`;
        fs.renameSync(op.path, path.join(trashDir, trashName));
        /* Verify: original path is gone */
        if (fs.existsSync(op.path)) return { ok: false, detail: `Delete failed — ${op.path} still exists` };
        return { ok: true, detail: `Moved to trash: ${path.basename(op.path)}` };
      }

      case "read": {
        if (!op.path) return { ok: false, detail: "Missing path" };
        if (!fs.existsSync(op.path)) return { ok: false, detail: `Not found: ${op.path}` };
        const content = fs.readFileSync(op.path, "utf8");
        const lines = content.split("\n");
        const truncated = lines.slice(0, 500).join("\n");
        return { ok: true, detail: truncated.slice(0, 5000) };
      }

      case "write": {
        if (!op.path || op.content == null) return { ok: false, detail: "Missing path or content" };
        const writeDir = path.dirname(op.path);
        if (!fs.existsSync(writeDir)) fs.mkdirSync(writeDir, { recursive: true });
        fs.writeFileSync(op.path, op.content, "utf8");
        /* Verify: file exists and has expected size */
        if (!fs.existsSync(op.path)) return { ok: false, detail: `Write failed — file not found after write` };
        const writeStat = fs.statSync(op.path);
        if (writeStat.size === 0 && op.content.length > 0) return { ok: false, detail: `Write failed — file is empty` };
        return { ok: true, detail: `Wrote ${op.path} (${writeStat.size}B, ${op.content.split("\n").length} lines)` };
      }

      case "append": {
        if (!op.path || op.content == null) return { ok: false, detail: "Missing path or content" };
        const prevSize = fs.existsSync(op.path) ? fs.statSync(op.path).size : 0;
        fs.appendFileSync(op.path, op.content, "utf8");
        /* Verify: file grew */
        const newSize = fs.existsSync(op.path) ? fs.statSync(op.path).size : 0;
        if (newSize <= prevSize && op.content.length > 0) return { ok: false, detail: `Append failed — file didn't grow (${prevSize}B → ${newSize}B)` };
        return { ok: true, detail: `Appended to ${op.path} (${prevSize}B → ${newSize}B)` };
      }

      case "shell":
        if (!op.cmd) return { ok: false, detail: "Missing cmd" };
        return await runShell(op.cmd);

      case "launch":
        if (!op.target) return { ok: false, detail: "Missing target" };
        return await launchApp(op.target);

      case "open_url":
        if (!op.url) return { ok: false, detail: "Missing url" };
        return await openUrl(op.url);

      case "paste":
        if (!op.text) return { ok: false, detail: "Missing text" };
        return await pasteText(op.text);

      case "type":
        if (!op.text) return { ok: false, detail: "Missing text" };
        return await typeText(op.text);

      case "hotkey":
        if (!op.keys) return { ok: false, detail: "Missing keys" };
        return await pressHotkey(op.keys);

      case "wait": {
        const ms = op.ms ?? 1000;
        await sleep(ms);
        return { ok: true, detail: `${ms}ms` };
      }

      case "look": {
        /* Capture the screen and describe what's visible — lets the bot verify its work */
        try {
          const screenMod = require("./screen");
          const claude = require("./claude");
          const shot = await screenMod.capture({ maxEdge: 1366 });
          if (!shot.ok) return { ok: false, detail: "Could not capture screen" };
          const desc = await claude.ask({
            system: "Describe what is currently visible on this screen in 2-3 sentences. Focus on: what app/page is open, whether there is any text content visible, and what state it appears to be in (loading, empty, filled, error dialog, etc.).",
            messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: shot.base64 } }, { type: "text", text: op.check ?? "Describe what you see on screen." }] }],
            effort: "low",
            maxTokens: 300,
          });
          if (!desc.ok) return { ok: false, detail: "Could not describe screen" };
          return { ok: true, detail: desc.text ?? "No description" };
        } catch (err) {
          return { ok: false, detail: `Screen check failed: ${err.message}` };
        }
      }

      case "thinking":
        return { ok: true, detail: "thinking" };

      default:
        return { ok: false, detail: `Unknown operation: ${op.op}` };
    }
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/* ------------------------------------------------- cross-platform helpers */

function runShell(cmd) {
  return new Promise((resolve) => {
    const opts = { timeout: 30000, maxBuffer: 1024 * 1024 };
    if (IS_WIN) {
      opts.shell = "powershell.exe";
    } else {
      opts.shell = "/bin/bash";
    }
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, detail: (stderr || err.message).slice(0, 2000) });
      } else {
        resolve({ ok: true, detail: (stdout || "").trim().slice(0, 5000) });
      }
    });
  });
}

async function launchApp(target) {
  if (IS_WIN) {
    const results = await win32.act([{ kind: "launch", target }]);
    const last = results[results.length - 1];
    return { ok: last?.ok ?? false, detail: last?.detail ?? target };
  }
  /* macOS — use `open -a` */
  return runShell(`open -a "${target.replace(/"/g, '\\"')}"`);
}

async function openUrl(url) {
  if (IS_WIN) {
    return runShell(`Start-Process "${url}"`);
  }
  /* macOS */
  return runShell(`open "${url.replace(/"/g, '\\"')}"`);
}

async function pasteText(text) {
  /* Copy to clipboard, then Ctrl+V / Cmd+V — handles multi-line text correctly */
  if (IS_WIN) {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    await sleep(50);
    const results = await win32.act([{ kind: "hotkey", keys: "^v" }]);
    const last = results[results.length - 1];
    return { ok: last?.ok ?? false, detail: `Pasted ${text.length} chars` };
  }
  /* macOS — use pbcopy + Cmd+V. printf avoids trailing newline from echo. */
  const escaped = text.replace(/'/g, "'\\''");
  const copyResult = await runShell(`printf '%s' '${escaped}' | pbcopy`);
  if (!copyResult.ok) return copyResult;
  await sleep(50);
  return runShell(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
}

async function typeText(text) {
  if (IS_WIN) {
    const results = await win32.act([{ kind: "type", text }]);
    const last = results[results.length - 1];
    return { ok: last?.ok ?? false, detail: `Typed ${text.length} chars` };
  }
  /* macOS — use osascript to type. Split into chunks to avoid issues with long text. */
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const chunks = [];
  for (let i = 0; i < escaped.length; i += 500) {
    chunks.push(escaped.slice(i, i + 500));
  }
  for (const chunk of chunks) {
    const result = await runShell(
      `osascript -e 'tell application "System Events" to keystroke "${chunk}"'`
    );
    if (!result.ok) return result;
  }
  return { ok: true, detail: `Typed ${text.length} chars` };
}

async function pressHotkey(keys) {
  if (IS_WIN) {
    const results = await win32.act([{ kind: "hotkey", keys }]);
    const last = results[results.length - 1];
    return { ok: last?.ok ?? false, detail: keys };
  }
  /* macOS — keys should be AppleScript format, pass through directly */
  return runShell(`osascript -e '${keys}'`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  configured,
  resetClient,
  setEmitter,
  createBot,
  respondToBot,
  stopBot,
  listBots,
  botStatus,
  clearBot,
};
