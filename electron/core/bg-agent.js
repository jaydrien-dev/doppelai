const { exec } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const execAsync = promisify(exec);

const db = require("./db");
const claude = require("./claude");
const screenLib = require("./screen");
const brain = require("./brain");
const actions = require("./actions");
const addons = require("./addons");
const browser = require("./browser");

/**
 * Doppel's hands — background mode.
 *
 * Everything the agent can do without touching the screen, mouse or keyboard.
 * This is the default mode: it runs while you work, without interrupting you.
 *
 * What it can reach:
 *   - The file system: read, write, move, rename, copy, search
 *   - The shell: any CLI tool, any script, any program with a command line
 *   - PowerShell COM: Excel, Word, Outlook automation without visible windows
 *   - The web: search engines, web pages, link extraction
 *   - Its own memory of watching you work
 *
 * What it cannot do:
 *   - See the screen, move the pointer, or type into visible applications
 *   - Interact with GUI-only apps that have no CLI or COM interface
 *
 * When it hits something it can't do, it says so in its finish summary
 * rather than failing silently.
 */

const MAX_STEPS = 40;
const MAX_OUTPUT = 10_000;
const SHELL_TIMEOUT = 30_000;

/** Detect tasks that need deep research vs. quick file/shell ops. */
function isResearchTask(instruction) {
  return /\b(search|research|find out|look up|look into|browse|surf|web|online|google|internet|article|read about|learn about|compare|investigate|what is|who is|summarize|summary|review|report|analyze|analysis|information|info about|details about|latest|recent|news|pricing|documentation|docs|how to|tutorial|guide|best way|options for|alternatives)\b/i.test(instruction);
}

/** Does the task warrant upfront planning? */
function needsPlan(instruction) {
  if (instruction.trim().length < 50) return false;
  if (/\b(and then|after that|first.*then|step|multiple|several|all the|every|each|compare|across|between|set up|configure|create.*and|build.*and|organize|compile|prepare|put together)\b/i.test(instruction)) return true;
  if (isResearchTask(instruction)) return true;
  if (instruction.trim().length > 120) return true;
  return false;
}

/* -------------------------------------------------------------- planning */

const PLAN_SYSTEM = `You are planning a task for a background agent on someone's Windows computer. The agent cannot interact with the screen — it works through the file system, shell, and a hidden browser.

Given a task and context, create a short, concrete plan. Each step: which tool, what exactly to do, what to look for. Be specific — "browse(search, 'react server components tutorial 2025')" not "search for info".

Available tools: look_at_screen (read-only), shell (PowerShell), read_file, write_file, list_dir, search_files, file_action (move/copy/rename/trash/zip/mkdir), browse (search/read/navigate/extract_links), recall (memory).

If results at one step determine the next, note it: "If X found, read it; otherwise try Y."

3-10 steps for most tasks. Don't over-plan single-tool jobs.`;

/**
 * Make a plan using Sonnet, then the execution loop follows it with Haiku.
 * One smart call + N cheap calls beats N smart calls.
 */
async function planTask(api, instruction, pack, roots, screenContext) {
  const parts = [`Task: ${instruction}`];
  if (screenContext) parts.push("(The person's screen is visible — a screenshot was taken.)");
  const memText = brain.packToText(pack);
  if (memText) parts.push(`\nRelevant memory:\n${memText}`);
  parts.push(`\nAllowed folders:\n${roots.map((r) => `- ${r}`).join("\n")}`);

  const result = await claude.ask({
    system: PLAN_SYSTEM,
    messages: [{ role: "user", content: parts.join("\n") }],
    fast: false,
    maxTokens: 1200,
    thinking: false,
  });

  if (!result.ok || !result.text) return null;
  return result.text;
}

