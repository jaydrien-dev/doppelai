/* ===========================================================================
   Doppel — the shapes the main process actually produces.
   =========================================================================== */

/** The glyph shown beside a step. Derived from the app or the file type. */
export type AppId =
  | "sheet"
  | "mail"
  | "files"
  | "browser"
  | "doc"
  | "calendar"
  | "chat"
  | "pdf";

/* --------------------------------------------------------------------------
   Observation
   -------------------------------------------------------------------------- */

export interface ObservedEvent {
  id: string;
  at: number;
  kind:
    | "window.focus"
    | "file.created"
    | "file.changed"
    | "file.moved"
    | "file.removed"
    | "clip.copy";
  app?: string;
  title?: string;
  path?: string;
  from?: string;
  dir?: string;
  name?: string;
  ext?: string;
  shape?: string;
  length?: number;
}

export interface Permissions {
  /* what it may watch */
  windows: boolean;
  files: boolean;
  clipboard: boolean;
  /** Read the screen with a vision model — how it understands the work itself. */
  screen: boolean;

  /* what it may do */
  actFiles: boolean;
  actWrite: boolean;
  actTrash: boolean;
  actLaunch: boolean;
  /** Drive any application. This is what makes it able to do anything you can. */
  actGui: boolean;
}

/** What the interface is allowed to know about the key. Never the key itself. */
export interface AiState {
  configured: boolean;
  fromEnvironment: boolean;
  verified: boolean;
  lastError: string | null;
  autoWatch: boolean;
  /** How closely it reads a screen — every word, or just the gist. */
  detail: "light" | "thorough";
  hint: string;
  /** OpenAI Whisper transcription. */
  openaiConfigured: boolean;
  openaiHint: string;
}

/* --------------------------------------------------------------------------
   Identity — the account holds who you are and which machines are yours.
   The trained agent is never here; it lives on the machines themselves.
   -------------------------------------------------------------------------- */

/** What the interface may know locally. Never the session token itself. */
export interface AccountState {
  signedIn: boolean;
  email: string | null;
  accountId: string | null;
  deviceId: string | null;
  deviceName: string;
  pairedAt: number | null;
  pendingEmail: string | null;
  lastError: string | null;
  server: string;
}

export interface PairedMachine {
  id: string;
  name: string;
  kind: "desk" | "phone" | "other";
  platform: string;
  pairedAt: number;
  lastSeenAt: number;
  current: boolean;
}

export interface AccountOverview {
  ok: boolean;
  account: { id: string; email: string; createdAt: number; hasPassword: boolean };
  devices: PairedMachine[];
  sessions: number;
  currentDeviceId: string;
}

/** The little presence in the corner of the screen. */
export interface OverlayState {
  enabled: boolean;
  position: { x: number; y: number } | null;
}

/** The voice hotkey panel. */
export interface WhisperState {
  enabled: boolean;
  hotkey: string;
  position: { x: number; y: number } | null;
  autoDismiss: number;
  micSensitivity: number;
}

/** One exact thing read off the screen — a quote or a figure. */
export interface Fragment {
  kind: "text" | "figure";
  what: string;
  value: string;
}

/** One thing Doppel said about what it saw. */
export interface NarrationLine {
  id: string;
  at: number;
  app: string | null;
  text: string;
  intent: string;
  /** When the same intent moves to a different place, Doppel says so. */
  adaptation: string | null;
  salience: number;
  sensitive: boolean;
  reason: string;
  /** True when this is a "welcome back" context recovery line. */
  recovery?: boolean;
}

/* --------------------------------------------------------------------------
   The brain
   -------------------------------------------------------------------------- */

export interface BrainEntity {
  id: string;
  kind: "person" | "client" | "project" | "app" | "file" | "account" | "thing";
  name: string;
  note: string;
  firstSeen: number;
  lastSeen: number;
  seenCount: number;
  line?: string;
}

export interface BrainEpisode {
  id: string;
  at: number;
  kind: string;
  app: string | null;
  window: string | null;
  activity: string;
  intent: string;
  detail: string;
  location: string;
  changed: string;
  /** The exact words and numbers read off the screen at that moment. */
  fragments: Fragment[];
  salience: number;
  sensitive: boolean;
  boundary: "start" | "middle" | "end" | "none";
  line?: string;
}

export interface BrainDigest {
  label: string;
  scope: "hour" | "day";
  at: number;
  summary: string;
  themes: string[];
  openThreads: string[];
  episodeCount: number;
}

export interface BrainStats {
  episodes: number;
  entities: number;
  digests: number;
  indexedTerms: number;
  oldest: number | null;
  vectors: {
    count: number;
    dims: number;
    /** Size on disk of the quantised vectors, in bytes. */
    bytes: number;
    available: boolean;
    unavailable: string | null;
  };
}

export interface ContextPack {
  entities: BrainEntity[];
  digests: BrainDigest[];
  episodes: BrainEpisode[];
  tokens: number;
}

