"use client";

import { create } from "zustand";
import type {
  AccountOverview,
  AccountState,
  AddonInfo,
  BrainEntity,
  BrainEpisode,
  BrainPattern,
  BrainStats,
  ContextPack,
  Entity,
  DoppelSnapshot,
  InboxTask,
  MorningBrief,
  NarrationLine,
  Nudge,
  ObservedEvent,
  Permissions,
  SecurityState,
  WhisperState,
  BillingStatus,
  PlanInfo,
  TokenEvent,
  TokenPack,
  UserProfile,
  Workflow,
  Bot,
  BotDetail,
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
  overlayToggleWhisper: () => Promise<boolean>;
  overlayShowTasks: () => Promise<boolean>;
  overlaySetEnabled: (on: boolean) => Promise<unknown>;
  overlaySetBarHeight: (h: number) => Promise<unknown>;
  overlayHome: () => Promise<unknown>;
  onOverlayMode: (fn: (mode: string) => void) => () => void;

  /* task popup */
  taskPopupEmpty: () => Promise<unknown>;

  /* the whisper panel */
  whisperSetEnabled: (on: boolean) => Promise<unknown>;
  whisperHome: () => Promise<unknown>;
  whisperSetAutoDismiss: (sec: number) => Promise<unknown>;
  whisperHide: () => Promise<unknown>;
  whisperSetMicSensitivity: (level: number) => Promise<unknown>;
  whisperSaveChat: (question: string, answer: string) => Promise<unknown>;
  whisperChatHistory: () => Promise<{ q: string; a: string; at: number }[]>;

  /* the account */
  requestLink: (email: string) => Promise<{ ok: boolean; error?: string; link?: string }>;
  verifyLink: (token: string) => Promise<{ ok: boolean; error?: string }>;
  register: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  resetPassword: (
    token: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
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
  onNarration: (fn: (line: NarrationLine) => void) => () => void;
  onNudge: (fn: (nudges: Nudge[]) => void) => () => void;
  onAnswerStream: (fn: (delta: string) => void) => () => void;
  onThinkingStream: (fn: (delta: string) => void) => () => void;
  getNudges: () => Promise<Nudge[]>;
  dismissNudge: (id: string) => Promise<unknown>;
  actOnNudge: (id: string) => Promise<{ ok: boolean; nudge?: Nudge }>;
  nudgeSetEnabled: (on: boolean) => Promise<unknown>;

  /* inbox */
  inboxList: () => Promise<InboxTask[]>;
  inboxCreate: (instruction: string, autoApprove?: boolean, target?: string) => Promise<InboxTask | null>;
  inboxApprove: (id: string) => Promise<{ ok: boolean }>;
  inboxReject: (id: string) => Promise<{ ok: boolean }>;
  inboxRetry: (id: string) => Promise<{ ok: boolean }>;
  inboxClear: () => Promise<{ ok: boolean }>;

  /* workflows */
  workflowList: () => Promise<Workflow[]>;
  workflowCreate: (title: string, steps: { instruction: string; target: string }[], onFailure?: string) => Promise<Workflow>;
  workflowAbort: (id: string) => Promise<{ ok: boolean }>;

  /* guide — Clicky-style walkthroughs */
  guideFindElement: (description: string) => Promise<{ ok: boolean; screenX?: number; screenY?: number; label?: string }>;
  guidePointAt: (x: number, y: number, instruction: string) => Promise<unknown>;
  guideClearPointer: () => Promise<unknown>;
  guideStartWalkthrough: (goal: string) => Promise<{ ok: boolean; steps?: number; firstStep?: string }>;
  guideNextStep: () => Promise<{ ok: boolean; done?: boolean; step?: number; instruction?: string }>;
  guidePrevStep: () => Promise<{ ok: boolean; step?: number }>;
  guideEndWalkthrough: () => Promise<{ ok: boolean }>;
  guideDoStep: () => Promise<{ ok: boolean; action?: string; x?: number; y?: number }>;
  guideGetState: () => Promise<{ active: boolean; goal?: string; step?: number; total?: number; instruction?: string }>;
  onGuidePoint: (fn: (data: unknown) => void) => () => void;
  onGuideClear: (fn: (data: unknown) => void) => () => void;
  onGuideWalkthrough: (fn: (data: unknown) => void) => () => void;
  onGuideInstruction: (fn: (data: unknown) => void) => () => void;

  /* security / biometric */
  securityAvailable: () => Promise<{ available: boolean; detail?: string }>;
  securityStatus: () => Promise<{ available: boolean; enabled: boolean; locked: boolean; lockTimeout: number }>;
  securityVerify: () => Promise<{ ok: boolean; method?: string; detail?: string }>;
  securitySetBiometric: (on: boolean) => Promise<{ ok: boolean; detail?: string }>;
  securitySetLockTimeout: (min: number) => Promise<unknown>;
  securityLock: () => Promise<unknown>;
  onUnlocked: (fn: (unlocked: boolean) => void) => () => void;

  /* computer bots */
  computerCreate: (goal: string) => Promise<{ ok: boolean; bot?: Bot; error?: string }>;
  computerRespond: (id: string, answer: string) => Promise<{ ok: boolean; error?: string }>;
  computerStop: (id: string) => Promise<{ ok: boolean; error?: string }>;
  computerList: () => Promise<Bot[]>;
  computerStatus: (id: string) => Promise<BotDetail | null>;
  computerClear: (id: string) => Promise<boolean>;
  computerConfigured: () => Promise<{ configured: boolean; geminiKey: boolean }>;
  onBotUpdate: (fn: (bot: Bot) => void) => () => void;

  /* license gates */
  gatesFeatures: () => Promise<Record<string, { unlocked: boolean; requiredPlan: string }>>;

  /* billing */
  billingStatus: () => Promise<BillingStatus>;
  billingPlans: () => Promise<PlanInfo[]>;
  billingCosts: () => Promise<Record<string, number>>;
  billingHistory: (limit?: number) => Promise<TokenEvent[]>;
  billingTokenPacks: () => Promise<TokenPack[]>;
  billingSetPlan: (plan: string) => Promise<{ ok: boolean; plan?: string }>;
  billingAddTokens: (amount: number) => Promise<{ ok: boolean; balance?: number }>;
  billingCheckout: (priceId: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  billingVerifyPurchase: (sessionId: string) => Promise<{ ok: boolean; type?: string; tokens?: number }>;

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
  setTypeSafeKey: (key: string) => Promise<{ ok: boolean; detail?: string }>;
  clearTypeSafeKey: () => Promise<unknown>;
  transcribeAudio: (buffer: ArrayBuffer, prompt?: string) => Promise<{ ok: boolean; text?: string; detail?: string }>;
  whisperAsk: (buffer: ArrayBuffer, history?: { role: string; content: string }[]) => Promise<{
    ok: boolean;
    transcript?: string;
    text?: string;
    empty?: boolean;
    phase?: string;
    detail?: string;
  }>;
  classifyIntent: (text: string) => Promise<{ intent: string; goal: string | null }>;
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
  importBrain: () => Promise<{ ok: boolean; reason?: string; detail?: string; imported?: { episodes: number; entities: number; digests: number; briefs: number; vectors: number; profile: boolean }; backup?: string }>;
  wipeBrain: () => Promise<unknown>;
  userProfile: () => Promise<UserProfile | null>;
  generateProfile: () => Promise<{ ok: boolean; profile?: UserProfile; reason?: string; detail?: string }>;
  ingestDocument: (filePath?: string) => Promise<{ ok: boolean; episodes?: number; files?: string[]; title?: string; detail?: string }>;
  ingestSupported: () => Promise<string[]>;

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
  mcpSnippet: () => Promise<{ snippet: unknown; scriptPath: string; httpUrl?: string; relayUrl?: string | null }>;
  relayStatus: () => Promise<{ connected: boolean; mcpUrl: string | null }>;
  onRelay: (fn: (status: { connected: boolean; mcpUrl: string | null }) => void) => (() => void) | undefined;

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
    typesafeConfigured: false,
    typesafeHint: "",
  },
  overlay: { enabled: true, position: null },
  whisper: { enabled: true, hotkey: "Ctrl+Shift+Space", position: null, autoDismiss: 0, micSensitivity: 80 },
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
  guide: { active: false },
  inbox: [],
  workflows: [],
  bots: [],
  devices: [],
  stats: { eventsSeen: 0, sessionsSeen: 0, looks: 0, visionTokens: 0 },
  addons: { installed: {} },
  security: { biometric: false, lockTimeout: 0 },
  usage: { current: { month: "", inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, calls: 0 }, months: {} },
  billing: { plan: "free", tokenBalance: 0, dailyUsed: 0, dailyDate: "", totalSpent: 0 },
  recentEvents: [],
});