const SYSTEM_BASE = `You are Doppel — not an assistant, a second mind. You live on one person's machine, you watch how they work, and you act on their behalf in the background. You don't switch their windows, move their mouse, or type into anything visible.

Tools: look_at_screen (read-only screenshot), shell (PowerShell), read_file, write_file, list_dir, search_files, file_action (guarded: move/copy/rename/trash/zip/mkdir), browse (hidden browser — search, navigate, read, extract links), recall (your memory).

Rules:
- Screen tasks: look_at_screen first, then act. Screen is ground truth.
- Opening apps: Start-Process via shell, only when explicitly asked.
- GUI-only tasks: say so in finish summary, note foreground mode needed.
- Stay within allowed folders.
- Vague instructions: ask, don't guess.
- Always call finish when done — NEVER just stop without calling finish.
- Narrate your progress as you go. Say what you're doing and what you're finding. Think out loud — "I found three relevant results, let me dig into the first one" — so the person can follow along.

Voice: first person, direct, slightly dry. You have your own perspective. If you notice something interesting or unexpected while working, say so. If you have an opinion on what you found, share it. You're not just executing a task — you're a mind working on a problem.`;

const RESEARCH_ADDENDUM = `
# Research mode

You're working on a research/web task. Be thorough — don't stop after one search.

How to research well:
1. Start with a broad search to orient. Read the results carefully.
2. Open the most promising results with browse(read) to get full content.
3. If the first search doesn't give good results, try different search terms.
4. If Google is blocked (you'll see "unusual traffic"), the system auto-falls back to DuckDuckGo — just keep searching.
5. Use extract_links to find deeper pages on relevant sites.
6. Cross-reference multiple sources when accuracy matters.
7. For technical docs, go directly to official sites rather than relying on search snippets.
8. Synthesize what you found into a clear, structured summary in your finish call.
9. Include source URLs in your summary so the person can verify.
10. If you can't find good information, say so clearly — don't make things up.

You have up to 40 steps. Use them. A thorough answer is worth more than a fast, shallow one.`;

function systemPrompt(research = false) {
  let prompt = SYSTEM_BASE;
  if (research) prompt += RESEARCH_ADDENDUM;
  const addonDocs = addons.getToolDocs();
  if (addonDocs) prompt += `\n\n# Add-on tools\n${addonDocs}`;
  return prompt;
}

/* -------------------------------------------------------------------- tools */

