"use client";

import { create } from "zustand";
import type {
  AccountOverview,
  AccountState,
  AddonInfo,
  AgentRun,
  AgentTask,
  BrainEntity,
  BrainEpisode,
  BrainPattern,
  BrainStats,
  ContextPack,
  Entity,
  DoppelSnapshot,
  MorningBrief,
  NarrationLine,
  Nudge,
  ObservedEvent,
  Permissions,
  RecordedProcedure,
  RecordingSession,
  Routine,
  RoutineProposal,
  SecurityState,
  WhisperState,
} from "./types";

/**
 * The interface's view of Doppel.
 *
 * There is no truth in here. Everything below is either something the main
 * process reported, or an intention being sent to it. That is deliberate: the
 * work happens where the files are, and the screen only ever shows what
 * genuinely happened.
 */

declare global {
  interface Window {
    doppel?: DoppelBridge;
  }
}

export interface DoppelBridge {
  isDesktop: boolean;
  platform: string;
  closeWindow: () => Promise<unknown>;

  /* the overlay */
  overlayOpen: (route?: string) => Promise<unknown>;
  overlayMenu: () => Promise<unknown>;
  overlayToggleWatch: () => Promise<boolean>;
  overlaySetEnabled: (on: boolean) => Promise<unknown>;
  overlayHome: () => Promise<unknown>;

  /* the whisper panel */
  whisperSetEnabled: (on: boolean) => Promise<unknown>;
  whisperHome: () => Promise<unknown>;
  whisperSetAutoDismiss: (sec: number) => Promise<unknown>;
  whisperHide: () => Promise<unknown>;

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

  getState: () => Promise<DoppelSnapshot>;
  onState: (fn: (s: DoppelSnapshot) => void) => () => void;
  onAgent: (fn: (t: AgentTask[]) => void) => () => void;
  onNarration: (fn: (line: NarrationLine) => void) => () => void;
  onNudge: (fn: (nudges: Nudge[]) => void) => () => void;
  onAnswerStream: (fn: (delta: string) => void) => () => void;
  getNudges: () => Promise<Nudge[]>;
  dismissNudge: (id: string) => Promise<unknown>;
  actOnNudge: (id: string) => Promise<{ ok: boolean; nudge?: Nudge }>;
  nudgeSetEnabled: (on: boolean) => Promise<unknown>;

  /* security / biometric */
  securityAvailable: () => Promise<{ available: boolean; detail?: string }>;
  securityStatus: () => Promise<{ available: boolean; enabled: boolean; locked: boolean; lockTimeout: number }>;
  securityVerify: () => Promise<{ ok: boolean; method?: string; detail?: string }>;
  securitySetBiometric: (on: boolean) => Promise<{ ok: boolean; detail?: string }>;
  securitySetLockTimeout: (min: number) => Promise<unknown>;
  securityLock: () => Promise<unknown>;
  onUnlocked: (fn: (unlocked: boolean) => void) => () => void;

  /* updates */
  getUpdateStatus: () => Promise<{ state: string; version?: string | null; progress?: number | null }>;
  checkForUpdate: () => Promise<unknown>;
  installUpdate: () => Promise<unknown>;
  onUpdate: (fn: (status: { state: string; version?: string | null; progress?: number | null }) => void) => () => void;

  /* the mind */
  setApiKey: (key: string) => Promise<{ ok: boolean; detail?: string }>;
  clearApiKey: () => Promise<unknown>;
  setOpenAIKey: (key: string) => Promise<{ ok: boolean; detail?: string }>;
  clearOpenAIKey: () => Promise<unknown>;
  transcribeAudio: (buffer: ArrayBuffer, prompt?: string) => Promise<{ ok: boolean; text?: string; detail?: string }>;
  whisperAsk: (buffer: ArrayBuffer, history?: { role: string; content: string }[]) => Promise<{
    ok: boolean;
    transcript?: string;
    text?: string;
    empty?: boolean;
    phase?: string;
    detail?: string;
    isInstruction?: boolean;
  }>;
  setAutoWatch: (on: boolean) => Promise<unknown>;
  setDetail: (level: "light" | "thorough") => Promise<unknown>;
  lookNow: () => Promise<{ ok: boolean; reason?: string; detail?: string }>;