/* --------------------------------------------------------------------------
   Brain patterns — detected repeated behaviors
   -------------------------------------------------------------------------- */

export interface BrainPattern {
  id: string;
  app: string;
  label: string;
  intent: string | null;
  count: number;
  lastSeen: number;
  firstSeen: number;
  instruction: string;
  episodeIds: string[];
}

export interface Entity {
  id: string;
  kind: "person" | "client" | "project" | "account" | "thing";
  name: string;
  note: string;
  learnedAt: number;
}

/* --------------------------------------------------------------------------
   Nudges — proactive suggestions from Doppel
   -------------------------------------------------------------------------- */

export type NudgeKind = "memory" | "stuck" | "task-end" | "open-thread" | "offer";

export interface Nudge {
  id: string;
  at: number;
  kind: NudgeKind;
  /** What Doppel says, in its own voice. */
  text: string;
  /** Button label, or null if the nudge is purely informational. */
  action: string | null;
  /** Extra context shown smaller beneath the text. */
  detail: string | null;
  /** Which observation triggered this nudge. */
  episodeId: string;
}

/* --------------------------------------------------------------------------
   Morning Brief — proactive daily digest
   -------------------------------------------------------------------------- */

export interface SecurityState {
  biometric: boolean;
  lockTimeout: number;
}

export interface MorningBrief {
  date: string;               // "YYYY-MM-DD"
  greeting: string;
  yesterday: string;
  patterns: string[];
  connections: string[];
  openThreads: string[];
  suggestion: string;
  generatedAt: number;
}

/* --------------------------------------------------------------------------
   Add-ons
   -------------------------------------------------------------------------- */

export interface AddonConfigField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  secret?: boolean;
  required?: boolean;
}

export interface AddonInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon: string;
  category: string;
  type: "api" | "mcp" | "custom";
  builtin: boolean;
  permissions: string[];
  config: AddonConfigField[];
  tools: { name: string; description: string }[];
  installed: boolean;
  enabled: boolean;
  userConfig: Record<string, string>;
  needsAuth: boolean;
  connected: boolean;
}

/** The whole of what the main process reports. */
export interface DoppelSnapshot {
  version: number;
  createdAt: number;
  observation: { paused: boolean; roots: string[]; displayId: string | null };
  permissions: Permissions;
  ai: AiState;
  overlay: OverlayState;
  whisper: WhisperState;
  account: AccountState;
  entities: Entity[];
  devices: unknown[];
  stats: {
    eventsSeen: number;
    sessionsSeen: number;
    looks: number;
    visionTokens: number;
  };
  addons: { installed: Record<string, { enabled: boolean; config: Record<string, string> }> };
  security: SecurityState;
  usage: {
    current: { month: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheCreate: number; calls: number };
    months: Record<string, { month: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheCreate: number; calls: number }>;
  };
  billing: {
    plan: string;
    tokenBalance: number;
    dailyUsed: number;
    dailyDate: string;
    totalSpent: number;
  };
  narration: NarrationLine[];
  recentEvents: ObservedEvent[];
  nudges: Nudge[];
  nudgeSettings: { enabled: boolean };
  guide: GuideWalkthrough;
  inbox: InboxTask[];
}

/* --------------------------------------------------------------------------
   Billing — token economy
   -------------------------------------------------------------------------- */

export interface BillingStatus {
  plan: string;
  planName: string;
  price: number;
  tokenBalance: number;
  dailyUsed: number;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  totalSpent: number;
}

export interface PlanInfo {
  id: string;
  name: string;
  dailyTokens: number | null;
  price: number;
}

export interface TokenEvent {
  date: number;
  action: string;
  cost: number;
  balance?: number;
}

export interface TokenPack {
  id: string;
  tokens: number;
  price: number;
  stripePriceId: string;
}

/* --------------------------------------------------------------------------
   Inbox — task queue between user and external AI agents
   -------------------------------------------------------------------------- */

export type InboxStatus = "pending" | "approved" | "claimed" | "done" | "failed" | "rejected";

export interface InboxTask {
  id: string;
  createdAt: number;
  status: InboxStatus;
  instruction: string;
  /** Who created this task. */
  source: "user" | "nudge" | "system";
  /** Which agent this task is directed to, or "any". */
  target: string;
  /** Which external agent claimed it (e.g. "Claude Desktop", "Cursor"). */
  agent: string | null;
  claimedAt: number | null;
  /** The agent's response when done. */
  result: string | null;
  completedAt: number | null;
}

/* --------------------------------------------------------------------------
   Guide — Clicky-style walkthrough pointer overlay
   -------------------------------------------------------------------------- */

export interface GuidePoint {
  x: number;
  y: number;
  instruction: string;
  step: number | null;
  total: number | null;
  action: string | null;
}

export interface GuideWalkthrough {
  active: boolean;
  goal?: string;
  step?: number;
  total?: number;
  instruction?: string;
  reason?: string;
}
