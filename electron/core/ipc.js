const { ipcMain, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const db = require("./db");
const observer = require("./observer");
const miner = require("./miner");
const engine = require("./engine");
const actions = require("./actions");
const win32 = require("./win32");
const claude = require("./claude");
const brain = require("./brain");
const vision = require("./vision");
const agent = require("./agent");
const account = require("./account");

/**
 * Everything the interface can ask for. The renderer holds no truth of its
 * own — it renders what the main process reports and sends intentions back.
 */

const MINE_DEBOUNCE_MS = 6000;
const MINE_INTERVAL_MS = 60_000;

let mineTimer = null;
let teaching = { armed: false, startedAt: 0 };

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

const pushState = () => broadcast("mimic:state", db.publicState());
const pushRun = (run) => broadcast("mimic:run", run);
const pushAgent = (task) => broadcast("mimic:agent", task);
const pushNarration = (line) => broadcast("mimic:narration", line);

/* ------------------------------------------------------------------- mining */

function scheduleMine() {
  if (mineTimer) clearTimeout(mineTimer);
  mineTimer = setTimeout(() => {
    mineTimer = null;
    try {
      miner.mine();
      pushState();
    } catch (err) {
      console.error("[mimic] mining failed:", err.message);
    }
  }, MINE_DEBOUNCE_MS);
}

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
      console.error("[mimic] could not consolidate:", err.message);
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
}

/* -------------------------------------------------------------- pocket queue */

let jobTimer = null;

function jobTick() {
  const s = db.get();
  const running = engine.snapshot();
  if (running && !["finished", "stopped"].includes(running.status)) return;

  const next = [...s.jobs].reverse().find((j) => j.state === "queued");
  if (!next) return;

  const routine = s.routines.find((r) => r.id === next.routineId);
  if (!routine) {
    db.update((st) => {
      const j = st.jobs.find((x) => x.id === next.id);
      if (j) j.state = "stopped";
    });
    pushState();
    return;
  }

  db.update((st) => {
    const j = st.jobs.find((x) => x.id === next.id);
    if (j) {
      j.state = "running";
      j.startedAt = Date.now();
    }
  });
  pushState();

  engine.start(next.routineId, { supervised: false, unattended: true, from: "pocket" });
}

function startJobLoop() {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(() => {
    const s = db.get();
    if (s.observation.paused) return;
    if (s.away.active && Date.now() >= s.away.expiresAt) {
      db.update((st) => {
        st.away.active = false;
      });
      pushState();
    }
    jobTick();
  }, 1500);
}

/** Keep the Pocket job in step with what the engine is actually doing. */
function syncJobFromRun(run) {
  if (!run || run.dispatchedFrom !== "pocket") return;

  db.update((s) => {
    const job = s.jobs.find((j) => j.state === "running" && j.routineId === run.routineId);
    if (!job) return;

    const routine = s.routines.find((r) => r.id === run.routineId);
    const step = routine?.stepLibrary.find((x) => x.id === run.order[run.stepIndex]);
    job.stepIndex = Math.max(0, run.stepIndex);
    job.stepCount = run.order.length;
    job.stepLabel = step?.label;
    job.runId = run.id;

    if (run.status === "parked") {
      job.state = "needs-you";
      job.question = { prompt: run.parkedReason, rule: run.parkedRule };
    } else if (run.status === "finished") {
      job.state = "done";
      job.finishedAt = Date.now();
    } else if (run.status === "stopped") {
      job.state = "stopped";
      job.finishedAt = Date.now();
    }
  });
  pushState();
}

/* --------------------------------------------------------------------- wire */

