const { ipcMain, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const db = require("./db");
const vault = require("./vault");
const observer = require("./observer");
const actions = require("./actions");
const win32 = require("./win32");
const claude = require("./claude");
const brain = require("./brain");
const vision = require("./vision");
const agent = require("./agent");
const nudge = require("./nudge");
const routines = require("./routines");
const account = require("./account");
const addons = require("./addons");
const biometric = require("./biometric");
const recorder = require("./recorder");
const screen = require("./screen");
const ingest = require("./ingest");
const tokens = require("./tokens");

/**
 * Everything the interface can ask for. The renderer holds no truth of its
 * own — it renders what the main process reports and sends intentions back.
 */

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

const pushState = () => broadcast("doppel:state", db.publicState());
const pushAgent = (task) => broadcast("doppel:agent", task);
const pushNarration = (line) => broadcast("doppel:narration", line);
const pushNudge = (nudges) => broadcast("doppel:nudge", nudges);

/* ------------------------------------------------------------ consolidation */

/**
 * Fold recent observations into digests on a slow cadence.
 *
 * Without this the brain grows linearly and recall gets steadily more
 * expensive. With it, a month of watching costs a handful of paragraphs to
 * remember and the raw episodes are only consulted when something matches.
 */
function startConsolidation() {
  setInterval(async () => {
    if (!claude.configured()) return;
    if (db.get().observation.paused) return;
    try {
      await brain.consolidate({ scope: "hour" });
      pushState();
    } catch (err) {
      console.error("[doppel] could not consolidate:", err.message);
    }
  }, 20 * 60_000);

  setInterval(async () => {
    if (!claude.configured()) return;
    try {
      await brain.consolidate({ scope: "day" });
    } catch {
      /* tomorrow will do */
    }
  }, 6 * 60 * 60_000);

  /* Generate morning brief proactively — if it's before noon and there
     isn't one yet for today, write it in the background. */
  setTimeout(async () => {
    if (!claude.configured()) return;
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      const existing = brain.getMorningBrief();
      if (!existing) {
        try {
          await brain.generateMorningBrief();
          console.log("[doppel] morning brief generated");
        } catch {
          /* not critical */
        }
      }
    }
  }, 30_000); // 30s after startup, to let everything else settle
}

/* --------------------------------------------------------------------- wire */