  /* the brain */
  recall: (query: string) => Promise<{ pack: ContextPack; text: string }>;
  askBrainFast: (question: string, history?: { role: string; content: string }[]) => Promise<{
    ok: boolean;
    text?: string;
    empty?: boolean;
    reason?: string;
    detail?: string;
    pack?: ContextPack;
  }>;
  askBrain: (question: string, history?: { role: string; content: string }[]) => Promise<{
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
  brainAvailableDates: () => Promise<string[]>;
  brainEpisodesForDate: (date: string) => Promise<BrainEpisode[]>;
  brainPatterns: () => Promise<BrainPattern[]>;
  morningBrief: () => Promise<{ ok: boolean; brief?: MorningBrief; cached?: boolean; reason?: string; detail?: string }>;
  morningBriefCached: () => Promise<{ ok: boolean; brief?: MorningBrief }>;
  brainStats: () => Promise<BrainStats>;
  brainForget: (id: string) => Promise<unknown>;
  consolidate: (scope: "hour" | "day") => Promise<{ ok: boolean; reason?: string }>;
  exportBrain: () => Promise<{ ok: boolean; file?: string; reason?: string; detail?: string; stats?: { totalEpisodes: number; totalEntities: number; totalDigests: number } }>;
  wipeBrain: () => Promise<unknown>;
  ingestDocument: (filePath?: string) => Promise<{ ok: boolean; episodes?: number; files?: string[]; title?: string; detail?: string }>;
  ingestSupported: () => Promise<string[]>;

  /* workflow recording */
  recorderStart: (title?: string) => Promise<{ ok: boolean; sessionId?: string; detail?: string }>;
  recorderStop: () => Promise<{
    ok: boolean;
    sessionId?: string;
    procedure?: RecordedProcedure;
    episodeCount?: number;
    durationSec?: number;
    detail?: string;
  }>;
  recorderActive: () => Promise<RecordingSession | null>;
  recorderAbort: () => Promise<{ ok: boolean }>;
  recorderSave: (procedure: RecordedProcedure) => Promise<{ ok: boolean; routine?: Routine }>;

  /* routines */
  listRoutines: () => Promise<Routine[]>;
  routineProposals: () => Promise<RoutineProposal[]>;
  acceptRoutine: (patternId: string) => Promise<{ ok: boolean; routine?: Routine }>;
  rejectRoutine: (patternId: string) => Promise<{ ok: boolean }>;
  removeRoutine: (routineId: string) => Promise<{ ok: boolean }>;
  toggleRoutine: (routineId: string) => Promise<{ ok: boolean }>;
  runRoutineNow: (routineId: string) => Promise<{ ok: boolean; taskId?: string }>;

  /* the agent */
  getAgent: () => Promise<AgentTask[]>;
  agentHistory: (limit?: number) => Promise<AgentRun[]>;
  runAgent: (input: {
    instruction: string;
    routineId?: string | null;
    title?: string;
    mode?: "background" | "foreground";
  }) => Promise<{ ok: boolean; taskId?: string; reason?: string; detail?: string }>;
  answerAgent: (id: string, choice: "approve" | "skip" | "stop") => Promise<unknown>;
  abortAgent: (id?: string) => Promise<unknown>;

  setPaused: (paused: boolean) => Promise<unknown>;
  setPermissions: (patch: Partial<Permissions>) => Promise<unknown>;
  addRoot: () => Promise<{ ok: boolean; root?: string }>;
  removeRoot: (root: string) => Promise<unknown>;
  listDisplays: () => Promise<{ id: string; label: string; width: number; height: number; primary: boolean }[]>;
  setDisplay: (displayId: string | null) => Promise<unknown>;

  /* add-ons */
  listAddons: () => Promise<AddonInfo[]>;
  installAddon: (id: string) => Promise<{ ok: boolean }>;
  uninstallAddon: (id: string) => Promise<{ ok: boolean }>;
  enableAddon: (id: string) => Promise<{ ok: boolean }>;
  disableAddon: (id: string) => Promise<{ ok: boolean }>;
  setAddonConfig: (id: string, key: string, value: string) => Promise<{ ok: boolean }>;
  addonAuth: (id: string) => Promise<{ ok: boolean; error?: string }>;
  addonDisconnect: (id: string) => Promise<{ ok: boolean }>;

  /* resume */
  resumeLast: () => Promise<{ ok: boolean; app?: string; title?: string; reason?: string }>;

  /* MCP integration */
  mcpConnectClaude: () => Promise<{ ok: boolean; path?: string; detail?: string }>;
  mcpCheckClaude: () => Promise<{ connected: boolean }>;

  forgetEntity: (id: string) => Promise<unknown>;
  listWindows: () => Promise<{ title: string; procId: number }[]>;
  reset: () => Promise<unknown>;
  appPaths: () => Promise<{ state: string; trash: string }>;
  revealPath: (target: string) => Promise<unknown>;
}

const emptySnapshot = (): DoppelSnapshot => ({
  version: 0,
  createdAt: Date.now(),
  observation: { paused: false, roots: [], displayId: null },
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
    openaiConfigured: false,
    openaiHint: "",
  },
  overlay: { enabled: true, position: null },
  whisper: { enabled: true, hotkey: "Ctrl+Shift+Space", position: null, autoDismiss: 0 },
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
  entities: [],
  nudges: [],
  nudgeSettings: { enabled: true },
  devices: [],
  stats: { eventsSeen: 0, sessionsSeen: 0, looks: 0, visionTokens: 0 },
  addons: { installed: {} },
  security: { biometric: false, lockTimeout: 0 },
  usage: { current: { month: "", inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, calls: 0 }, months: {} },
  recentEvents: [],
});