export interface DoppelState extends DoppelSnapshot {
  /** False until the first report arrives, so nothing flashes empty. */
  ready: boolean;
  /** False in a plain browser, where none of this can be real. */
  connected: boolean;
  now: number;

  updateStatus: { state: string; version?: string | null; progress?: number | null; detail?: string | null };
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
    api.getNudges().then((n) => set({ nudges: n }));
    api.getUpdateStatus().then((s) => set({ updateStatus: s }));
    api.onNudge((n) => set({ nudges: n }));
    api.onUpdate((s) => set({ updateStatus: s }));
    api.onState((s) => set((prev) => {
      const next: Record<string, unknown> = { ready: true };
      for (const k of Object.keys(s) as (keyof typeof s)[]) {
        if (prev[k] !== s[k]) next[k] = s[k];
      }
      return next;
    }));
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
  setTypeSafeKey: (key: string) =>
    api()?.setTypeSafeKey(key) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  clearTypeSafeKey: () => api()?.clearTypeSafeKey(),
  transcribeAudio: (buffer: ArrayBuffer, prompt?: string) =>
    api()?.transcribeAudio(buffer, prompt) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  whisperAsk: (buffer: ArrayBuffer, history?: { role: string; content: string }[]) =>
    api()?.whisperAsk(buffer, history) ?? Promise.resolve({ ok: false, detail: NO_BRIDGE }),
  setAutoWatch: (on: boolean) => api()?.setAutoWatch(on),
  setDetail: (level: "light" | "thorough") => api()?.setDetail(level),
  overlaySetEnabled: (on: boolean) => api()?.overlaySetEnabled(on),
  overlaySetBarHeight: (h: number) => api()?.overlaySetBarHeight(h),
  overlayHome: () => api()?.overlayHome(),
  whisperSetEnabled: (on: boolean) => api()?.whisperSetEnabled(on),
  whisperHome: () => api()?.whisperHome(),
  whisperSetAutoDismiss: (sec: number) => api()?.whisperSetAutoDismiss(sec),
  whisperSetMicSensitivity: (level: number) => api()?.whisperSetMicSensitivity(level),
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
  importBrain: () =>
    api()?.importBrain() ?? Promise.resolve({ ok: false, reason: "no-bridge" }),
  wipeBrain: () => api()?.wipeBrain(),
  userProfile: () => api()?.userProfile() ?? Promise.resolve(null),
  generateProfile: () =>
    api()?.generateProfile() ?? Promise.resolve({ ok: false, reason: "no-bridge" }),
  ingestDocument: (filePath?: string) =>
    api()?.ingestDocument(filePath) ?? Promise.resolve({ ok: false, detail: "Not connected." }),
  ingestSupported: () => api()?.ingestSupported() ?? Promise.resolve([]),

