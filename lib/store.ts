"use client";

import { create } from "zustand";
import type {
  AccountOverview,
  AccountState,
  ActiveRun,
  AgentTask,
  AwayAuthorization,
  BrainEntity,
  BrainEpisode,
  BrainStats,
  ContextPack,
  Entity,
  MimicSnapshot,
  NarrationLine,
  ObservedEvent,
  Permissions,
  PocketJob,
  Routine,
  RunRecord,
  Stage,
} from "./types";
import { unattendedEligible } from "./plan";

/**
 * The interface's view of Mimic.
 *
 * There is no truth in here. Everything below is either something the main
 * process reported, or an intention being sent to it. That is deliberate: the
 * work happens where the files are, and the screen only ever shows what
 * genuinely happened.
 */

declare global {
  interface Window {
    mimic?: MimicBridge;
  }
}

export interface MimicBridge {
  isDesktop: boolean;
  platform: string;
  openPocket: () => Promise<unknown>;
  closeWindow: () => Promise<unknown>;

  /* the overlay */
  overlayOpen: (route?: string) => Promise<unknown>;
  overlayMenu: () => Promise<unknown>;
  overlayToggleWatch: () => Promise<boolean>;
  overlaySetEnabled: (on: boolean) => Promise<unknown>;
  overlayHome: () => Promise<unknown>;

  /* the account */
  requestLink: (email: string) => Promise<{ ok: boolean; error?: string; link?: string }>;
  verifyLink: (token: string) => Promise<{ ok: boolean; error?: string }>;
  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  setAccountPassword: (password: string) => Promise<{ ok: boolean; error?: string }>;
  accountOverview: () => Promise<AccountOverview | { ok: false; error?: string }>;
  revokeAccountDevice: (id: string) => Promise<{ ok: boolean }>;
  signOutEverywhere: (keep: boolean) => Promise<{ ok: boolean; revoked?: number }>;
  signOut: () => Promise<{ ok: boolean }>;
  setAccountServer: (url: string) => Promise<unknown>;
  renameDevice: (name: string) => Promise<unknown>;
  exportAccount: () => Promise<{ ok: boolean; file?: string }>;
  deleteAccount: () => Promise<{ ok: boolean }>;

  getState: () => Promise<MimicSnapshot>;
  getRun: () => Promise<ActiveRun | null>;
  onState: (fn: (s: MimicSnapshot) => void) => () => void;
  onRun: (fn: (r: ActiveRun | null) => void) => () => void;
  onAgent: (fn: (t: AgentTask | null) => void) => () => void;
  onNarration: (fn: (line: NarrationLine) => void) => () => void;

  /* the mind */
  setApiKey: (key: string) => Promise<{ ok: boolean; detail?: string }>;
  clearApiKey: () => Promise<unknown>;
  setAutoWatch: (on: boolean) => Promise<unknown>;
  setDetail: (level: "light" | "thorough") => Promise<unknown>;
  lookNow: () => Promise<{ ok: boolean; reason?: string; detail?: string }>;

  /* the brain */
  recall: (query: string) => Promise<{ pack: ContextPack; text: string }>;
  askBrain: (question: string) => Promise<{
    ok: boolean;
    text?: string;
    empty?: boolean;
    reason?: string;
    detail?: string;
    pack?: ContextPack;
  }>;
  forgetMoments: (ids: string[]) => Promise<unknown>;
  brainEntities: () => Promise<BrainEntity[]>;
  brainEpisodes: (limit?: number) => Promise<BrainEpisode[]>;
  brainStats: () => Promise<BrainStats>;
  brainForget: (id: string) => Promise<unknown>;
  consolidate: (scope: "hour" | "day") => Promise<{ ok: boolean; reason?: string }>;
  wipeBrain: () => Promise<unknown>;

  /* the agent */
  getAgent: () => Promise<AgentTask | null>;
  runAgent: (input: {
    instruction: string;
    routineId?: string | null;
    title?: string;
  }) => Promise<{ ok: boolean; reason?: string; detail?: string }>;
  answerAgent: (choice: "approve" | "skip" | "stop") => Promise<unknown>;
  abortAgent: () => Promise<unknown>;

  setPaused: (paused: boolean) => Promise<unknown>;
  setPermissions: (patch: Partial<Permissions>) => Promise<unknown>;
  addRoot: () => Promise<{ ok: boolean; root?: string }>;
  removeRoot: (root: string) => Promise<unknown>;

  armTeaching: () => Promise<unknown>;
  cancelTeaching: () => Promise<unknown>;
  finishTeaching: () => Promise<{ ok: boolean; reason?: string; routineId?: string; confidence?: number }>;
  mineNow: () => Promise<unknown>;