export interface DoppelState extends DoppelSnapshot {
  /** False until the first report arrives, so nothing flashes empty. */
  ready: boolean;
  /** False in a plain browser, where none of this can be real. */
  connected: boolean;
  now: number;

  agents: AgentTask[];
  updateStatus: { state: string; version?: string | null; progress?: number | null };
  panelOpen: boolean;
  flash: string | null;

  connect: () => void;
  tick: () => void;
  setFlash: (text: string | null) => void;
  setPanelOpen: (open: boolean) => void;
}

const NO_BRIDGE = "This is the interface without the desktop app behind it.";

const bridge = (): DoppelBridge | null =>
  typeof window !== "undefined" && window.doppel?.isDesktop ? window.doppel : null;

export const useDoppel = create<DoppelState>((set) => ({
  ...emptySnapshot(),
  ready: false,
  connected: false,
  now: Date.now(),

  agents: [],
  updateStatus: { state: "idle" },
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
    api.getAgent().then((t) => set({ agents: t ?? [] }));
    api.getNudges().then((n) => set({ nudges: n }));
    api.getUpdateStatus().then((s) => set({ updateStatus: s }));
    api.onAgent((t) => set({ agents: t ?? [] }));
    api.onNudge((n) => set({ nudges: n }));
    api.onUpdate((s) => set({ updateStatus: s }));
    api.onState((s) => set({ ...s, ready: true }));
  },

  tick: () => set({ now: Date.now() }),
  setFlash: (text) => set({ flash: text }),
  setPanelOpen: (open) => set({ panelOpen: open }),
}));

/* ---------------------------------------------------------------------------
   Commands. Thin on purpose — each one is a message to the main process.
   --------------------------------------------------------------------------- */

const api = () => bridge();