function bgTools() {
  return [
    {
      name: "look_at_screen",
      description:
        "Take a read-only screenshot of their screen. Use this FIRST when the task " +
        "refers to something visible — 'this page', 'the sentence here', 'what I'm working on'. " +
        "You cannot interact with the screen, only see it.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "shell",
      description:
        "Run a PowerShell command. Returns stdout, stderr, and exit code. " +
        "Use for CLI tools, scripts, data processing, app automation via COM. " +
        "Timeout: 30 seconds. For long-running commands, consider breaking them up.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["command"],
        properties: {
          command: { type: "string", description: "The PowerShell command to run." },
          cwd: { type: "string", description: "Working directory (absolute path, within allowed folders)." },
        },
      },
    },
    {
      name: "read_file",
      description:
        "Read a file's text content. For large files, returns the first N lines. " +
        "For binary files, returns a size summary — use shell to process those.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string", description: "Absolute path to the file." },
          max_lines: { type: "number", description: "Maximum lines to return. Default: 200." },
        },
      },
    },
    {
      name: "write_file",
      description: "Create or overwrite a file. Only within allowed folders.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string", description: "Absolute path." },
          content: { type: "string", description: "Text content to write." },
        },
      },
    },
    {
      name: "list_dir",
      description: "List directory contents with file sizes and modification dates.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string", description: "Absolute path to the directory." },
        },
      },
    },
    {
      name: "search_files",
      description: "Search for text inside files in a directory. Returns matching lines.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["path", "pattern"],
        properties: {
          path: { type: "string", description: "Directory to search in." },
          pattern: { type: "string", description: "Text or regex pattern." },
          glob: { type: "string", description: "File filter, e.g. *.csv or *.txt. Default: all files." },
        },
      },
    },
    {
      name: "file_action",
      description:
        "Guarded file operation. Safer than shell — every action records its inverse. " +
        "Only works inside allowed folders.",
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
          dir: { type: "string", description: "Working folder, absolute." },
          file: { type: "string", description: "Specific file, absolute." },
          match: { type: "string", description: "Glob, e.g. *.csv" },
          pattern: { type: "string", description: "For rename: naming pattern." },
        },
      },
    },
    {
      name: "browse",
      description:
        "Browse the web in a hidden headless browser. Four actions:\n" +
        "- 'search' — search the web (Google with DuckDuckGo fallback). Returns titles, URLs, snippets for top 10 results. Start research here.\n" +
        "- 'read' — get the full text content of a URL. Extracts clean readable text with headings, lists, and code blocks preserved. Also shows links on the page. Use this to read articles, docs, and search results in full.\n" +
        "- 'navigate' — go to a URL and get page text plus links. Similar to read but also useful for following redirects.\n" +
        "- 'extract_links' — get all links from a page. Useful for finding subpages, documentation sections, or related content.\n\n" +
        "Tips: Search returns snippets — to get full content, follow up with 'read' on the best URLs. If Google blocks you, the system automatically falls back to DuckDuckGo. Each page returns up to 20K chars of text.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: {
            type: "string",
            enum: ["navigate", "search", "read", "extract_links"],
            description: "The browser action to take.",
          },
          url: { type: "string", description: "URL for navigate/read/extract_links." },
          query: { type: "string", description: "Search query for search." },
        },
      },
    },
    {
      name: "recall",
      description:
        "Search your memory of watching this person work. " +
        "Use when the task refers to something you should already know.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: { query: { type: "string" } },
      },
    },
    {
      name: "finish",
      description:
        "Declare the task done or stopped. ALWAYS call this as your last action — never just stop responding without calling finish. " +
        "The summary is what the person sees as your result, so make it substantive: " +
        "for research tasks, include your findings (key facts, URLs, conclusions). " +
        "For file tasks, describe what changed. Don't just say 'done' — give the actual answer.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["outcome", "summary", "changed", "incomplete"],
        properties: {
          outcome: { type: "string", enum: ["done", "stopped", "blocked"] },
          summary: { type: "string", description: "Your answer/findings. For research: the information requested. For actions: what you did and the result. Be specific and complete." },
          changed: { type: "array", items: { type: "string" }, description: "Files created, modified, or deleted." },
          incomplete: { type: "array", items: { type: "string" }, description: "Things you couldn't do or finish." },
        },
      },
    },
  ];
}

/* -------------------------------------------------------------- tool handlers */