  setProvingRuns: (id: string, n: number) => Promise<unknown>;
  graduate: (id: string) => Promise<unknown>;
  grantUnattended: (id: string) => Promise<unknown>;
  revokeUnattended: (id: string) => Promise<unknown>;
  demote: (id: string) => Promise<unknown>;
  relearn: (id: string) => Promise<unknown>;
  dismissDrift: (id: string) => Promise<unknown>;
  forgetRoutine: (id: string) => Promise<unknown>;

  startRun: (id: string, opts?: { supervised?: boolean }) => Promise<unknown>;
  pauseRun: () => Promise<unknown>;
  resumeRun: () => Promise<unknown>;
  stepBack: () => Promise<unknown>;
  openCorrection: () => Promise<unknown>;
  closeCorrection: () => Promise<unknown>;
  correct: (patch: CorrectionPatch) => Promise<unknown>;
  resolvePark: (choice: "approve" | "skip" | "stop") => Promise<unknown>;
  yieldRun: () => Promise<unknown>;
  resolveYield: (choice: "resume" | "handover" | "stop") => Promise<unknown>;
  abortRun: () => Promise<unknown>;

  rollback: (runId: string) => Promise<{ ok: boolean; detail?: string }>;
  exportWeek: () => Promise<{ ok: boolean; file?: string }>;
  revealTrash: () => Promise<unknown>;

  grantAway: (input: {
    routineIds: string[];
    actionCap: number;
    hours: number;
    keepAlive: boolean;
  }) => Promise<unknown>;
  endAway: () => Promise<unknown>;
  dispatch: (routineId: string) => Promise<unknown>;
  answerJob: (jobId: string, choice: "approve" | "skip" | "later") => Promise<unknown>;
  stopAll: () => Promise<unknown>;
  clearJobs: () => Promise<unknown>;

  forgetEntity: (id: string) => Promise<unknown>;
  listWindows: () => Promise<{ title: string; procId: number }[]>;
  reset: () => Promise<unknown>;
  appPaths: () => Promise<{ state: string; trash: string }>;
  revealPath: (target: string) => Promise<unknown>;
}

export interface CorrectionPatch {
  stepId: string;
  value?: string;
  pattern?: string;
  skip?: boolean;
  move?: "earlier" | "later";
}

const emptySnapshot = (): MimicSnapshot => ({
  version: 0,
  createdAt: Date.now(),
  observation: { paused: false, roots: [] },
  permissions: {
    windows: true,
    files: true,
    clipboard: false,
    screen: false,
    actFiles: true,
    actWrite: true,
    actTrash: false,
    actLaunch: true,
    actGui: false,
  },
  ai: {
    configured: false,
    fromEnvironment: false,
    verified: false,
    lastError: null,
    autoWatch: true,
    detail: "thorough",
    hint: "",
  },
  overlay: { enabled: true, position: null },
  account: {
    signedIn: false,
    email: null,
    accountId: null,
    deviceId: null,
    deviceName: "",
    pairedAt: null,
    pendingEmail: null,
    lastError: null,
    server: "",
  },
  narration: [],
  routines: [],
  runs: [],
  entities: [],
  jobs: [],
  away: {
    active: false,
    grantedAt: 0,
    expiresAt: 0,
    routineIds: [],
    actionCap: 12,
    actionsUsed: 0,
    keepAlive: true,
  },
  devices: [],
  stats: { eventsSeen: 0, sessionsSeen: 0, looks: 0, visionTokens: 0 },
  recentEvents: [],
});

export interface MimicState extends MimicSnapshot {
  /** False until the first report arrives, so nothing flashes empty. */
  ready: boolean;
  /** False in a plain browser, where none of this can be real. */
  connected: boolean;
  now: number;

  activeRun: ActiveRun | null;
  activeAgent: AgentTask | null;
  teaching: boolean;
  graduating: { routineId: string; kind: "trusted" | "unattended" } | null;
  panelOpen: boolean;
  flash: string | null;

  connect: () => void;
  tick: () => void;
  setFlash: (text: string | null) => void;
  setGraduating: (v: MimicState["graduating"]) => void;
  setPanelOpen: (open: boolean) => void;
  setTeaching: (on: boolean) => void;
}

const NO_BRIDGE = "This is the interface without the desktop app behind it.";

const bridge = (): MimicBridge | null =>
  typeof window !== "undefined" && window.mimic?.isDesktop ? window.mimic : null;