export const doppel = {
  setPaused: (p: boolean) => api()?.setPaused(p),
  setPermissions: (patch: Partial<Permissions>) => api()?.setPermissions(patch),
  addRoot: () => api()?.addRoot(),
  removeRoot: (root: string) => api()?.removeRoot(root),
  listDisplays: () => api()?.listDisplays() ?? Promise.resolve([]),
  setDisplay: (displayId: string | null) => api()?.setDisplay(displayId),

  /* the mind */
  setApiKey: (key: string) =>
    api()?.setApiKey(key) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  clearApiKey: () => api()?.clearApiKey(),
  setOpenAIKey: (key: string) =>
    api()?.setOpenAIKey(key) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  clearOpenAIKey: () => api()?.clearOpenAIKey(),
  transcribeAudio: (buffer: ArrayBuffer, prompt?: string) =>
    api()?.transcribeAudio(buffer, prompt) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  whisperAsk: (buffer: ArrayBuffer, history?: { role: string; content: string }[]) =>
    api()?.whisperAsk(buffer, history) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  setAutoWatch: (on: boolean) => api()?.setAutoWatch(on),
  setDetail: (level: "light" | "thorough") => api()?.setDetail(level),
  overlaySetEnabled: (on: boolean) => api()?.overlaySetEnabled(on),
  overlayHome: () => api()?.overlayHome(),
  whisperSetEnabled: (on: boolean) => api()?.whisperSetEnabled(on),
  whisperHome: () => api()?.whisperHome(),
  whisperSetAutoDismiss: (sec: number) => api()?.whisperSetAutoDismiss(sec),
  lookNow: () =>
    api()?.lookNow() ?? Promise.resolve({ ok: false, reason: "no-bridge", detail: NO_BRIDGE }),

  /* the brain */
  recall: (query: string) =>
    api()?.recall(query) ??
    Promise.resolve({
      pack: { entities: [], digests: [], episodes: [], tokens: 0 },
      text: "",
    }),
  askBrain: (question: string, history?: { role: string; content: string }[]) =>
    api()?.askBrain(question, history) ??
    Promise.resolve({ ok: false, reason: "no-bridge", detail: NO_BRIDGE, pack: undefined }),
  askBrainFast: (question: string, history?: { role: string; content: string }[]) =>
    api()?.askBrainFast(question, history) ??
    Promise.resolve({ ok: false, reason: "no-bridge", detail: NO_BRIDGE, pack: undefined }),
  forgetMoments: (ids: string[]) => api()?.forgetMoments(ids),
  brainEntities: () => api()?.brainEntities() ?? Promise.resolve([]),
  brainEpisodes: (limit?: number) => api()?.brainEpisodes(limit) ?? Promise.resolve([]),
  brainAvailableDates: () => api()?.brainAvailableDates() ?? Promise.resolve([]),
  brainEpisodesForDate: (date: string) =>
    api()?.brainEpisodesForDate(date) ?? Promise.resolve([]),
  brainPatterns: () => api()?.brainPatterns() ?? Promise.resolve([]),
  morningBrief: () =>
    api()?.morningBrief() ?? Promise.resolve({ ok: false, reason: "no-bridge" }),
  morningBriefCached: () =>
    api()?.morningBriefCached() ?? Promise.resolve({ ok: false }),
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
  exportBrain: () =>
    api()?.exportBrain() ?? Promise.resolve({ ok: false, reason: "no-bridge" }),
  wipeBrain: () => api()?.wipeBrain(),
  ingestDocument: (filePath?: string) =>
    api()?.ingestDocument(filePath) ?? Promise.resolve({ ok: false, detail: "Not connected." }),
  ingestSupported: () => api()?.ingestSupported() ?? Promise.resolve([]),

  /* workflow recording */
  recorderStart: (title?: string) =>
    api()?.recorderStart(title) ?? Promise.resolve({ ok: false, detail: "Not connected." }),
  recorderStop: () =>
    api()?.recorderStop() ?? Promise.resolve({ ok: false, detail: "Not connected." }),
  recorderActive: () => api()?.recorderActive() ?? Promise.resolve(null),
  recorderAbort: () => api()?.recorderAbort() ?? Promise.resolve({ ok: false }),
  recorderSave: (procedure: RecordedProcedure) =>
    api()?.recorderSave(procedure) ?? Promise.resolve({ ok: false }),

  /* routines */
  listRoutines: () => api()?.listRoutines() ?? Promise.resolve([]),
  routineProposals: () => api()?.routineProposals() ?? Promise.resolve([]),
  acceptRoutine: (patternId: string) =>
    api()?.acceptRoutine(patternId) ?? Promise.resolve({ ok: false }),
  rejectRoutine: (patternId: string) =>
    api()?.rejectRoutine(patternId) ?? Promise.resolve({ ok: false }),
  removeRoutine: (routineId: string) =>
    api()?.removeRoutine(routineId) ?? Promise.resolve({ ok: false }),
  toggleRoutine: (routineId: string) =>
    api()?.toggleRoutine(routineId) ?? Promise.resolve({ ok: false }),
  runRoutineNow: (routineId: string) =>
    api()?.runRoutineNow(routineId) ?? Promise.resolve({ ok: false }),

  /* the agent */
  agentHistory: (limit?: number) => api()?.agentHistory(limit) ?? Promise.resolve([]),
  runAgent: (input: { instruction: string; routineId?: string | null; title?: string; mode?: "background" | "foreground" }) =>
    api()?.runAgent(input) ?? Promise.resolve({ ok: false, reason: "no-bridge", detail: NO_BRIDGE }),
  answerAgent: (id: string, choice: "approve" | "skip" | "stop") => api()?.answerAgent(id, choice),
  abortAgent: (id?: string) => api()?.abortAgent(id),

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

  /* add-ons */
  listAddons: () => api()?.listAddons() ?? Promise.resolve([]),
  installAddon: (id: string) => api()?.installAddon(id) ?? Promise.resolve({ ok: false }),
  uninstallAddon: (id: string) => api()?.uninstallAddon(id) ?? Promise.resolve({ ok: false }),
  enableAddon: (id: string) => api()?.enableAddon(id) ?? Promise.resolve({ ok: false }),
  disableAddon: (id: string) => api()?.disableAddon(id) ?? Promise.resolve({ ok: false }),
  setAddonConfig: (id: string, key: string, value: string) =>
    api()?.setAddonConfig(id, key, value) ?? Promise.resolve({ ok: false }),
  addonAuth: (id: string) =>
    api()?.addonAuth(id) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
  addonDisconnect: (id: string) =>
    api()?.addonDisconnect(id) ?? Promise.resolve({ ok: false }),

  /* nudges */
  dismissNudge: (id: string) => api()?.dismissNudge(id),
  actOnNudge: (id: string) =>
    api()?.actOnNudge(id) ?? Promise.resolve({ ok: false }),
  nudgeSetEnabled: (on: boolean) => api()?.nudgeSetEnabled(on),

  /* security / biometric */
  securityAvailable: () =>
    api()?.securityAvailable() ?? Promise.resolve({ available: false }),
  securityStatus: () =>
    api()?.securityStatus() ??
    Promise.resolve({ available: false, enabled: false, locked: false, lockTimeout: 0 }),
  securityVerify: () =>
    api()?.securityVerify() ?? Promise.resolve({ ok: false, detail: "Not connected." }),
  securitySetBiometric: (on: boolean) =>
    api()?.securitySetBiometric(on) ?? Promise.resolve({ ok: false, detail: "Not connected." }),
  securitySetLockTimeout: (min: number) => api()?.securitySetLockTimeout(min),
  securityLock: () => api()?.securityLock(),

  /* updates */
  getUpdateStatus: () => api()?.getUpdateStatus() ?? Promise.resolve({ state: "idle" }),
  checkForUpdate: () => api()?.checkForUpdate(),
  installUpdate: () => api()?.installUpdate(),

  forgetEntity: (id: string) => api()?.forgetEntity(id),
  listWindows: () => api()?.listWindows() ?? Promise.resolve([]),
  reset: () => api()?.reset(),
  appPaths: () => api()?.appPaths() ?? Promise.resolve({ state: "", trash: "" }),
  revealTrash: () =>
    api()?.appPaths().then((p) => p.trash && api()?.revealPath(p.trash)),
};

/* ---------------------------------------------------------------------------
   Selectors
   --------------------------------------------------------------------------- */

export type {
  AddonInfo,
  AgentRun,
  Entity,
  MorningBrief,
  Nudge,
  ObservedEvent,
  AgentTask,
  NarrationLine,
  BrainEntity,
  BrainEpisode,
  BrainPattern,
  BrainStats,
  ContextPack,
  Routine,
  RoutineProposal,
};
