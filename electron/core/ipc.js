const { ipcMain, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const db = require("./db");
const vault = require("./vault");
const observer = require("./observer");
const win32 = require("./win32");
const claude = require("./claude");
const brain = require("./brain");
const vectors = require("./vectors");
const vision = require("./vision");
const nudge = require("./nudge");
const account = require("./account");
const addons = require("./addons");
const biometric = require("./biometric");
const screen = require("./screen");
const browser = require("./browser");
const ingest = require("./ingest");
const tokens = require("./tokens");
const guide = require("./guide");
const profile = require("./profile");

/**
 * Everything the interface can ask for. The renderer holds no truth of its
 * own — it renders what the main process reports and sends intentions back.
 */

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

let _pushTimer = null;
const pushState = () => {
  if (_pushTimer) return;
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    broadcast("doppel:state", db.publicState());
  }, 50);
};
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

    /* Refine user profile when enough new observations accumulate. */
    try {
      const s = brain.stats();
      if (profile.shouldRefine(s.episodes)) {
        await profile.generateProfile();
        console.log("[doppel] user profile updated");
      }
    } catch (err) {
      console.error("[doppel] profile refinement failed:", err.message);
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

function register(opts = {}) {
  brain.init();
  profile.init();
  /* Preload the embedding model during boot so the first question doesn't
     eat a 20-second cold start.  Fire-and-forget — if it fails the brain
     already falls back to lexical search. */
  vectors.ready().catch(() => {});
  addons.init();
  nudge.init(pushNudge);
  guide.init(broadcast, {
    onShow: opts.showGuideWindow ?? null,
    onHide: opts.hideGuideWindow ?? null,
  });
  biometric.init();

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

      /* ---- Walkthrough detection — absolute first gate.
         If the user wants a walkthrough / tutorial / to be pointed at a UI
         element, return immediately so the renderer routes to the guide. */
      if (isWalkthroughRequest(transcript)) {
        return { ok: true, transcript, isWalkthrough: true };
      }

      /* Everything left — answer from memory (or screen if they asked). */
      const screenQ = isScreenQuestion(transcript) && db.get().permissions.screen && claude.configured();
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

  /* ---- Walkthrough detection — mirrors the renderer-side list exactly.
     Every conceivable way to ask for a tutorial, walkthrough, or to be
     pointed at a UI element. */
  const WALKTHROUGH_PATTERNS = [
    /\bwalk\s+(me\s+)?through\b/i,
    /\bwalk\s+through\s+(how|the|this|that|it|my|your|setting|process|steps)\b/i,
    /\bguide\s+(me\s+)?(through|on|to|in|for|with)\b/i,
    /\btake\s+me\s+through\b/i,
    /\bshow\s+me\s+how\s+(to|i|we|you|it|the|this|that)\b/i,
    /\bshow\s+me\s+how\b/i,
    /\bteach\s+me\b/i,
    /\bdemonstrate\s+(how\s+to\s+|the\s+|this|that|it)?\b/i,
    /\b(walkthrough|walk-through|tutorial|guided\s*tour)\s+(of|for|on|about|to)\b/i,
    /\b(give|show|start|begin|do|run|provide|create)\s+(me\s+)?(a\s+)?(walkthrough|walk-through|tutorial|guided\s*tour|demo|demonstration)\b/i,
    /\b(i\s+(want|need|would\s+like)\s+(a\s+)?(walkthrough|walk-through|tutorial|guided\s*tour|demo|demonstration))\b/i,
    /\bstep[\s-]*by[\s-]*step\b/i,
    /\bshow\s+me\s+where\b/i,
    /\bpoint\s+(me\s+)?(to|at|where|toward|towards)\b/i,
    /\bwhere\s+(do|should|can|would|could|shall)\s+i\s+(click|tap|press|find|go|look|navigate|select|start|begin)\b/i,
    /\bwhere\s+(is|are|was)\s+(the\s+)?(\w+\s+){0,5}(button|setting|option|menu|tab|link|icon|toggle|switch|field|input|checkbox|dropdown|slider|control|panel|section|page|area|tool|toolbar|sidebar|dialog|popup|modal|window|pane)\b/i,
    /\bwhich\s+(button|menu|tab|option|setting|icon|link|control)\s+(do|should|to|would|could)\b/i,
    /\b(what|where)\s+(do|should|would|could)\s+i\s+(click|press|tap|select|choose|pick|hit)\b/i,
    /\bhelp\s+me\s+find\s+(the\s+)?(\w+\s+){0,5}(button|setting|option|menu|control|toggle|icon|link|field|tab)\b/i,
    /\bfind\s+(the\s+)?(button|setting|option|menu|control|toggle)\s+(for|to)\b/i,
    /\bhelp\s+me\s+(learn|figure\s+out|understand)\s+how\s+to\b/i,
    /\bhow\s+(do|can|should|would)\s+i\s+(click|navigate|find|get to|access|open|enable|disable|toggle|turn on|turn off|activate|deactivate|set up|configure|change|modify|adjust|switch)\b/i,
    /\bshow\s+me\s+the\s+way\s+to\b/i,
    /\blead\s+me\s+(through|to)\b/i,
    /\b(show|point\s+out)\s+me\s+(the\s+)?(steps|process|procedure|way|path|workflow|flow)\b/i,
    /\bwok\s+me\s+through\b/i,
    /\bguard\s+me\s+through\b/i,
    /\bwalked?\s+me\s+through\b/i,
  ];

  function isWalkthroughRequest(text) {
    return WALKTHROUGH_PATTERNS.some((re) => re.test(text));
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

  /* ========================================================= FALLBACK ENGINE
     A question goes through a chain of increasingly expensive strategies:

       1. LOCAL  — instant, no API call (time, date, math, system info, etc.)
       2. MEMORY — brain.recall  (already indexed, fast)
       3. WEB    — browser.run search  (Puppeteer, ~3s)
       4. FILES  — filesystem glob  (for "where's my file?" questions)
       5. CLAUDE — the LLM itself, with all gathered context

     Each layer adds context for the next.  The goal: never say "I don't know"
     when the answer is available locally or on the web. */

  const os = require("node:os");
  const { clipboard } = require("electron");
  const { execSync } = require("node:child_process");

  /* -------------------------------------------------------- 1. LOCAL ANSWERS */

  /**
   * Try to answer instantly from the local machine — no API call, no tokens.
   * Returns { text, source } or null if this isn't a local-answerable question.
   */
  function tryLocalAnswer(question) {
    const q = question.trim();
    const ql = q.toLowerCase();

    /* — Time ----------------------------------------------------------- */
    if (/\b(what\s*time|current\s*time|time\s+is\s+it|what'?s?\s+the\s+time|tell\s+me\s+the\s+time)\b/i.test(ql)) {
      const now = new Date();
      return { text: `It's ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}.`, source: "clock" };
    }

    /* — Date / day ----------------------------------------------------- */
    if (/\b(what\s*(is\s+)?(the\s+)?date|today'?s?\s+date|what\s+day|which\s+day|current\s+date)\b/i.test(ql)) {
      const now = new Date();
      return { text: `Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`, source: "clock" };
    }

    /* — Simple math / arithmetic --------------------------------------- */
    const mathPat = /(?:what(?:'?s| is)|calculate|compute|solve|evaluate)\s+(.+)/i;
    const mathMatch = ql.match(mathPat);
    if (mathMatch) {
      const result = safeMathEval(mathMatch[1]);
      if (result !== null) return { text: `${result}`, source: "math" };
    }
    /* Bare arithmetic expressions like "15 * 23" or "sqrt(144)" */
    if (/^[\d\s+\-*/().%^]+$/.test(q.replace(/\s/g, "")) && q.length >= 3) {
      const result = safeMathEval(q);
      if (result !== null) return { text: `${result}`, source: "math" };
    }

    /* — Unit conversion ------------------------------------------------ */
    const convMatch = ql.match(/(?:convert\s+)?(\d+\.?\d*)\s*(°?[a-z]+)\s+(?:to|in|into)\s+(°?[a-z]+)/i);
    if (convMatch) {
      const result = tryConvert(parseFloat(convMatch[1]), convMatch[2].toLowerCase(), convMatch[3].toLowerCase());
      if (result !== null) return { text: result, source: "conversion" };
    }

    /* — Clipboard ------------------------------------------------------ */
    if (/\b(what('?s| is) (on |in )?(my |the )?clipboard|paste|clipboard content|what did i copy|copied)\b/i.test(ql)
      && !/\b(copy|clear|set)\b/i.test(ql)) {
      try {
        const text = clipboard.readText();
        if (text && text.trim()) return { text: `Your clipboard contains:\n\n${text.trim().slice(0, 2000)}`, source: "clipboard" };
        return { text: "Your clipboard is empty.", source: "clipboard" };
      } catch { /* fall through */ }
    }

    /* — System info ---------------------------------------------------- */
    if (/\b(system\s*info|computer\s*info|my\s*(computer|pc|laptop|machine)|specs|hardware)\b/i.test(ql)) {
      return { text: getSystemInfo(), source: "system" };
    }
    if (/\b(how much|amount of)\s*(ram|memory)\b/i.test(ql) || /\b(ram|memory)\s*(usage|free|available|total)\b/i.test(ql)) {
      const total = (os.totalmem() / (1024 ** 3)).toFixed(1);
      const free = (os.freemem() / (1024 ** 3)).toFixed(1);
      return { text: `${total} GB total RAM, ${free} GB free.`, source: "system" };
    }
    if (/\b(disk|storage|drive|hard\s*drive|ssd)\s*(space|usage|free|available|left)\b/i.test(ql)
      || /\b(how much|amount of)\s*(disk|storage|space)\b/i.test(ql)) {
      return { text: getDiskInfo(), source: "system" };
    }
    if (/\b(battery|power|charge)\s*(level|status|left|percent|life)?\b/i.test(ql)) {
      return { text: getBatteryInfo(), source: "system" };
    }
    if (/\b(cpu|processor)\s*(usage|load|temp)?\b/i.test(ql) || /\bhow (busy|hot) is\b.*\b(cpu|processor)\b/i.test(ql)) {
      const cpus = os.cpus();
      const model = cpus[0]?.model ?? "unknown";
      return { text: `${model}, ${cpus.length} cores.`, source: "system" };
    }
    if (/\b(os|operating\s*system|windows)\s*(version|build|info)?\b/i.test(ql) && /\b(what|which|version|running)\b/i.test(ql)) {
      return { text: `${os.type()} ${os.release()} (${os.arch()})`, source: "system" };
    }
    if (/\b(ip\s*address|my\s*ip|network\s*address|local\s*ip)\b/i.test(ql)) {
      const nets = os.networkInterfaces();
      const ips = Object.values(nets).flat().filter((n) => n && !n.internal && n.family === "IPv4").map((n) => n.address);
      return { text: ips.length ? `Your local IP: ${ips.join(", ")}` : "No network connection found.", source: "system" };
    }
    if (/\b(username|user\s*name|who\s*am\s*i|my\s*name|computer\s*name|hostname)\b/i.test(ql)) {
      return { text: `User: ${os.userInfo().username}, Computer: ${os.hostname()}`, source: "system" };
    }
    if (/\b(uptime|how long.*(running|been on|up))\b/i.test(ql)) {
      const secs = os.uptime();
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      return { text: `System has been running for ${h} hours and ${m} minutes.`, source: "system" };
    }
    if (/\b(screen\s*resolution|display\s*resolution|monitor\s*size|resolution)\b/i.test(ql)) {
      try {
        const displays = require("electron").screen.getAllDisplays();
        const info = displays.map((d, i) => `Display ${i + 1}: ${d.size.width}×${d.size.height} (${d.scaleFactor}x scale)`).join(", ");
        return { text: info, source: "system" };
      } catch { /* fall through */ }
    }

    /* — Open windows / running apps ------------------------------------ */
    if (/\b(what.*(open|running)|open\s*(windows|apps|programs|applications)|running\s*(apps|programs|processes)|list.*(windows|apps))\b/i.test(ql)) {
      return { text: null, source: "windows" }; /* signal: needs async */
    }

    /* — Screen resolution ---------------------------------------------- */
    if (/\b(screen\s*size|display\s*size)\b/i.test(ql)) {
      try {
        const d = require("electron").screen.getPrimaryDisplay();
        return { text: `${d.size.width}×${d.size.height} at ${d.scaleFactor}x scale.`, source: "system" };
      } catch { /* fall through */ }
    }

    return null;
  }

  /**
   * Async local answers — for things that need a subprocess (windows list, etc.)
   */
  async function tryLocalAnswerAsync(question, localResult) {
    if (!localResult) return null;
    if (localResult.source === "windows" && localResult.text === null) {
      try {
        const wins = await win32.listWindows();
        if (!wins || wins.length === 0) return { text: "I can't see any open windows right now.", source: "windows" };
        const list = wins
          .filter((w) => w.title && w.title.length > 1)
          .slice(0, 20)
          .map((w) => `• ${w.title}`)
          .join("\n");
        return { text: `Open windows:\n\n${list}`, source: "windows" };
      } catch { return null; }
    }
    return localResult;
  }

  /* ---------------------------------------------------------- math helpers */

  function safeMathEval(expr) {
    /* Normalise common spoken math */
    let e = expr
      .replace(/\bsqrt\s*\(?\s*(\d+)\s*\)?/gi, "Math.sqrt($1)")
      .replace(/\babs\s*\(?\s*(-?\d+)\s*\)?/gi, "Math.abs($1)")
      .replace(/\bpi\b/gi, "Math.PI")
      .replace(/\^/g, "**")
      .replace(/\bx\b/gi, "*")
      .replace(/\btimes\b/gi, "*")
      .replace(/\bplus\b/gi, "+")
      .replace(/\bminus\b/gi, "-")
      .replace(/\bdivided\s*by\b/gi, "/")
      .replace(/\bmod\b/gi, "%")
      .replace(/[^0-9+\-*/().%\s,Matheiqrtbsopclg]/g, "");
    if (!e.trim() || e.trim().length < 1) return null;
    try {
      const result = Function(`"use strict"; return (${e})`)();
      if (typeof result === "number" && isFinite(result)) return Math.round(result * 1e10) / 1e10;
    } catch { /* not evaluable */ }
    return null;
  }

  /* ---------------------------------------------------------- unit conversion */

  function tryConvert(value, from, to) {
    const conversions = {
      /* Length */
      "km_mi": 0.621371, "mi_km": 1.60934, "m_ft": 3.28084, "ft_m": 0.3048,
      "cm_in": 0.393701, "in_cm": 2.54, "m_yd": 1.09361, "yd_m": 0.9144,
      "mm_in": 0.0393701, "in_mm": 25.4, "km_m": 1000, "m_km": 0.001,
      /* Weight */
      "kg_lb": 2.20462, "lb_kg": 0.453592, "kg_lbs": 2.20462, "lbs_kg": 0.453592,
      "g_oz": 0.035274, "oz_g": 28.3495, "kg_g": 1000, "g_kg": 0.001,
      "lb_oz": 16, "oz_lb": 0.0625,
      /* Temperature */
      "c_f": null, "f_c": null, "°c_°f": null, "°f_°c": null,
      /* Volume */
      "l_gal": 0.264172, "gal_l": 3.78541, "ml_oz": 0.033814, "oz_ml": 29.5735,
      "l_ml": 1000, "ml_l": 0.001, "cup_ml": 236.588, "ml_cup": 0.00423,
      /* Speed */
      "mph_kmh": 1.60934, "kmh_mph": 0.621371, "ms_kmh": 3.6, "kmh_ms": 0.277778,
      /* Digital */
      "gb_mb": 1024, "mb_gb": 1/1024, "tb_gb": 1024, "gb_tb": 1/1024,
      "mb_kb": 1024, "kb_mb": 1/1024,
      /* Time */
      "hr_min": 60, "min_hr": 1/60, "hr_sec": 3600, "sec_hr": 1/3600,
      "day_hr": 24, "hr_day": 1/24, "week_day": 7, "day_week": 1/7,
      "min_sec": 60, "sec_min": 1/60,
    };
    /* Normalise aliases */
    const aliases = {
      hours: "hr", hour: "hr", hrs: "hr", h: "hr",
      minutes: "min", minute: "min", mins: "min",
      seconds: "sec", second: "sec", secs: "sec", s: "sec",
      days: "day", weeks: "week",
      miles: "mi", mile: "mi",
      kilometers: "km", kilometer: "km", kilometres: "km",
      meters: "m", meter: "m", metres: "m",
      centimeters: "cm", centimeter: "cm",
      millimeters: "mm", millimeter: "mm",
      inches: "in", inch: "in",
      feet: "ft", foot: "ft",
      yards: "yd", yard: "yd",
      kilograms: "kg", kilogram: "kg", kgs: "kg",
      pounds: "lb", pound: "lb",
      grams: "g", gram: "g",
      ounces: "oz", ounce: "oz",
      liters: "l", liter: "l", litres: "l", litre: "l",
      gallons: "gal", gallon: "gal",
      milliliters: "ml", milliliter: "ml",
      cups: "cup",
      celsius: "c", centigrade: "c",
      fahrenheit: "f",
      gigabytes: "gb", gigabyte: "gb",
      megabytes: "mb", megabyte: "mb",
      terabytes: "tb", terabyte: "tb",
      kilobytes: "kb", kilobyte: "kb",
    };
    const a = aliases[from] ?? from.replace(/°/g, "");
    const b = aliases[to] ?? to.replace(/°/g, "");
    const key = `${a}_${b}`;

    /* Temperature is special — not a simple multiply. */
    if ((a === "c" && b === "f") || (a === "°c" && b === "°f")) {
      const r = Math.round((value * 9/5 + 32) * 100) / 100;
      return `${value}°C = ${r}°F`;
    }
    if ((a === "f" && b === "c") || (a === "°f" && b === "°c")) {
      const r = Math.round(((value - 32) * 5/9) * 100) / 100;
      return `${value}°F = ${r}°C`;
    }

    const factor = conversions[key];
    if (factor != null) {
      const r = Math.round(value * factor * 10000) / 10000;
      return `${value} ${from} = ${r} ${to}`;
    }
    return null;
  }

  /* ---------------------------------------------------------- system helpers */

  function getSystemInfo() {
    const cpus = os.cpus();
    const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeMem = (os.freemem() / (1024 ** 3)).toFixed(1);
    return [
      `OS: ${os.type()} ${os.release()} (${os.arch()})`,
      `CPU: ${cpus[0]?.model ?? "unknown"}, ${cpus.length} cores`,
      `RAM: ${freeMem} GB free / ${totalMem} GB total`,
      `User: ${os.userInfo().username}`,
      `Computer: ${os.hostname()}`,
      getDiskInfo(),
    ].join("\n");
  }

  function getDiskInfo() {
    try {
      if (process.platform === "win32") {
        const raw = execSync("wmic logicaldisk get size,freespace,caption", { encoding: "utf8", timeout: 3000 });
        const lines = raw.trim().split("\n").slice(1).filter((l) => l.trim());
        return lines.map((l) => {
          const parts = l.trim().split(/\s+/);
          if (parts.length >= 3) {
            const free = (parseInt(parts[1]) / (1024 ** 3)).toFixed(1);
            const total = (parseInt(parts[2]) / (1024 ** 3)).toFixed(1);
            return `${parts[0]} ${free} GB free / ${total} GB total`;
          }
          return l.trim();
        }).join(", ");
      }
      const raw = execSync("df -h / | tail -1", { encoding: "utf8", timeout: 3000 });
      return `Disk: ${raw.trim()}`;
    } catch { return "Disk info unavailable."; }
  }

  function getBatteryInfo() {
    try {
      if (process.platform === "win32") {
        const raw = execSync(
          "powershell -NoProfile -Command \"(Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json)\"",
          { encoding: "utf8", timeout: 5000 },
        );
        const bat = JSON.parse(raw);
        const pct = bat.EstimatedChargeRemaining ?? "?";
        const charging = bat.BatteryStatus === 2 ? " (charging)" : "";
        return `Battery: ${pct}%${charging}`;
      }
    } catch { /* fall through */ }
    return "Battery info unavailable (desktop or unsupported).";
  }

  /* -------------------------------------------------------- 2. FILE SEARCH */

  /**
   * Search the filesystem for files matching a query — for "where's my resume?"
   * or "find my presentation" questions.  Searches user-approved root directories.
   */
  async function searchFiles(query) {
    const roots = db.get().roots ?? [];
    if (roots.length === 0) {
      /* Fall back to common user directories. */
      const home = os.homedir();
      roots.push(
        path.join(home, "Documents"),
        path.join(home, "Desktop"),
        path.join(home, "Downloads"),
      );
    }

    /* Extract likely filename keywords. */
    const keywords = query
      .toLowerCase()
      .replace(/\b(find|search|where|is|are|my|the|a|an|file|document|folder|called|named|for)\b/g, "")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/[^a-z0-9._-]/gi, ""))
      .filter(Boolean);

    if (keywords.length === 0) return null;

    /* Build a glob pattern. */
    const pattern = `*${keywords.join("*")}*`;
    const found = [];

    for (const root of roots) {
      try {
        const cmd = process.platform === "win32"
          ? `powershell -NoProfile -Command "Get-ChildItem -Path '${root}' -Recurse -Name -Filter '${pattern}' -ErrorAction SilentlyContinue | Select-Object -First 15"`
          : `find "${root}" -iname "${pattern}" -maxdepth 4 2>/dev/null | head -15`;
        const raw = execSync(cmd, { encoding: "utf8", timeout: 8000 });
        const files = raw.trim().split("\n").filter(Boolean);
        for (const f of files) {
          const full = path.isAbsolute(f) ? f : path.join(root, f);
          found.push(full);
        }
      } catch { /* skip this root */ }
    }

    if (found.length === 0) return null;
    return `Files matching "${keywords.join(" ")}":\n\n${found.slice(0, 15).map((f) => `• ${f}`).join("\n")}`;
  }

  /* -------------------------------------------------------- 3. WEB SEARCH */

  /**
   * Returns true for questions that are about general knowledge, facts, how-tos,
   * errors, concepts — things the web can answer.  Returns false for personal
   * questions that only memory could answer.
   */
  function needsWebSearch(question, memoryHits) {
    if (memoryHits >= 3) return false;
    const q = question.toLowerCase();

    /* Personal / memory questions — only memory can answer these. */
    if (/\b(i|my|me|we|our)\b.*(yesterday|last week|earlier|today|this morning|before|previously|last time)/i.test(q)) return false;
    if (/\bwhat (was|were|did|have) (i|we)\b/i.test(q)) return false;
    if (/\bdo you remember\b/i.test(q)) return false;
    if (/\b(my|our) (file|project|code|document|folder|schedule|meeting|task|routine)\b/i.test(q)) return false;

    /* Knowledge / factual / how-to — web search will help. */
    const webPatterns = [
      /\b(what is|what are|what does|what's|whats)\b/i,
      /\b(how (do|to|does|can|should|would))\b/i,
      /\b(explain|define|meaning of|definition|describe)\b/i,
      /\b(why (is|are|does|do|did|can|would|should))\b/i,
      /\b(difference between|compare|vs\.?|versus)\b/i,
      /\b(formula|equation|syntax|shortcut|command|function)\b/i,
      /\b(error|exception|bug|crash|fail|broken|not working|issue)\b/i,
      /\b(best (way|practice|approach|method)|recommended)\b/i,
      /\b(latest|recent|current|new|update|news|2026|2025)\b/i,
      /\b(convert|calculate|translate)\b/i,
      /\b(find|search|look up|lookup|google)\b/i,
      /\b(tutorial|guide|documentation|docs|example|resource)\b/i,
      /\b(install|setup|set up|configure|download)\b/i,
      /\b(who (is|are|was|were|wrote|created|invented|founded))\b/i,
      /\b(when (is|was|did|does|will))\b/i,
      /\b(where (is|are|can|do))\b/i,
      /\b(requirements? for|prerequisites?|qualifications?)\b/i,
      /\b(price|pricing|cost|free|paid|subscription)\b/i,
      /\b(summary|summarize|overview|recap)\b/i,
      /\b(citation|cite|reference|bibliography|apa|mla)\b/i,
      /\b(recipe|ingredients|how .* make|how .* cook)\b/i,
      /\b(weather|forecast|temperature|rain)\b/i,
      /\b(stock|market|crypto|bitcoin|ethereum)\b/i,
      /\b(score|game|match|standings|league)\b/i,
      /\b(movie|film|show|series|cast|director|actor|actress)\b/i,
      /\b(song|album|artist|band|music|lyrics)\b/i,
      /\b(country|capital|population|language|currency)\b/i,
      /\b(university|college|school|program|degree|admission)\b/i,
      /\b(law|legal|regulation|statute|act|rights)\b/i,
      /\b(health|symptom|medication|medicine|treatment|disease)\b/i,
      /\b(api|sdk|library|framework|package|module|npm|pip)\b/i,
      /\b(alternative|replacement|substitute|instead of)\b/i,
      /\b(review|rating|opinion|worth it|should i)\b/i,
    ];
    if (webPatterns.some((re) => re.test(q))) return true;

    /* If memory has zero hits, try web as a last resort. */
    if (memoryHits === 0) return true;
    return false;
  }

  /**
   * Returns true for "where's my file?" style questions.
   */
  function isFileSearchQuestion(question) {
    return /\b(where('?s| is| are| did)|find|locate|search for)\b.*\b(file|document|folder|presentation|spreadsheet|pdf|resume|report|essay|paper|photo|image|video|download)\b/i.test(question)
      || /\b(file|document|folder)\b.*\b(where|find|locate|search)\b/i.test(question);
  }

  /**
   * Quick web search — returns formatted text for context, or null on failure.
   */
  async function quickWebSearch(query) {
    try {
      const result = await browser.run({ kind: "search", query });
      if (!result.ok || !result.text) return null;
      return result.text.slice(0, 4000);
    } catch (err) {
      console.error("[doppel] web search failed:", err.message);
      return null;
    }
  }

  /* -------------------------------------------------------- FULL RESOLUTION */

  /**
   * The master answer function.  Tries every fallback in order:
   * local → memory → web → files → Claude with all context.
   */
  async function resolveQuestion(question, opts = {}) {
    const q = String(question ?? "").trim();
    if (!q) return { ok: false, reason: "empty" };

    /* 1. Local instant answer — no API call. */
    let local = tryLocalAnswer(q);
    if (local) local = await tryLocalAnswerAsync(q, local);
    if (local?.text) {
      /* Still pass through Claude for personality, but give it the answer. */
      return await brain.answer(q, {
        ...opts,
        webContext: `[Local answer — ${local.source}]: ${local.text}`,
        onText: (delta) => broadcast("doppel:answer-stream", delta),
        onThinking: (delta) => broadcast("doppel:thinking-stream", delta),
      });
    }

    /* 2. Memory check — how much does the brain know? */
    const pack = brain.recall(q, { limit: 3, budgetTokens: 800 });
    const memHits = pack.entities.length + pack.episodes.length + pack.digests.length;

    /* 3. Web search — if memory is thin and question is searchable. */
    let webContext = null;
    if (needsWebSearch(q, memHits)) {
      broadcast("doppel:thinking-stream", "Searching the web...\n");
      webContext = await quickWebSearch(q);
    }

    /* 4. File search — if it's a "where's my file?" question. */
    if (!webContext && isFileSearchQuestion(q)) {
      broadcast("doppel:thinking-stream", "Searching your files...\n");
      const files = await searchFiles(q);
      if (files) webContext = `[File search results]:\n${files}`;
    }

    /* 5. Answer with all gathered context. */
    const result = await brain.answer(q, {
      ...opts,
      webContext,
      onText: (delta) => broadcast("doppel:answer-stream", delta),
      onThinking: (delta) => broadcast("doppel:thinking-stream", delta),
    });
    return result;
  }

  async function lookAndAnswer(question, opts) {
    /* One API call: capture the screen, send the image + question together.
       No separate vision analysis step — the model reads the screen and
       answers in one shot. Streamed with thinking so the user sees reasoning. */
    const shot = await screen.capture({ maxEdge: 1366 });
    if (!shot.ok) {
      /* Fall back to recent text-based observations. */
      const ctx = recentScreenContext();
      if (ctx) {
        const result = await brain.answer(question, {
          ...opts,
          screenContext: ctx,
          onText: (delta) => broadcast("doppel:answer-stream", delta),
          onThinking: (delta) => broadcast("doppel:thinking-stream", delta),
        });
        if (result.ok && result.text) brain.rememberConversation(question, result.text, ctx);
        return result;
      }
      return { ok: true, text: shot.detail || "The screen capture didn't come back." };
    }

    const pack = brain.recall(question, { limit: 4, budgetTokens: 800 });
    const found = pack.entities.length + pack.episodes.length + pack.digests.length;
    const memoryBlock = found > 0
      ? `\n\nRelevant memories:\n${brain.packToText(pack)}`
      : "";

    /* If the question is about an error, concept, or how-to, web search
       adds massive value on top of the screen context. */
    let webBlock = "";
    if (needsWebSearch(question, found)) {
      broadcast("doppel:thinking-stream", "Looking at your screen and searching the web...\n");
      const web = await quickWebSearch(question);
      if (web) webBlock = `\n\nWeb search results:\n${web}`;
    }

    const messages = [
      ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      {
        role: "user",
        content: [
          screen.asImageBlock(shot),
          {
            type: "text",
            text: `They said: "${question}"\n\nThat's their screen right now.${memoryBlock}${webBlock}`,
          },
        ],
      },
    ];

    const result = await claude.streamAsk({
      system: `You are Doppel — a personal agent on this person's computer. You can see their screen right now. Answer their question about what's on screen directly and conversationally. Be specific — quote text, name apps, describe what you see. If web search results are provided, use them to give accurate answers — especially for errors, how-tos, and concepts. First person, short sentences, no emoji.`,
      maxTokens: 2048,
      fast: false,
      thinking: true,
      onText: (delta) => broadcast("doppel:answer-stream", delta),
      onThinking: (delta) => broadcast("doppel:thinking-stream", delta),
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
     English again, and only because someone asked.  Both handlers now go
     through resolveQuestion() — the full fallback chain. */
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
      const result = await resolveQuestion(q, { fast: true, history: history ?? [] });
      if (result.ok && result.text) brain.rememberConversation(q, result.text);
      tokens.spend("brain:ask");
      return result;
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

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
      const result = await resolveQuestion(q, { fast: true, history: history ?? [] });
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
        defaultPath: `doppel-brain-${new Date().toISOString().slice(0, 10)}.doppel`,
        filters: [{ name: "Doppel Brain", extensions: ["doppel"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, reason: "canceled" };
      const fs = require("node:fs");
      const zlib = require("node:zlib");
      const compressed = zlib.gzipSync(JSON.stringify(data));
      fs.writeFileSync(result.filePath, compressed);
      return { ok: true, file: result.filePath, stats: data.stats };
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  ipcMain.handle("brain:import", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Import Doppel brain",
        filters: [{ name: "Doppel Brain", extensions: ["doppel"] }],
        properties: ["openFile"],
      });
      if (result.canceled || !result.filePaths?.length) return { ok: false, reason: "canceled" };
      const fs = require("node:fs");
      const zlib = require("node:zlib");
      const compressed = fs.readFileSync(result.filePaths[0]);
      const data = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
      const importResult = brain.importBrain(data);
      pushState();
      return importResult;
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  handle("brain:wipe", () => brain.wipe());

  /* --- user profile ----------------------------------------------------- */

  ipcMain.handle("profile:get", () => profile.getProfile());

  ipcMain.handle("profile:generate", async () => {
    try {
      return await profile.generateProfile();
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

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
    if (result.ok && result.nudge?.kind === "offer") {
      const tasks = readInbox();
      tasks.unshift({
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        status: "approved",
        instruction: result.nudge.detail || result.nudge.text,
        source: "nudge",
        target: "any",
        agent: null,
        claimedAt: null,
        result: null,
        completedAt: null,
      });
      writeInbox(tasks);
    }
    return result;
  });

  /* --- inbox — task queue for external agents ---------------------------- */

  const INBOX_FILE = path.join(db.paths.dir, "inbox.json");

  function readInbox() {
    try {
      const raw = JSON.parse(fs.readFileSync(INBOX_FILE, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }
  function writeInbox(tasks) {
    fs.writeFileSync(INBOX_FILE, JSON.stringify(tasks, null, 2));
  }

  ipcMain.handle("inbox:list", () => readInbox());

  handle("inbox:create", (instruction, autoApprove, target) => {
    const tasks = readInbox();
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      status: autoApprove ? "approved" : "pending",
      instruction,
      source: "user",
      target: target || "any",
      agent: null,
      claimedAt: null,
      result: null,
      completedAt: null,
    };
    tasks.unshift(task);
    writeInbox(tasks);
    pushState();
    return task;
  });

  handle("inbox:approve", (id) => {
    const tasks = readInbox();
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status !== "pending") return { ok: false };
    task.status = "approved";
    writeInbox(tasks);
    pushState();
    return { ok: true };
  });

  handle("inbox:reject", (id) => {
    const tasks = readInbox();
    const task = tasks.find((t) => t.id === id);
    if (!task) return { ok: false };
    const wasClaimed = task.status === "claimed";
    task.status = "rejected";
    if (wasClaimed) task.completedAt = Date.now();
    writeInbox(tasks);
    pushState();
    return { ok: true };
  });

  handle("inbox:retry", (id) => {
    const tasks = readInbox();
    const task = tasks.find((t) => t.id === id);
    if (!task || (task.status !== "failed" && task.status !== "rejected")) return { ok: false };
    task.status = "approved";
    task.agent = null;
    task.claimedAt = null;
    task.result = null;
    task.completedAt = null;
    writeInbox(tasks);
    pushState();
    return { ok: true };
  });

  handle("inbox:clear", () => {
    const tasks = readInbox().filter((t) => t.status !== "done" && t.status !== "failed" && t.status !== "rejected");
    writeInbox(tasks);
    pushState();
    return { ok: true };
  });

  /* --- workflows — cross-agent orchestration ----------------------------- */

  const WORKFLOW_FILE = path.join(db.paths.dir, "workflows.json");

  function readWorkflows() {
    try {
      const raw = JSON.parse(fs.readFileSync(WORKFLOW_FILE, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }
  function writeWorkflows(wfs) {
    fs.writeFileSync(WORKFLOW_FILE, JSON.stringify(wfs, null, 2));
  }

  function createWorkflow(title, steps, onFailure = "abort", source = "user", sourceAgent = null) {
    const wfId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const wfSteps = steps.map((s, i) => ({
      id: `${wfId}-s${i}`,
      index: i,
      instruction: s.instruction,
      target: s.target || "any",
      status: i === 0 ? "queued" : "pending",
      inputContext: null,
      result: null,
      agent: null,
      claimedAt: null,
      completedAt: null,
    }));

    const workflow = {
      id: wfId,
      createdAt: Date.now(),
      status: "running",
      title,
      source,
      sourceAgent,
      steps: wfSteps,
      currentStep: 0,
      completedAt: null,
      onFailure,
    };

    const wfs = readWorkflows();
    wfs.unshift(workflow);
    writeWorkflows(wfs);

    /* Queue first step as an inbox task. */
    const tasks = readInbox();
    tasks.unshift({
      id: wfSteps[0].id,
      createdAt: Date.now(),
      status: "approved",
      instruction: wfSteps[0].instruction,
      source: source === "agent" ? "system" : "user",
      target: wfSteps[0].target,
      agent: null,
      claimedAt: null,
      result: null,
      completedAt: null,
      workflowId: wfId,
      workflowStep: 0,
    });
    writeInbox(tasks);
    pushState();

    return workflow;
  }

  function advanceWorkflow(workflowId, stepResult, success) {
    const wfs = readWorkflows();
    const wf = wfs.find((w) => w.id === workflowId);
    if (!wf || wf.status !== "running") return null;

    const current = wf.steps[wf.currentStep];
    if (current) {
      current.status = success ? "done" : "failed";
      current.result = stepResult;
      current.completedAt = Date.now();
    }

    if (!success) {
      if (wf.onFailure === "abort") {
        wf.status = "failed";
        wf.completedAt = Date.now();
        writeWorkflows(wfs);
        pushState();
        return wf;
      }
      if (wf.onFailure === "skip") {
        current.status = "skipped";
      }
      /* "retry" — the step stays failed, user can retry from UI */
      if (wf.onFailure === "retry") {
        writeWorkflows(wfs);
        pushState();
        return wf;
      }
    }

    /* Move to next step. */
    const nextIdx = wf.currentStep + 1;
    if (nextIdx >= wf.steps.length) {
      wf.status = "done";
      wf.completedAt = Date.now();
      writeWorkflows(wfs);
      pushState();
      return wf;
    }

    wf.currentStep = nextIdx;
    const next = wf.steps[nextIdx];
    next.status = "queued";
    next.inputContext = stepResult;
    writeWorkflows(wfs);

    /* Queue next step as inbox task with previous output. */
    const tasks = readInbox();
    tasks.unshift({
      id: next.id,
      createdAt: Date.now(),
      status: "approved",
      instruction: next.instruction + (stepResult ? `\n\n--- Context from previous step ---\n${stepResult}` : ""),
      source: "system",
      target: next.target,
      agent: null,
      claimedAt: null,
      result: null,
      completedAt: null,
      workflowId,
      workflowStep: nextIdx,
    });
    writeInbox(tasks);
    pushState();

    return wf;
  }

  ipcMain.handle("workflow:list", () => readWorkflows());

  handle("workflow:create", (title, steps, onFailure) => {
    return createWorkflow(title, steps, onFailure);
  });

  handle("workflow:abort", (id) => {
    const wfs = readWorkflows();
    const wf = wfs.find((w) => w.id === id);
    if (!wf || wf.status !== "running") return { ok: false };
    wf.status = "aborted";
    wf.completedAt = Date.now();
    /* Also reject any queued inbox tasks for this workflow. */
    const tasks = readInbox();
    for (const t of tasks) {
      if (t.workflowId === id && (t.status === "approved" || t.status === "pending")) {
        t.status = "rejected";
      }
    }
    writeInbox(tasks);
    writeWorkflows(wfs);
    pushState();
    return { ok: true };
  });

  /* Expose workflow engine for MCP server to use. */
  register._workflows = { readWorkflows, writeWorkflows, createWorkflow, advanceWorkflow };

  /* --- guide — Clicky-style walkthroughs -------------------------------- */

  ipcMain.handle("guide:findElement", async (_e, description) => {
    try { return await guide.findElement(description); }
    catch (err) { return { ok: false, detail: err.message }; }
  });

  handle("guide:pointAt", (x, y, instruction) => {
    guide.pointAt(x, y, instruction);
  });

  handle("guide:clearPointer", () => guide.clearPointer());

  ipcMain.handle("guide:startWalkthrough", async (_e, goal) => {
    try { return await guide.startWalkthrough(goal); }
    catch (err) { return { ok: false, detail: err.message }; }
  });

  ipcMain.handle("guide:nextStep", async () => {
    try { return await guide.nextStep(); }
    catch (err) { return { ok: false, detail: err.message }; }
  });

  ipcMain.handle("guide:prevStep", async () => {
    try { return await guide.prevStep(); }
    catch (err) { return { ok: false, detail: err.message }; }
  });

  handle("guide:endWalkthrough", () => guide.endWalkthrough());

  ipcMain.handle("guide:doStep", async () => {
    try { return await guide.doCurrentStep(); }
    catch (err) { return { ok: false, detail: err.message }; }
  });

  ipcMain.handle("guide:getState", () => guide.getState());

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

  /* --- the account ------------------------------------------------------ */

  handle("account:requestLink", (email) => account.requestLink(email));
  handle("account:verifyLink", (token) => account.verifyLink(token));
  handle("account:register", ({ email, password }) => account.register(email, password));
  handle("account:resetPassword", ({ token, password }) => account.resetPassword(token, password));
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

  handle("billing:checkout", async (priceId) => {
    const result = await account.createCheckout(priceId);
    if (result.ok && result.url) {
      shell.openExternal(result.url);
      return { ok: true, sessionId: result.sessionId };
    }
    return result;
  });

  handle("billing:verifyPurchase", async (sessionId) => {
    const result = await account.verifyCheckout(sessionId);
    if (!result.ok) return result;
    if (result.type === "pro") {
      tokens.setPlan("pro");
    } else if (result.type === "tokens" && result.tokens > 0) {
      tokens.addTokens(result.tokens);
      if (db.get().billing?.plan === "free") tokens.setPlan("paygo");
    }
    return { ok: true, type: result.type, tokens: result.tokens };
  });

  /* --- misc ------------------------------------------------------------- */
  ipcMain.handle("windows:list", () => win32.listWindows());

  handle("app:reset", () => {
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
      const { execFileSync } = require("child_process");
      if (process.platform === "win32") {
        execFileSync("powershell", ["-NoProfile", "-Command", `Start-Process '${last.app.replace(/'/g, "''")}'`]);
      } else if (process.platform === "darwin") {
        execFileSync("open", ["-a", last.app]);
      } else {
        execFileSync("xdg-open", [last.app]);
      }
      return { ok: true, app: last.app, title: last.text };
    } catch {
      return { ok: false, reason: "launch-failed", app: last.app };
    }
  });

  /* --- MCP integration --------------------------------------------------- */

  const mcpScript = path.join(__dirname, "..", "mcp-server.js").replace(/\\/g, "/");
  const mcpSnippet = { command: "node", args: [mcpScript] };
  const mcpHttpPort = Number(process.env.DOPPEL_MCP_PORT ?? 4320);
  const mcpHttpUrl = `https://127.0.0.1:${mcpHttpPort}/mcp`;

  const relay = require("./relay");

  ipcMain.handle("mcp:snippet", () => {
    const relayStatus = relay.status();
    return {
      snippet: mcpSnippet,
      scriptPath: mcpScript,
      httpUrl: mcpHttpUrl,
      relayUrl: relayStatus.mcpUrl || null,
    };
  });

  ipcMain.handle("relay:status", () => relay.status());

  db.subscribe(() => {});
  pushState();
}

module.exports = { register, pushState, broadcast };