export const useMimic = create<MimicState>((set, get) => ({
  ...emptySnapshot(),
  ready: false,
  connected: false,
  now: Date.now(),

  activeRun: null,
  activeAgent: null,
  teaching: false,
  graduating: null,
  panelOpen: false,
  flash: null,

  connect: () => {
    const api = bridge();
    if (!api) {
      set({ ready: true, connected: false });
      return;
    }

    set({ connected: true });

    api.getState().then((s) => set({ ...s, ready: true }));
    api.getRun().then((r) => set({ activeRun: r }));
    api.getAgent().then((t) => set({ activeAgent: t }));
    api.onAgent((t) => set({ activeAgent: t }));

    api.onState((s) => {
      const previous = get().routines;
      set({ ...s, ready: true });

      // Reaching the end of the proving ladder is worth stopping for.
      for (const r of s.routines) {
        const before = previous.find((p) => p.id === r.id);
        if (
          before &&
          r.stage === "supervised" &&
          before.provingRunsPassed < r.provingRunsRequired &&
          r.provingRunsPassed >= r.provingRunsRequired
        ) {
          set({ graduating: { routineId: r.id, kind: "trusted" } });
        }
      }
    });

    api.onRun((r) => set({ activeRun: r }));
  },

  tick: () => set({ now: Date.now() }),
  setFlash: (text) => set({ flash: text }),
  setGraduating: (v) => set({ graduating: v }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setTeaching: (on) => set({ teaching: on }),
}));

/* ---------------------------------------------------------------------------
   Commands. Thin on purpose — each one is a message to the main process.
   --------------------------------------------------------------------------- */

const api = () => bridge();

export const mimic = {
  setPaused: (p: boolean) => api()?.setPaused(p),
  setPermissions: (patch: Partial<Permissions>) => api()?.setPermissions(patch),
  addRoot: () => api()?.addRoot(),
  removeRoot: (root: string) => api()?.removeRoot(root),

  armTeaching: () => api()?.armTeaching(),
  cancelTeaching: () => api()?.cancelTeaching(),
  finishTeaching: () => api()?.finishTeaching() ?? Promise.resolve({ ok: false }),
  mineNow: () => api()?.mineNow(),

  setProvingRuns: (id: string, n: number) => api()?.setProvingRuns(id, n),
  graduate: (id: string) => api()?.graduate(id),
  grantUnattended: (id: string) => api()?.grantUnattended(id),
  revokeUnattended: (id: string) => api()?.revokeUnattended(id),
  demote: (id: string) => api()?.demote(id),
  relearn: (id: string) => api()?.relearn(id),
  dismissDrift: (id: string) => api()?.dismissDrift(id),
  forgetRoutine: (id: string) => api()?.forgetRoutine(id),

  startRun: (id: string, opts?: { supervised?: boolean }) => api()?.startRun(id, opts),
  pauseRun: () => api()?.pauseRun(),
  resumeRun: () => api()?.resumeRun(),
  stepBack: () => api()?.stepBack(),
  openCorrection: () => api()?.openCorrection(),
  closeCorrection: () => api()?.closeCorrection(),
  correct: (patch: CorrectionPatch) => api()?.correct(patch),
  resolvePark: (choice: "approve" | "skip" | "stop") => api()?.resolvePark(choice),
  yieldRun: () => api()?.yieldRun(),
  resolveYield: (choice: "resume" | "handover" | "stop") => api()?.resolveYield(choice),
  abortRun: () => api()?.abortRun(),

  rollback: (runId: string) => api()?.rollback(runId) ?? Promise.resolve({ ok: false }),
  exportWeek: () => api()?.exportWeek() ?? Promise.resolve({ ok: false }),
  revealTrash: () => api()?.revealTrash(),

  grantAway: (input: { routineIds: string[]; actionCap: number; hours: number; keepAlive: boolean }) =>
    api()?.grantAway(input),
  endAway: () => api()?.endAway(),
  dispatch: (routineId: string) => api()?.dispatch(routineId),
  answerJob: (jobId: string, choice: "approve" | "skip" | "later") =>
    api()?.answerJob(jobId, choice),
  stopAll: () => api()?.stopAll(),
  clearJobs: () => api()?.clearJobs(),

  /* the mind */
  setApiKey: (key: string) =>
    api()?.setApiKey(key) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  clearApiKey: () => api()?.clearApiKey(),
  setAutoWatch: (on: boolean) => api()?.setAutoWatch(on),
  setDetail: (level: "light" | "thorough") => api()?.setDetail(level),
  overlaySetEnabled: (on: boolean) => api()?.overlaySetEnabled(on),
  overlayHome: () => api()?.overlayHome(),
  lookNow: () =>
    api()?.lookNow() ?? Promise.resolve({ ok: false, reason: "no-bridge", detail: NO_BRIDGE }),

  /* the brain */
  recall: (query: string) =>
    api()?.recall(query) ??
    Promise.resolve({
      pack: { entities: [], digests: [], episodes: [], tokens: 0 },
      text: "",
    }),
  askBrain: (question: string) =>
    api()?.askBrain(question) ??
    Promise.resolve({ ok: false, reason: "no-bridge", detail: NO_BRIDGE, pack: undefined }),
  forgetMoments: (ids: string[]) => api()?.forgetMoments(ids),
  brainEntities: () => api()?.brainEntities() ?? Promise.resolve([]),
  brainEpisodes: (limit?: number) => api()?.brainEpisodes(limit) ?? Promise.resolve([]),
  brainStats: () =>
    api()?.brainStats() ??
    Promise.resolve({
      episodes: 0,
      entities: 0,
      digests: 0,
      indexedTerms: 0,
      oldest: null,
      vectors: { count: 0, dims: 384, bytes: 0, available: false, unavailable: NO_BRIDGE },
    }),
  brainForget: (id: string) => api()?.brainForget(id),
  consolidate: (scope: "hour" | "day") =>
    api()?.consolidate(scope) ?? Promise.resolve({ ok: false, reason: "no-bridge" }),
  wipeBrain: () => api()?.wipeBrain(),

  /* the agent */
  runAgent: (input: { instruction: string; routineId?: string | null; title?: string }) =>
    api()?.runAgent(input) ?? Promise.resolve({ ok: false, reason: "no-bridge", detail: NO_BRIDGE }),
  answerAgent: (choice: "approve" | "skip" | "stop") => api()?.answerAgent(choice),
  abortAgent: () => api()?.abortAgent(),

  /* the account */
  requestLink: (email: string) =>
    api()?.requestLink(email) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
  verifyLink: (token: string) =>
    api()?.verifyLink(token) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
  signInWithPassword: (email: string, password: string) =>
    api()?.signInWithPassword(email, password) ??
    Promise.resolve({ ok: false, error: "no-bridge" }),
  setAccountPassword: (password: string) =>
    api()?.setAccountPassword(password) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
  accountOverview: () =>
    api()?.accountOverview() ?? Promise.resolve({ ok: false as const, error: "no-bridge" }),
  revokeAccountDevice: (id: string) =>
    api()?.revokeAccountDevice(id) ?? Promise.resolve({ ok: false }),
  signOutEverywhere: (keep: boolean) =>
    api()?.signOutEverywhere(keep) ?? Promise.resolve({ ok: false, revoked: 0 }),
  signOut: () => api()?.signOut() ?? Promise.resolve({ ok: false }),
  setAccountServer: (url: string) => api()?.setAccountServer(url),
  renameDevice: (name: string) => api()?.renameDevice(name),
  exportAccount: () => api()?.exportAccount() ?? Promise.resolve({ ok: false, file: undefined }),
  deleteAccount: () => api()?.deleteAccount() ?? Promise.resolve({ ok: false }),

  forgetEntity: (id: string) => api()?.forgetEntity(id),
  listWindows: () => api()?.listWindows() ?? Promise.resolve([]),
  reset: () => api()?.reset(),
  appPaths: () => api()?.appPaths() ?? Promise.resolve({ state: "", trash: "" }),
  openPocket: () => api()?.openPocket(),
};

/* ---------------------------------------------------------------------------
   Selectors
   --------------------------------------------------------------------------- */

export const byStage = (routines: Routine[], stage: Stage) =>
  routines.filter((r) => r.stage === stage);

export const stageCounts = (routines: Routine[]) => ({
  learning: byStage(routines, "learning").length,
  ready: byStage(routines, "ready").length,
  supervised: byStage(routines, "supervised").length,
  trusted: byStage(routines, "trusted").length,
  unattended: byStage(routines, "unattended").length,
});

export const awaiting = (routines: Routine[]) =>
  routines.filter(
    (r) =>
      r.stage === "ready" ||
      r.drifting ||
      (r.stage === "supervised" && r.provingRunsPassed >= r.provingRunsRequired) ||
      unattendedEligible(r),
  );

export const awayMinutesLeft = (away: AwayAuthorization, now: number) =>
  Math.max(0, Math.round((away.expiresAt - now) / 60_000));

export type {
  Routine,
  RunRecord,
  Entity,
  PocketJob,
  ObservedEvent,
  AwayAuthorization,
  AgentTask,
  NarrationLine,
  BrainEntity,
  BrainEpisode,
  BrainStats,
  ContextPack,
};