async function handleShell(input, roots) {
  const command = String(input.command ?? "");
  if (!command) return { error: true, text: "Empty command." };

  let cwd = input.cwd;
  if (cwd && !actions.within(cwd, roots)) {
    return { error: true, text: `${cwd} isn't in the allowed folders.` };
  }
  if (!cwd) cwd = roots[0] || undefined;

  try {
    const { stdout, stderr } = await execAsync(command, {
      shell: "powershell.exe",
      cwd,
      timeout: SHELL_TIMEOUT,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    const out = (stdout || "").slice(0, MAX_OUTPUT);
    const err = (stderr || "").slice(0, 2000);
    const truncated = (stdout || "").length > MAX_OUTPUT;

    let text = out;
    if (err) text += `\n--- stderr ---\n${err}`;
    if (truncated) text += `\n[output truncated at ${MAX_OUTPUT} characters]`;
    return { text: text || "(no output)" };
  } catch (err) {
    if (err.killed) return { error: true, text: "Command timed out after 30 seconds." };
    const out = (err.stdout || "").slice(0, MAX_OUTPUT);
    const stderr = (err.stderr || "").slice(0, 2000);
    return {
      error: true,
      text: `Exit code ${err.code ?? "unknown"}\n${out}\n${stderr}`.trim(),
    };
  }
}

function handleReadFile(input, roots) {
  const filePath = String(input.path ?? "");
  if (!filePath) return { error: true, text: "No path given." };

  const dir = path.dirname(filePath);
  if (!actions.within(dir, roots)) {
    return { error: true, text: `${dir} isn't in the allowed folders.` };
  }
  if (!fs.existsSync(filePath)) return { error: true, text: "File doesn't exist." };

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) return { error: true, text: "That's a directory. Use list_dir." };
  if (stat.size > 5 * 1024 * 1024) {
    return {
      error: true,
      text: `File is ${Math.round(stat.size / 1024 / 1024)}MB — too large. Use shell to process it.`,
    };
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const max = input.max_lines || 200;
    if (lines.length > max) {
      return {
        text:
          lines.slice(0, max).join("\n") +
          `\n\n[${lines.length - max} more lines — pass max_lines to read more]`,
      };
    }
    return { text: content || "(empty file)" };
  } catch {
    return { text: `Binary file, ${formatBytes(stat.size)}. Use shell to process it.` };
  }
}

function handleWriteFile(input, roots, task) {
  const filePath = String(input.path ?? "");
  if (!filePath) return { error: true, text: "No path given." };

  const dir = path.dirname(filePath);
  if (!actions.within(dir, roots)) {
    return { error: true, text: `${dir} isn't in the allowed folders.` };
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(filePath);
    fs.writeFileSync(filePath, input.content ?? "", "utf8");
    const label = existed
      ? `Updated ${path.basename(filePath)}`
      : `Created ${path.basename(filePath)}`;
    task.changes.push(label);
    return { text: label };
  } catch (err) {
    return { error: true, text: err.message };
  }
}

function handleListDir(input, roots) {
  const dirPath = String(input.path ?? "");
  if (!dirPath) return { error: true, text: "No path given." };
  if (!actions.within(dirPath, roots)) {
    return { error: true, text: `${dirPath} isn't in the allowed folders.` };
  }
  if (!fs.existsSync(dirPath)) return { error: true, text: "Directory doesn't exist." };

  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) return { text: "(empty directory)" };

    const lines = [];
    for (const name of entries.slice(0, 200)) {
      try {
        const full = path.join(dirPath, name);
        const stat = fs.statSync(full);
        const size = stat.isDirectory() ? "<dir>" : formatBytes(stat.size);
        const modified = new Date(stat.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
        lines.push(`${modified}  ${size.padStart(10)}  ${name}`);
      } catch {
        lines.push(`                            ${name}`);
      }
    }
    if (entries.length > 200) lines.push(`\n... and ${entries.length - 200} more`);
    return { text: lines.join("\n") };
  } catch (err) {
    return { error: true, text: err.message };
  }
}