function register() {
  agent.setPublisher((taskList) => pushAgent(taskList));
  agent.setOnComplete(() => pushState());

  brain.init();
  addons.init();
  nudge.init(pushNudge);
  biometric.init();
  routines.startScheduler();

  /* -------------------------------------------------------------------
     Startup catch-up: find files that changed while Doppel was closed and
     remember them. This is how Doppel learns about work that happened
     offline — no screenshots, just the filesystem delta.
     ------------------------------------------------------------------- */
  const lastRunAt = db.get().stats?.lastRunAt ?? 0;
  if (lastRunAt > 0) {
    const missed = observer.catchUp(lastRunAt);
    if (missed.length > 0) {
      /* Group by directory to avoid flooding the brain with one episode per
         file. "12 files changed in Documents/reports" is more useful than
         twelve separate episodes. */
      const byDir = new Map();
      for (const f of missed) {
        const key = f.dir;
        if (!byDir.has(key)) byDir.set(key, []);
        byDir.get(key).push(f);
      }
      for (const [dirPath, files] of byDir) {
        const created = files.filter((f) => f.kind === "file.created");
        const changed = files.filter((f) => f.kind === "file.changed");
        const parts = [];
        if (created.length > 0) {
          parts.push(
            created.length <= 3
              ? `New: ${created.map((f) => f.name).join(", ")}`
              : `${created.length} new files`,
          );
        }
        if (changed.length > 0) {
          parts.push(
            changed.length <= 3
              ? `Changed: ${changed.map((f) => f.name).join(", ")}`
              : `${changed.length} files changed`,
          );
        }
        const folderName = path.basename(dirPath);
        brain.remember({
          kind: "catchup",
          at: Math.max(...files.map((f) => f.mtime)),
          activity: `While I was away, ${parts.join("; ")} in ${folderName}.`,
          detail: files
            .slice(0, 10)
            .map((f) => f.name)
            .join(", "),
          location: dirPath,
          salience: 0.35,
        });
      }
      console.log(`[doppel] catch-up: ${missed.length} file changes since last run`);
    }
  }
  db.update((s) => { s.stats.lastRunAt = Date.now(); }, { silent: true });

  /* -------------------------------------------------------------------
     Live observation → brain bridge.

     When vision (screen watching) is active, it creates high-quality
     episodes. When it's not, the observer creates lightweight episodes
     so Doppel still learns from window switches and file activity.
     ------------------------------------------------------------------- */
  let lastObservedApp = null;

  observer.start((event) => {
    /* Window changes are the cue to take a fresh look — a new window is the
       moment most likely to be a new piece of work. */
    if (event.kind === "window.focus") vision.noteWindow(event);

    /* Create brain episodes from events when vision isn't watching.
       Vision creates richer episodes, so we stay out of its way. */
    const visionWatching =
      db.get().permissions.screen &&
      !db.get().observation.paused &&
      claude.configured();

    if (!visionWatching) {
      if (event.kind === "window.focus" && event.app !== lastObservedApp) {
        lastObservedApp = event.app;
        brain.remember({
          kind: "window",
          at: event.at,
          app: event.app,
          window: event.title,
          activity: `Switched to ${event.app}: ${event.title}`,
          salience: 0.2,
        });
      }
      if (event.kind === "file.created") {
        brain.remember({
          kind: "file",
          at: event.at,
          activity: `New file: ${event.name} in ${path.basename(event.dir)}`,
          detail: event.path,
          location: event.dir,
          salience: 0.3,
        });
      }
      if (event.kind === "file.moved") {
        brain.remember({
          kind: "file",
          at: event.at,
          activity: `Moved ${event.name} from ${path.basename(event.fromDir)} to ${path.basename(event.dir)}`,
          detail: event.path,
          location: event.dir,
          salience: 0.3,
        });
      }
    }

    pushState();
  });

  vision.start((line) => {
    pushNarration(line);
    pushState();
  });

  startConsolidation();
  account.startHeartbeat();

  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        const result = await fn(...args);
        pushState();
        return result ?? { ok: true };
      } catch (err) {
        console.error(`[doppel] ${channel}:`, err);
        return { ok: false, detail: err.message };
      }
    });

  /* --- state ------------------------------------------------------------ */
  ipcMain.handle("state:get", () => db.publicState());

  /* --- observation ------------------------------------------------------ */
  handle("obs:pause", (paused) => {
    db.update((s) => {
      s.observation.paused = Boolean(paused);
    });
    if (paused) observer.stop();
    else observer.restart();
  });

  handle("obs:permissions", (patch) => {
    db.update((s) => {
      s.permissions = { ...s.permissions, ...patch };
    });
    observer.restart();
  });

  handle("obs:addRoot", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const picked = await dialog.showOpenDialog(win, {
      title: "Which folder may Doppel watch?",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false };
    db.update((s) => {
      if (!s.observation.roots.includes(picked.filePaths[0])) {
        s.observation.roots.push(picked.filePaths[0]);
      }
    });
    observer.restart();
    return { ok: true, root: picked.filePaths[0] };
  });

  handle("obs:removeRoot", (root) => {
    db.update((s) => {
      s.observation.roots = s.observation.roots.filter((r) => r !== root);
    });
    observer.restart();
  });

  ipcMain.handle("obs:displays", () => screen.listDisplays());

  handle("obs:setDisplay", (displayId) => {
    db.update((s) => {
      s.observation.displayId = displayId || null;
    });
  });

  /* --- memory ----------------------------------------------------------- */
  handle("memory:forget", (id) =>
    db.update((s) => {
      s.entities = s.entities.filter((e) => e.id !== id);
    }),
  );

  /* --- the mind --------------------------------------------------------- */

  handle("ai:setKey", async (key) => {
    const trimmed = String(key ?? "").trim();
    if (!trimmed) return { ok: false, detail: "That's empty." };

    const check = await claude.verifyKey(trimmed);
    db.update((s) => {
      /* Encrypt the key before storing — it's decrypted on read via db.apiKey(). */
      s.ai.apiKey = check.ok ? vault.encryptSecret(trimmed) : s.ai.apiKey;
      s.ai.verified = check.ok;
      s.ai.lastError = check.ok ? null : check.detail;
    });
    return check;
  });

  handle("ai:clearKey", () =>
    db.update((s) => {
      s.ai.apiKey = "";
      s.ai.verified = false;
      s.ai.lastError = null;
    }),
  );

  handle("ai:setOpenAIKey", (key) => {
    const trimmed = String(key ?? "").trim();
    if (!trimmed) return { ok: false, detail: "That's empty." };
    db.update((s) => {
      s.ai.openaiKey = vault.encryptSecret(trimmed);
    });
    return { ok: true };
  });

  handle("ai:clearOpenAIKey", () =>
    db.update((s) => {
      s.ai.openaiKey = "";
    }),
  );

  /* --- whisper transcription ------------------------------------------- */

  ipcMain.handle("whisper:transcribe", async (_e, audioBuffer, prompt) => {
    const openaiKey = db.openaiKey() || process.env.OPENAI_API_KEY;
    if (!openaiKey) return { ok: false, detail: "No OpenAI key configured." };

    try {
      /* Electron IPC can pass ArrayBuffers as various types. Normalise. */
      const buf = Buffer.isBuffer(audioBuffer)
        ? audioBuffer
        : Buffer.from(audioBuffer instanceof ArrayBuffer ? new Uint8Array(audioBuffer) : audioBuffer);

      if (buf.length < 100) return { ok: false, detail: "Recording too short." };

      const boundary = `----DoppelWhisper${Date.now()}`;
      const preamble = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      );
      /* Optional prompt field — helps Whisper recognise domain-specific words. */
      const promptPart = prompt
        ? `\r\n--${boundary}\r\n` +
          `Content-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`
        : "\r\n";
      const modelPart = Buffer.from(
        `${promptPart}--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
        `--${boundary}--\r\n`,
      );
      const body = Buffer.concat([preamble, buf, modelPart]);

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, detail: `OpenAI ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = await res.json();
      return { ok: true, text: data.text ?? "" };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  });

  /**
   * Combined transcribe + answer in one IPC call. Saves a renderer round-trip
   * (~50ms) and lets us start brain recall while transcription is in flight.
   */
  ipcMain.handle("whisper:ask", async (_e, audioBuffer, history) => {
    const openaiKey = db.openaiKey() || process.env.OPENAI_API_KEY;
    if (!openaiKey) return { ok: false, detail: "No OpenAI key configured." };

    try {
      /* Start recall pre-warming while we wait for transcription. We don't
         know the question yet, but preloading the recent episodes into the
         OS page cache helps. */
      brain.recentEpisodes(8);

      const buf = Buffer.isBuffer(audioBuffer)
        ? audioBuffer
        : Buffer.from(audioBuffer instanceof ArrayBuffer ? new Uint8Array(audioBuffer) : audioBuffer);

      if (buf.length < 100) return { ok: false, detail: "Recording too short." };

      const boundary = `----DoppelWhisper${Date.now()}`;
      const preamble = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      );
      const modelPart = Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
        `--${boundary}--\r\n`,
      );
      const body = Buffer.concat([preamble, buf, modelPart]);

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, phase: "transcribe", detail: `OpenAI ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = await res.json();
      const transcript = (data.text ?? "").trim();
      if (!transcript) return { ok: false, phase: "transcribe", detail: "No speech detected." };

      /* Only clearly imperative sentences become agent tasks. Everything
         else — questions, greetings, conversation — gets answered by the
         brain. Patterns are searched anywhere in the text, not just at the
         start, so "Hi, could you open..." works the same as "open...". */
      /* Follow-up confirmations that reference a prior instruction. These need
         the previous conversation turn extracted and sent to the agent. */
      const isFollowUp = (history ?? []).length > 0 &&
        /\b(yeah|yes|yep|yup|ok|okay|sure|go ahead|do it|do that|do what i|just do)\b/i.test(transcript);

      /* "Can you X?" is a polite instruction, not a question. Only treat ?
         as non-instruction for genuine info questions. */
      const endsQ = transcript.trim().endsWith("?");
      const politeRequest = /\b(can you|could you|would you|will you)\b/i.test(transcript);
      const genuineQuestion = endsQ && !politeRequest &&
        /^(what|where|when|why|how|who|which|is|are|does|do|did|was|were|has|have)\b/i.test(transcript.trim());

      /* Instructions go to the agent — including screen-related ones, since
         the agent now has look_at_screen. Only pure screen questions ("what's
         on my screen?") without an actionable verb fall through to the brain. */
      const isInstruction = !genuineQuestion && (
        isFollowUp ||
        /\b(can you|could you|would you|will you|i need you to|i want you to)\b/i.test(transcript) ||
        /\bplease\s+(open|create|make|build|run|start|stop|move|copy|delete|install|download|send|write|edit|fix|update|close|launch|save|upload|convert|merge|add|remove|change|rename|find|get|search|show|look|take|put|turn|switch|toggle|enable|disable|clean|clear|organize|sort|schedule|order|post|share|deploy|test|format|print|zip|translate|summarize|draft|generate|fetch|pull|push)\b/i.test(transcript) ||
        /\b(find|get|search|show|look)\s+(me|for|up)\b/i.test(transcript));

      const screenQ = !isInstruction && isScreenQuestion(transcript) && db.get().permissions.screen && claude.configured();

      if (isInstruction) {
        /* Instruction — return the transcript so the renderer sends it to the agent. */
        return { ok: true, transcript, isInstruction: true };
      }

      /* Everything else — answer from memory (or screen if they asked). */
      let result;
      if (screenQ) {
        result = await lookAndAnswer(transcript, { fast: true, history: history ?? [] });
      } else {
        result = await brain.answer(transcript, { fast: true, history: history ?? [] });
        if (result.ok && result.text) brain.rememberConversation(transcript, result.text);
      }
      return {
        ok: result.ok,
        transcript,
        text: result.text ?? "",
        empty: result.empty,
        detail: result.detail,
        isInstruction: false,
      };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  });

  handle("ai:setAutoWatch", (on) =>
    db.update((s) => {
      s.ai.autoWatch = Boolean(on);
    }),
  );

  handle("ai:setDetail", (level) =>
    db.update((s) => {
      s.ai.detail = level === "light" ? "light" : "thorough";
    }),
  );

  handle("vision:look", async () => {
    const gate = tokens.canAfford("vision:look");
    if (!gate.allowed) return { ok: false, reason: "token_limit", ...gate };
    const result = await vision.look({ reason: "you asked", force: true });
    tokens.spend("vision:look");
    return result;
  });

  /* --- screen-aware answers --------------------------------------------- */

  /**
   * Detect questions about the current screen. When the user says "what's on
   * my screen", "what am I looking at", etc., take a fresh look FIRST and
   * fold the observation into the answer context.
   */
  const SCREEN_PATTERNS = [
    /\bwhat.*(on|at).*(my|the)?\s*screen\b/i,
    /\bwhat.*(am i|i'm).*(look|see|do|work)/i,
    /\bwhat.*(is|are)\s+this\b/i,
    /\bwhat.*(see|seeing|show)\b.*right now/i,
    /\blook at.*(my|the)?\s*screen\b/i,
    /\bread.*(my|the)?\s*screen\b/i,
    /\btell me what.*(see|screen|open)\b/i,
    /\bscreen\s*right\s*now\b/i,
    /\bcurrently\s+(on|open|showing|visible)\b/i,
    /\b(describe|explain)\s+.*(screen|window|page)\b/i,
  ];

  function isScreenQuestion(text) {
    return SCREEN_PATTERNS.some((re) => re.test(text));
  }

  /**
   * Look at the screen, then answer with the fresh observation as extra
   * context. Falls back to normal brain.answer if looking fails.
   */
  function recentScreenContext() {
    /* Use the most recent non-sensitive observation as context. If Doppel
       looked in the last 60 seconds, that's fresh enough. */
    const recent = brain.recentEpisodes(5).filter((e) => !e.sensitive && e.activity && e.kind === "screen");
    if (recent.length === 0) return null;
    const best = recent[0];
    if (Date.now() - best.at > 60_000) return null;
    const parts = [
      best.activity,
      best.detail,
      best.location ? "Location: " + best.location : "",
      ...(best.fragments || []).map((f) => f.what + ": " + f.value),
    ].filter(Boolean);
    return parts.join("\n");
  }

  async function lookAndAnswer(question, opts) {
    /* One API call: capture the screen, send the image + question together.
       No separate vision analysis step — the model reads the screen and
       answers in one shot. */
    const shot = await screen.capture({ maxEdge: 1366 });
    if (!shot.ok) {
      /* Fall back to recent text-based observations. */
      const ctx = recentScreenContext();
      if (ctx) {
        const result = await brain.answer(question, { ...opts, screenContext: ctx });
        if (result.ok && result.text) brain.rememberConversation(question, result.text, ctx);
        return result;
      }
      return { ok: true, text: shot.detail || "The screen capture didn't come back." };
    }

    const pack = await brain.recallSemantic(question, { limit: 6, budgetTokens: 1200 });
    const found = pack.entities.length + pack.episodes.length + pack.digests.length;
    const memoryBlock = found > 0
      ? `\n\nRelevant memories:\n${brain.packToText(pack)}`
      : "";

    const messages = [
      ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      {
        role: "user",
        content: [
          screen.asImageBlock(shot),
          {
            type: "text",
            text: `They said: "${question}"\n\nThat's their screen right now.${memoryBlock}`,
          },
        ],
      },
    ];

    const result = await claude.ask({
      system: `You are Doppel — a personal agent on this person's computer. You can see their screen. Answer their question about what's on screen directly and conversationally. Be specific — quote text, name apps, describe what you see. First person, short sentences, no emoji.`,
      effort: "low",
      thinking: false,
      maxTokens: 500,
      messages,
    });

    if (!result.ok) return result;

    /* Remember what was on screen so future questions can find it. */
    const screenSummary = result.text?.slice(0, 600) ?? "";
    brain.rememberConversation(question, result.text, `Screen at ${shot.displayName ?? "primary"}: ${screenSummary}`);

    return { ok: true, text: result.text, pack };
  }

  /* --- the brain -------------------------------------------------------- */

  ipcMain.handle("brain:recall", async (_e, query) => {
    const pack = await brain.recallSemantic(String(query ?? ""), {
      limit: 15,
      budgetTokens: 4000,
    });
    return { pack, text: brain.packToText(pack) };
  });

  /* Memories are kept as vectors and terse records; this is where they become
     English again, and only because someone asked. */
  ipcMain.handle("brain:ask", async (_e, question, history) => {
    const gate = tokens.canAfford("brain:ask");
    if (!gate.allowed) return { ok: false, reason: "token_limit", ...gate };
    try {
      const q = String(question ?? "");
      if (isScreenQuestion(q) && db.get().permissions.screen && claude.configured()) {
        const r = await lookAndAnswer(q, { history: history ?? [] });
        tokens.spend("brain:ask");
        return r;
      }
      const result = await brain.answer(q, { history: history ?? [] });
      if (result.ok && result.text) brain.rememberConversation(q, result.text);
      tokens.spend("brain:ask");
      return result;
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  /* Fast path — smaller context, low effort, no thinking. For the whisper panel
     where speed matters more than thoroughness. */
  ipcMain.handle("brain:ask-fast", async (_e, question, history) => {
    const gate = tokens.canAfford("brain:ask-fast");
    if (!gate.allowed) return { ok: false, reason: "token_limit", ...gate };
    try {
      const q = String(question ?? "");
      if (isScreenQuestion(q) && db.get().permissions.screen && claude.configured()) {
        const r = await lookAndAnswer(q, { fast: true, history: history ?? [] });
        tokens.spend("brain:ask-fast");
        return r;
      }
      const result = await brain.answer(q, {
        fast: true,
        history: history ?? [],
        onText: (delta) => broadcast("doppel:answer-stream", delta),
      });
      if (result.ok && result.text) brain.rememberConversation(q, result.text);
      tokens.spend("brain:ask-fast");
      return result;
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  handle("brain:forgetMoments", (ids) => brain.forgetEpisodes(ids ?? []));

  ipcMain.handle("brain:entities", () => brain.knownEntities());
  ipcMain.handle("brain:episodes", (_e, limit) => brain.recentEpisodes(limit ?? 60));
  ipcMain.handle("brain:availableDates", () => brain.availableDates());
  ipcMain.handle("brain:episodesForDate", (_e, date) => brain.episodesForDate(date));
  ipcMain.handle("brain:stats", () => brain.stats());

  handle("brain:forget", (id) => brain.forgetEntity(id));

  handle("brain:consolidate", async (scope) => {
    const result = await brain.consolidate({ scope: scope === "day" ? "day" : "hour" });
    return result;
  });

  ipcMain.handle("brain:patterns", () => brain.detectPatterns());

  ipcMain.handle("brain:morningBrief", async () => {
    try {
      return await brain.generateMorningBrief();
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  ipcMain.handle("brain:morningBriefCached", () => {
    const brief = brain.getMorningBrief();
    return brief ? { ok: true, brief } : { ok: false };
  });

  ipcMain.handle("brain:export", async () => {
    try {
      const data = brain.exportBrain();
      const result = await dialog.showSaveDialog({
        title: "Export Doppel's brain",
        defaultPath: `doppel-brain-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, reason: "canceled" };
      const fs = require("node:fs");
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf8");
      return { ok: true, file: result.filePath, stats: data.stats };
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  handle("brain:wipe", () => brain.wipe());

  /* --- document ingestion ----------------------------------------------- */

  ipcMain.handle("brain:ingest", async (_e, filePath) => {
    if (filePath) return ingest.ingest(filePath);
    /* No path provided — open a file picker. */
    const exts = ingest.supportedExtensions();
    const result = await dialog.showOpenDialog({
      title: "Choose files to import",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Documents & Images", extensions: exts.map((e) => e.slice(1)) },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, detail: "No files selected." };
    }
    let totalEpisodes = 0;
    const imported = [];
    for (const fp of result.filePaths) {
      const r = await ingest.ingest(fp);
      if (r.ok) {
        totalEpisodes += r.episodes;
        imported.push(r.title);
      }
    }
    if (imported.length === 0) {
      return { ok: false, detail: "No files could be imported." };
    }
    return { ok: true, episodes: totalEpisodes, files: imported };
  });

  handle("brain:ingestSupported", () => ingest.supportedExtensions());

  /* --- routines --------------------------------------------------------- */

  ipcMain.handle("routines:list", () => routines.list());
  ipcMain.handle("routines:proposals", () => routines.proposals());
  handle("routines:accept", (patternId) => routines.accept(patternId));
  handle("routines:reject", (patternId) => routines.reject(patternId));
  handle("routines:remove", (routineId) => routines.remove(routineId));
  handle("routines:toggle", (routineId) => routines.toggle(routineId));
  handle("routines:runNow", (routineId) => routines.runNow(routineId));

  /* --- add-ons ---------------------------------------------------------- */

  ipcMain.handle("addons:list", () => addons.list());
  handle("addons:install", (id) => addons.install(id));
  handle("addons:uninstall", (id) => addons.uninstall(id));
  handle("addons:enable", (id) => addons.enable(id));
  handle("addons:disable", (id) => addons.disable(id));
  handle("addons:setConfig", (id, key, value) => addons.setConfig(id, key, value));
  ipcMain.handle("addons:auth", async (_e, id) => addons.startAuth(id));
  handle("addons:disconnect", (id) => addons.disconnectAuth(id));

  /* --- nudges ----------------------------------------------------------- */

  ipcMain.handle("nudge:active", () => nudge.snapshot());
  handle("nudge:dismiss", (id) => nudge.dismiss(id));

  handle("nudge:setEnabled", (on) => {
    db.update((s) => { s.nudges.enabled = !!on; });
  });

  handle("nudge:act", (id) => {
    const result = nudge.act(id);
    if (!result.ok) return result;
    const n = result.nudge;
    if (n.kind === "offer" && n.detail) {
      agent.run({ instruction: n.detail, title: n.text }).catch(() => {});
    }
    return result;
  });

  /* --- biometric / security --------------------------------------------- */

  ipcMain.handle("security:available", () => biometric.checkAvailable());
  ipcMain.handle("security:status", () => biometric.status());

  ipcMain.handle("security:verify", async () => {
    const result = await biometric.verify();
    if (result.ok) broadcast("doppel:unlocked", true);
    return result;
  });

  handle("security:setBiometric", async (on) => {
    const result = await biometric.setEnabled(on);
    if (result.ok) broadcast("doppel:unlocked", !on);
    return result;
  });

  handle("security:setLockTimeout", (minutes) => {
    biometric.setLockTimeout(minutes);
  });

  handle("security:lock", () => {
    biometric.lock();
    broadcast("doppel:unlocked", false);
  });

  /* --- workflow recording ----------------------------------------------- */

  handle("recorder:start", (title) => recorder.start(title));

  ipcMain.handle("recorder:stop", async () => {
    try {
      return await recorder.stop();
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  ipcMain.handle("recorder:active", () => recorder.active());

  handle("recorder:abort", () => recorder.abort());

  handle("recorder:save", (procedure) => recorder.saveAsRoutine(procedure));

  /* --- the agent -------------------------------------------------------- */

  ipcMain.handle("agent:get", () => agent.snapshot());

  ipcMain.handle("agent:history", (_e, limit) => {
    const runs = db.get().runs ?? [];
    return runs.slice(0, limit ?? 20).map((r) => ({
      id: r.id,
      title: r.routineTitle ?? r.instruction?.slice(0, 80) ?? "Untitled",
      at: r.at,
      durationSec: r.durationSec ?? 0,
      outcome: r.outcome ?? "stopped",
      note: r.note ?? "",
      steps: r.steps?.length ?? 0,
      changes: r.changes ?? [],
    }));
  });

  handle("agent:run", async ({ instruction, routineId, title, mode }) => {
    const gate = tokens.canAfford("agent:run");
    if (!gate.allowed) return { ok: false, reason: "token_limit", ...gate };
    const result = await agent.run({ instruction, routineId, title, mode });
    tokens.spend("agent:run");
    return result;
  });

  handle("agent:answer", (id, choice) => agent.answerApproval(id, choice));
  handle("agent:abort", (id) => agent.abort(id));

  /* --- the account ------------------------------------------------------ */

  handle("account:requestLink", (email) => account.requestLink(email));
  handle("account:verifyLink", (token) => account.verifyLink(token));
  handle("account:password", ({ email, password }) => account.signInWithPassword(email, password));
  handle("account:setPassword", (password) => account.setPassword(password));
  ipcMain.handle("account:overview", () => account.overview());
  handle("account:revokeDevice", (id) => account.revokeDevice(id));
  handle("account:signOutEverywhere", (keep) => account.signOutEverywhere(keep));
  handle("account:signOut", () => account.signOut());
  handle("account:setServer", (url) => account.setServer(url));
  handle("account:renameDevice", (name) => account.renameDevice(name));

  /* Export before deletion is offered, never buried. */
  handle("account:export", async () => {
    const data = await account.exportAccount();
    if (!data.ok) return data;

    const win = BrowserWindow.getFocusedWindow();
    const picked = await dialog.showSaveDialog(win, {
      title: "Save your account record",
      defaultPath: `doppel-account-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, error: "cancelled" };

    const { ok: _ok, ...body } = data;
    fs.writeFileSync(picked.filePath, JSON.stringify(body, null, 2), "utf8");
    return { ok: true, file: picked.filePath };
  });

  handle("account:delete", () => account.deleteAccount());

  /* --- billing ---------------------------------------------------------- */

  ipcMain.handle("billing:status", () => tokens.status());
  ipcMain.handle("billing:plans", () => tokens.getPlans());
  ipcMain.handle("billing:costs", () => tokens.getCosts());
  ipcMain.handle("billing:history", (_e, limit) => tokens.getHistory(limit));
  ipcMain.handle("billing:tokenPacks", () => tokens.getTokenPacks());
  handle("billing:setPlan", (plan) => tokens.setPlan(plan));
  handle("billing:addTokens", (amount) => tokens.addTokens(amount));

  /* --- misc ------------------------------------------------------------- */
  ipcMain.handle("windows:list", () => win32.listWindows());

  handle("app:reset", () => {
    agent.abort();
    db.reset();
    brain.wipe();
    observer.restart();
  });

  ipcMain.handle("app:paths", () => ({
    state: db.paths.stateFile,
    trash: db.paths.trash,
  }));

  handle("app:revealPath", (target) => {
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
  });

  /* --- resume ------------------------------------------------------------ */

  ipcMain.handle("app:resumeLast", async () => {
    const state = db.get();
    const narration = state.narration ?? [];
    /* Find the last non-sensitive narration with an app name. */
    const last = narration.find((n) => n.app && !n.sensitive);
    if (!last?.app) return { ok: false, reason: "nothing" };

    try {
      /* Try to bring that app to the foreground via PowerShell. */
      const { execSync } = require("child_process");
      execSync(
        `powershell -NoProfile -Command "Start-Process '${last.app.replace(/'/g, "''")}'"`
      );
      return { ok: true, app: last.app, title: last.text };
    } catch {
      return { ok: false, reason: "launch-failed", app: last.app };
    }
  });

  /* --- MCP integration --------------------------------------------------- */

  ipcMain.handle("mcp:connectClaude", () => {
    const platform = process.platform;
    let configDir;
    if (platform === "win32") {
      configDir = path.join(process.env.APPDATA || "", "Claude");
    } else if (platform === "darwin") {
      configDir = path.join(require("os").homedir(), "Library", "Application Support", "Claude");
    } else {
      configDir = path.join(require("os").homedir(), ".config", "Claude");
    }

    const configFile = path.join(configDir, "claude_desktop_config.json");
    const mcpScript = path.join(__dirname, "..", "mcp-server.js");

    /* Read existing config or start fresh. */
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    } catch {
      /* file doesn't exist yet — that's fine */
    }

    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.doppel = {
      command: "node",
      args: [mcpScript.replace(/\\/g, "/")],
    };

    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2), "utf8");
      return { ok: true, path: configFile };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  });

  ipcMain.handle("mcp:checkClaude", () => {
    const platform = process.platform;
    let configDir;
    if (platform === "win32") {
      configDir = path.join(process.env.APPDATA || "", "Claude");
    } else if (platform === "darwin") {
      configDir = path.join(require("os").homedir(), "Library", "Application Support", "Claude");
    } else {
      configDir = path.join(require("os").homedir(), ".config", "Claude");
    }

    const configFile = path.join(configDir, "claude_desktop_config.json");
    try {
      const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
      return { connected: !!config?.mcpServers?.doppel };
    } catch {
      return { connected: false };
    }
  });

  db.subscribe(() => {});
  pushState();
}

module.exports = { register, pushState, broadcast };