  /* the account */
  requestLink: (email: string) =>
    api()?.requestLink(email) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
  verifyLink: (token: string) =>
    api()?.verifyLink(token) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
  register: (email: string, password: string) =>
    api()?.register(email, password) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
  resetPassword: (token: string, password: string) =>
    api()?.resetPassword(token, password) ?? Promise.resolve({ ok: false, error: "no-bridge" }),
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

  /* guide — Clicky-style walkthroughs */
  guideFindElement: (description: string) =>
    api()?.guideFindElement(description) ?? Promise.resolve({ ok: false }),
  guidePointAt: (x: number, y: number, instruction: string) =>
    api()?.guidePointAt(x, y, instruction),
  guideClearPointer: () => api()?.guideClearPointer(),
  guideStartWalkthrough: (goal: string) =>
    api()?.guideStartWalkthrough(goal) ?? Promise.resolve({ ok: false }),
  guideNextStep: () =>
    api()?.guideNextStep() ?? Promise.resolve({ ok: false }),
  guidePrevStep: () =>
    api()?.guidePrevStep() ?? Promise.resolve({ ok: false }),
  guideEndWalkthrough: () =>
    api()?.guideEndWalkthrough() ?? Promise.resolve({ ok: false }),
  guideDoStep: () =>
    api()?.guideDoStep() ?? Promise.resolve({ ok: false }),
  guideGetState: () =>
    api()?.guideGetState() ?? Promise.resolve({ active: false }),

  /* nudges */
  dismissNudge: (id: string) => api()?.dismissNudge(id),
  actOnNudge: (id: string) =>
    api()?.actOnNudge(id) ?? Promise.resolve({ ok: false }),
  nudgeSetEnabled: (on: boolean) => api()?.nudgeSetEnabled(on),