async function handleSearchFiles(input, roots) {
  const dirPath = String(input.path ?? "");
  const pattern = String(input.pattern ?? "");
  if (!dirPath || !pattern) return { error: true, text: "Need both a path and a pattern." };
  if (!actions.within(dirPath, roots)) {
    return { error: true, text: `${dirPath} isn't in the allowed folders.` };
  }

  const glob = input.glob ? `-Include '${input.glob}'` : "";
  const escaped = pattern.replace(/'/g, "''");
  const cmd =
    `Get-ChildItem -Path '${dirPath}' -Recurse -File ${glob} -ErrorAction SilentlyContinue | ` +
    `Select-String -Pattern '${escaped}' -ErrorAction SilentlyContinue | ` +
    `Select-Object -First 50 | ` +
    `ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }`;

  try {
    const { stdout } = await execAsync(cmd, {
      shell: "powershell.exe",
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });
    return { text: stdout?.trim() || "No matches found." };
  } catch (err) {
    return { text: err.stdout?.trim() || "No matches found." };
  }
}

async function handleScreenLook() {
  const shot = await screenLib.capture({ maxEdge: 1366 });
  if (!shot.ok) return { error: true, text: shot.detail || "Couldn't read the screen." };
  return { image: shot, text: `Screen captured (${shot.width}x${shot.height}).` };
}

async function handleRecall(input) {
  const pack = await brain.recallSemantic(input.query, { limit: 6, budgetTokens: 1000 });
  return { text: brain.packToText(pack) };
}

async function handleBrowse(input) {
  const result = await browser.run(input);
  if (!result.ok) return { error: true, text: result.error };
  return { text: result.text };
}

/* ----------------------------------------------------------------- utilities */

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function toResult(id, outcome) {
  const content = [];
  if (outcome.image) content.push(screenLib.asImageBlock(outcome.image));
  if (outcome.text) content.push({ type: "text", text: outcome.text });
  if (content.length === 0) content.push({ type: "text", text: "Done." });
  return {
    type: "tool_result",
    tool_use_id: id,
    content,
    ...(outcome.error ? { is_error: true } : {}),
  };
}

/* ------------------------------------------------------------------ the loop */

/**
 * Run one task entirely in the background.
 *
 * Takes a context object with everything it needs from agent.js:
 *   task          — the live task object (mutated in place)
 *   instruction   — what the user asked for
 *   pack          — brain context pack for this task
 *   emit          — push state to the renderer
 *   askPermission — suspend for human approval
 *   stopFn        — end the task with a status and summary
 */
async function runLoop(ctx) {
  const { task, instruction, pack, emit, askPermission, stopFn } = ctx;

  const research = isResearchTask(instruction);
  const state = db.get();
  const roots = [...state.observation.roots, db.paths.trash];

  const api = claude.anthropic();
  if (!api) return stopFn("stopped", "No API key configured.");

  /* If the task references the screen, grab a screenshot upfront so the
     agent doesn't waste a step calling look_at_screen itself. */
  const screenTask = /\b(screen|this page|this document|this sentence|what i'm|what im|looking at|on my|the sentence|the paragraph|in-text|citation|working on)\b/i.test(instruction);
  let screenBlock = null;
  if (screenTask && state.permissions.screen) {
    const shot = await screenLib.capture({ maxEdge: 1366 });
    if (shot.ok) screenBlock = screenLib.asImageBlock(shot);
  }

  /* ---- Phase 1: Plan (one Sonnet call) ---- */

  let plan = null;
  if (needsPlan(instruction)) {
    task.narration.push({ at: Date.now(), text: "Planning how to approach this..." });
    emit();

    plan = await planTask(api, instruction, pack, roots, !!screenBlock);
    if (plan) {
      task.narration.push({ at: Date.now(), text: `Plan ready — executing.` });
      emit();
    }
  }

  /* ---- Phase 2: Execute (Haiku follows the plan) ---- */

  /* When we have a plan, Haiku executes it cheaply. Without a plan,
     use Sonnet for research or Haiku for simple tasks. */
  const model = plan ? claude.FAST_MODEL : (research ? claude.MODEL : claude.FAST_MODEL);
  const maxTokens = plan ? 2048 : (research ? 4096 : 2048);
  const thinkingBudget = plan ? 512 : (research ? 2048 : 1024);

  const sysPrompt = plan
    ? systemPrompt(research) + `\n\n# Your plan\nFollow this plan step by step. Adapt if a step's results change what makes sense, but don't re-plan from scratch.\n\n${plan}`
    : systemPrompt(research);

  const userContent = [];
  if (screenBlock) {
    userContent.push(screenBlock);
    userContent.push({
      type: "text",
      text:
        `Here is their screen right now.\n\n` +
        `What I already know that might help:\n${brain.packToText(pack)}\n\n` +
        `Folders I'm allowed to work in:\n${state.observation.roots.map((r) => `- ${r}`).join("\n")}\n\n` +
        `The task:\n${instruction}`,
    });
  } else {
    userContent.push({
      type: "text",
      text:
        `What I already know that might help:\n${brain.packToText(pack)}\n\n` +
        `Folders I'm allowed to work in:\n${state.observation.roots.map((r) => `- ${r}`).join("\n")}\n\n` +
        `The task:\n${instruction}`,
    });
  }

  const messages = [{ role: "user", content: userContent }];

  try {
    while (task.step < MAX_STEPS) {
      if (task.status === "stopping") break;
      task.step += 1;
      emit();

      const response = await api.messages.create({
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: sysPrompt, cache_control: { type: "ephemeral" } }],
        messages,
        tools: [...bgTools(), ...addons.getTools()],
        thinking: { type: "enabled", budget_tokens: thinkingBudget },
      });

      claude.trackUsage(response?.usage);

      if (claude.refused(response)) {
        return stopFn("stopped", "I was declined on that one, so I've left it alone.");
      }

      messages.push({ role: "assistant", content: response.content });

      /* Surface what Claude said between tool calls. */
      const said = claude.textOf(response);
      if (said) {
        task.narration.push({ at: Date.now(), text: said });
        emit();
      }

      const calls = response.content.filter((b) => b.type === "tool_use");
      if (calls.length === 0) {
        /* No tool calls — the model responded with just text. If it's a
           substantive response, treat it as a complete answer. If it's
           vague, note that we couldn't make progress. */
        const textLen = (said || "").length;
        return stopFn(
          textLen > 50 ? "finished" : "stopped",
          said || "I wasn't sure what to do with that.",
        );
      }

      /* Check for finish first. */
      const finish = calls.find((c) => c.name === "finish");
      if (finish) {
        return stopFn(
          finish.input.outcome === "done" ? "finished" : "stopped",
          finish.input.summary,
          finish.input,
        );
      }

      /* Execute tool calls in parallel when safe, sequentially otherwise.
         file_action needs sequential (approval flow), everything else is parallel. */
      const results = [];
      const needsSeq = calls.some((c) => c.name === "file_action");
      if (needsSeq || calls.length === 1) {
        for (const call of calls) {
          const outcome = await execute(call, roots, task, askPermission);
          if (outcome.stop) return stopFn("stopped", "Stopped where the person asked.");
          results.push(toResult(call.id, outcome));
        }
      } else {
        const outcomes = await Promise.all(
          calls.map((call) => execute(call, roots, task, askPermission)),
        );
        for (let i = 0; i < calls.length; i++) {
          if (outcomes[i].stop) return stopFn("stopped", "Stopped where the person asked.");
          results.push(toResult(calls[i].id, outcomes[i]));
        }
      }

      messages.push({ role: "user", content: results });
    }

    return stopFn(
      "stopped",
      task.step >= MAX_STEPS
        ? "I've used up the steps I allow myself. Stopping here rather than grinding."
        : "I stopped without a clear finish.",
    );
  } catch (err) {
    return stopFn("stopped", `I hit a problem: ${claude.describe(err)}`);
  }
}