function register() {
  engine.setPublisher((run) => {
    pushRun(run);
    syncJobFromRun(run);
    if (run && ["finished", "stopped"].includes(run.status)) pushState();
  });

  agent.setPublisher((task) => {
    pushAgent(task);
    if (task && ["finished", "stopped"].includes(task.status)) pushState();
  });

  brain.init();

  observer.start((event) => {
    /* Window changes are the cue to take a fresh look — a new window is the
       moment most likely to be a new piece of work. */
    if (event.kind === "window.focus") vision.noteWindow(event);
    scheduleMine();
    pushState();
  });

  vision.start((line) => {
    pushNarration(line);
    pushState();
  });

  startConsolidation();
  account.startHeartbeat();

  setInterval(() => {
    try {
      miner.mine();
      pushState();
    } catch {
      /* nothing worth reporting */
    }
  }, MINE_INTERVAL_MS);

  startJobLoop();

  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        const result = await fn(...args);
        pushState();
        return result ?? { ok: true };
      } catch (err) {
        console.error(`[mimic] ${channel}:`, err);
        return { ok: false, detail: err.message };
      }
    });

  /* --- state ------------------------------------------------------------ */
  ipcMain.handle("state:get", () => db.publicState());
  ipcMain.handle("run:get", () => engine.snapshot());

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
      title: "Which folder may Mimic watch?",
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

  /* --- teaching --------------------------------------------------------- */
  handle("teach:arm", () => {
    teaching = { armed: true, startedAt: Date.now() };
    return { ok: true };
  });

  handle("teach:cancel", () => {
    teaching = { armed: false, startedAt: 0 };
  });

  handle("teach:finish", () => {
    if (!teaching.armed) return { ok: false, reason: "not-armed" };
    const from = teaching.startedAt;
    teaching = { armed: false, startedAt: 0 };
    const result = miner.creditTeaching(from, Date.now());
    return result;
  });

  handle("mine:now", () => {
    miner.mine();
    return { ok: true };
  });

  /* --- routines --------------------------------------------------------- */
  const patchRoutine = (id, fn) =>
    db.update((s) => {
      const r = s.routines.find((x) => x.id === id);
      if (r) fn(r, s);
    });

  handle("routine:setProvingRuns", (id, n) =>
    patchRoutine(id, (r) => {
      r.provingRunsRequired = Math.min(5, Math.max(3, Number(n) || 4));
    }),
  );

  handle("routine:graduate", (id) =>
    patchRoutine(id, (r) => {
      r.stage = "trusted";
      r.quarantined = false;
      r.presentRunsPassed = 0;
    }),
  );

  handle("routine:grantUnattended", (id) =>
    patchRoutine(id, (r) => {
      r.stage = "unattended";
    }),
  );

  handle("routine:revokeUnattended", (id) =>
    patchRoutine(id, (r, s) => {
      r.stage = "trusted";
      s.away.routineIds = s.away.routineIds.filter((x) => x !== id);
    }),
  );

  handle("routine:demote", (id) =>
    patchRoutine(id, (r, s) => {
      r.stage = "supervised";
      r.provingRunsPassed = 0;
      r.presentRunsPassed = 0;
      s.away.routineIds = s.away.routineIds.filter((x) => x !== id);
    }),
  );

  handle("routine:relearn", (id) =>
    patchRoutine(id, (r) => {
      r.stage = "learning";
      r.relearning = true;
      r.drifting = false;
      r.recentOutcomes = [];
      r.confidence = Math.min(r.confidence, 55);
      r.confidenceHistory.push({ at: Date.now(), value: r.confidence });
    }),
  );

  handle("routine:dismissDrift", (id) =>
    patchRoutine(id, (r) => {
      r.drifting = false;
      r.recentOutcomes = [];
    }),
  );

  handle("routine:forget", (id) =>
    db.update((s) => {
      s.routines = s.routines.filter((r) => r.id !== id);
    }),
  );

  /* --- runs ------------------------------------------------------------- */
  handle("run:start", (id, opts) => engine.start(id, opts ?? {}));
  handle("run:pause", () => engine.pause());
  handle("run:resume", () => engine.resume());
  handle("run:stepBack", () => engine.stepBack());
  handle("run:openCorrection", () => engine.openCorrection());
  handle("run:closeCorrection", () => engine.closeCorrection());
  handle("run:correct", (patch) => engine.correct(patch));
  handle("run:resolvePark", (choice) => engine.resolvePark(choice));
  handle("run:yield", () => engine.yieldToUser());
  handle("run:resolveYield", (choice) => engine.resolveYield(choice));
  handle("run:abort", () => engine.abort());

  /* --- ledger ----------------------------------------------------------- */
  handle("ledger:rollback", (runId) => engine.rollback(runId));

  handle("ledger:export", async () => {
    const s = db.get();
    const win = BrowserWindow.getFocusedWindow();
    const picked = await dialog.showSaveDialog(win, {
      title: "Export the week",
      defaultPath: `mimic-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false };

    const since = Date.now() - 7 * 86_400_000;
    const rows = [
      "When,Routine,Outcome,Duration (s),Minutes returned,Corrections,Watched,Changes",
      ...s.runs
        .filter((r) => r.at >= since)
        .sort((a, b) => a.at - b.at)
        .map((r) =>
          [
            new Date(r.at).toISOString(),
            `"${r.routineTitle.replace(/"/g, '""')}"`,
            r.outcome,
            r.durationSec,
            r.minutesSaved,
            r.corrections,
            r.supervised ? "yes" : "no",
            `"${(r.changes ?? []).join("; ").replace(/"/g, '""')}"`,
          ].join(","),
        ),
    ];
    fs.writeFileSync(picked.filePath, rows.join("\n"), "utf8");
    return { ok: true, file: picked.filePath };
  });

  handle("ledger:revealTrash", () => {
    shell.openPath(db.paths.trash);
  });

  /* --- away ------------------------------------------------------------- */
  handle("away:grant", ({ routineIds, actionCap, hours, keepAlive }) => {
    const now = Date.now();
    db.update((s) => {
      s.away = {
        active: true,
        grantedAt: now,
        expiresAt: now + hours * 3_600_000,
        routineIds,
        actionCap,
        actionsUsed: 0,
        keepAlive: Boolean(keepAlive),
      };
    });
  });

  handle("away:end", () =>
    db.update((s) => {
      s.away.active = false;
    }),
  );

  /* --- pocket ----------------------------------------------------------- */
  handle("pocket:dispatch", (routineId) => {
    const s = db.get();
    const routine = s.routines.find((r) => r.id === routineId);
    if (!routine) return { ok: false, detail: "No such routine." };

    db.update((st) => {
      st.jobs.unshift({
        id: crypto.randomUUID(),
        routineId,
        routineTitle: routine.title,
        state: "queued",
        dispatchedAt: Date.now(),
        stepIndex: 0,
        stepCount: engine.activePlan(routine).length,
      });
    });
    return { ok: true };
  });

  handle("pocket:answer", (jobId, choice) => {
    const map = { approve: "approve", skip: "skip", later: "later" };
    if (choice === "later") {
      db.update((s) => {
        const j = s.jobs.find((x) => x.id === jobId);
        if (j) {
          j.state = "queued";
          j.question = null;
        }
      });
      engine.stopCleanly("You said you'd deal with it later.");
      return;
    }
    engine.resolvePark(map[choice] ?? "skip");
  });

  handle("pocket:stopAll", () => {
    engine.abort();
    db.update((s) => {
      for (const j of s.jobs) {
        if (["queued", "running", "needs-you"].includes(j.state)) {
          j.state = "stopped";
          j.finishedAt = Date.now();
          j.question = null;
        }
      }
      s.away.active = false;
    });
  });

  handle("pocket:clear", () =>
    db.update((s) => {
      s.jobs = s.jobs.filter((j) => !["done", "stopped"].includes(j.state));
    }),
  );

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
      s.ai.apiKey = check.ok ? trimmed : s.ai.apiKey;
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
    const result = await vision.look({ reason: "you asked", force: true });
    return result;
  });

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
  ipcMain.handle("brain:ask", async (_e, question) => {
    try {
      return await brain.answer(String(question ?? ""));
    } catch (err) {
      return { ok: false, reason: "error", detail: err.message };
    }
  });

  handle("brain:forgetMoments", (ids) => brain.forgetEpisodes(ids ?? []));

  ipcMain.handle("brain:entities", () => brain.knownEntities());
  ipcMain.handle("brain:episodes", (_e, limit) => brain.recentEpisodes(limit ?? 60));
  ipcMain.handle("brain:stats", () => brain.stats());

  handle("brain:forget", (id) => brain.forgetEntity(id));

  handle("brain:consolidate", async (scope) => {
    const result = await brain.consolidate({ scope: scope === "day" ? "day" : "hour" });
    return result;
  });

  handle("brain:wipe", () => brain.wipe());

  /* --- the agent -------------------------------------------------------- */

  ipcMain.handle("agent:get", () => agent.snapshot());

  handle("agent:run", async ({ instruction, routineId, title }) => {
    const result = await agent.run({ instruction, routineId, title });
    return result;
  });

  handle("agent:answer", (choice) => agent.answerApproval(choice));
  handle("agent:abort", () => agent.abort());

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
      defaultPath: `mimic-account-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, error: "cancelled" };

    const { ok: _ok, ...body } = data;
    fs.writeFileSync(picked.filePath, JSON.stringify(body, null, 2), "utf8");
    return { ok: true, file: picked.filePath };
  });

  handle("account:delete", () => account.deleteAccount());

  /* --- misc ------------------------------------------------------------- */
  ipcMain.handle("windows:list", () => win32.listWindows());

  handle("app:reset", () => {
    engine.abort();
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

  db.subscribe(() => {});
  pushState();
}

module.exports = { register, pushState, broadcast };