  /* inbox */
  inboxList: () => api()?.inboxList() ?? Promise.resolve([]),
  inboxCreate: (instruction: string, autoApprove = true, target?: string) =>
    api()?.inboxCreate(instruction, autoApprove, target) ?? Promise.resolve(null),
  inboxApprove: (id: string) =>
    api()?.inboxApprove(id) ?? Promise.resolve({ ok: false }),
  inboxReject: (id: string) =>
    api()?.inboxReject(id) ?? Promise.resolve({ ok: false }),
  inboxRetry: (id: string) =>
    api()?.inboxRetry(id) ?? Promise.resolve({ ok: false }),
  inboxClear: () =>
    api()?.inboxClear() ?? Promise.resolve({ ok: false }),

  /* workflows */
  workflowList: () =>
    api()?.workflowList() ?? Promise.resolve([]),
  workflowCreate: (title: string, steps: { instruction: string; target: string }[], onFailure?: string) =>
    api()?.workflowCreate(title, steps, onFailure) ?? Promise.resolve({ id: "", createdAt: 0, status: "failed" as const, title, source: "user" as const, sourceAgent: null, steps: [], currentStep: 0, completedAt: null, onFailure: "abort" as const }),
  workflowAbort: (id: string) =>
    api()?.workflowAbort(id) ?? Promise.resolve({ ok: false }),

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

  /* computer bots */
  computerCreate: (goal: string) => api()?.computerCreate(goal) ?? Promise.resolve({ ok: false, error: "Not connected" }),
  computerRespond: (id: string, answer: string) => api()?.computerRespond(id, answer) ?? Promise.resolve({ ok: false }),
  computerStop: (id: string) => api()?.computerStop(id) ?? Promise.resolve({ ok: false }),
  computerList: () => api()?.computerList() ?? Promise.resolve([]),
  computerStatus: (id: string) => api()?.computerStatus(id) ?? Promise.resolve(null),
  computerClear: (id: string) => api()?.computerClear(id) ?? Promise.resolve(false),
  computerConfigured: () => api()?.computerConfigured() ?? Promise.resolve({ configured: false, geminiKey: false }),
  onBotUpdate: (fn: (bot: Bot) => void) => api()?.onBotUpdate(fn) ?? (() => {}),

  /* license gates */
  gatesFeatures: () => api()?.gatesFeatures() ?? Promise.resolve({}),

  /* billing */
  billingStatus: () => api()?.billingStatus() ?? Promise.resolve({
    plan: "free", planName: "Free", price: 0, tokenBalance: 0,
    dailyUsed: 0, dailyLimit: 50, dailyRemaining: 50,
    totalSpent: 0,
  }),
  billingPlans: () => api()?.billingPlans() ?? Promise.resolve([]),
  billingCosts: () => api()?.billingCosts() ?? Promise.resolve({}),
  billingHistory: (limit?: number) => api()?.billingHistory(limit) ?? Promise.resolve([]),
  billingTokenPacks: () => api()?.billingTokenPacks() ?? Promise.resolve([]),
  billingSetPlan: (plan: string) => api()?.billingSetPlan(plan) ?? Promise.resolve({ ok: false }),
  billingAddTokens: (amount: number) => api()?.billingAddTokens(amount) ?? Promise.resolve({ ok: false }),
  billingCheckout: (priceId: string) => api()?.billingCheckout(priceId) ?? Promise.resolve({ ok: false, error: "not_connected" }),
  billingVerifyPurchase: (sessionId: string) => api()?.billingVerifyPurchase(sessionId) ?? Promise.resolve({ ok: false }),

  /* updates */
  getUpdateStatus: () => api()?.getUpdateStatus() ?? Promise.resolve({ state: "idle" }),
  checkForUpdate: () => api()?.checkForUpdate(),
  installUpdate: () => api()?.installUpdate(),

  /* MCP */
  mcpSnippet: () =>
    api()?.mcpSnippet() ?? Promise.resolve({ snippet: {}, scriptPath: "" }),
  relayStatus: () =>
    api()?.relayStatus() ?? Promise.resolve({ connected: false, mcpUrl: null }),
  onRelay: (fn: (s: { connected: boolean; mcpUrl: string | null }) => void) =>
    api()?.onRelay(fn),

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
  Bot,
  BotDetail,
  Entity,
  InboxTask,
  MorningBrief,
  Nudge,
  ObservedEvent,
  NarrationLine,
  BrainEntity,
  BrainEpisode,
  BrainPattern,
  BrainStats,
  ContextPack,
  Workflow,
};