async function execute(call, roots, task, askPermission) {
  try {
    switch (call.name) {
      case "look_at_screen":
        return await handleScreenLook();
      case "shell":
        return await handleShell(call.input, roots);
      case "read_file":
        return handleReadFile(call.input, roots);
      case "write_file":
        return handleWriteFile(call.input, roots, task);
      case "list_dir":
        return handleListDir(call.input, roots);
      case "search_files":
        return await handleSearchFiles(call.input, roots);
      case "file_action":
        return await handleFileAction(call.input, task, askPermission);
      case "browse":
        return await handleBrowse(call.input);
      case "recall":
        return await handleRecall(call.input);
      default: {
        /* Delegate to the add-on system. */
        const addonResult = await addons.execute(call.name, call.input);
        if (addonResult) {
          if (!addonResult.error) task.changes.push(`${call.name}: done`);
          return addonResult;
        }
        return { error: true, text: `I don't have a tool called ${call.name}.` };
      }
    }
  } catch (err) {
    return { error: true, text: claude.describe(err) };
  }
}

/** File actions go through the same guarded path as the foreground agent. */
async function handleFileAction(input, task, askPermission) {
  const action = { ...input };
  const kind = action.kind;

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

  const result = await actions.run(action, { runId: task.id, approved });

  if (result.parked) {
    const choice = await askPermission({ rule: result.rule, detail: result.detail, action });
    if (choice === "stop") return { error: true, text: "The person stopped it here.", stop: true };
    if (choice === "skip") return { text: "Skipped — the person said no to that one." };

    const retry = await actions.run(action, { runId: task.id, approved: true });
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

const short = (p) => (p ? String(p).split(/[\\/]/).pop() : "somewhere");

module.exports = { runLoop };
