/* ===========================================================================
   Mimic — the shapes the main process actually produces.

   Nothing here is invented for the interface. Routines are mined from real
   observations, steps carry real actions, and runs record what really changed.
   =========================================================================== */

export type Stage = "learning" | "ready" | "supervised" | "trusted" | "unattended";

export const STAGE_ORDER: Stage[] = [
  "learning",
  "ready",
  "supervised",
  "trusted",
  "unattended",
];

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

export type Certainty = "sure" | "guessing";

/** Everything Mimic can genuinely carry out. */
export type ActionKind =
  | "move"
  | "rename"
  | "copy"
  | "trash"
  | "zip"
  | "mkdir"
  | "open"
  | "await-file"
  | "activate"
  | "click"
  | "type"
  | "hotkey"
  | "wait"
  | "none";

export interface StepAction {
  kind: ActionKind;
  dir?: string;
  from?: string;
  to?: string;
  file?: string;
  match?: string;
  example?: string;
  text?: string;
  keys?: string;
  x?: number;
  y?: number;
  ms?: number;
  app?: string;
}

/** Reasons Mimic stops and asks, whatever it has been trusted with. */
export type HardRuleKind = "delete" | "irreversible" | "outside" | "gui" | "files" | "unknown";

export const HARD_RULE_LABEL: Record<HardRuleKind, string> = {
  delete: "clears something away",
  irreversible: "cannot be undone",
  outside: "is outside the folders you allow",
  gui: "drives another application",
  files: "changes files",
  unknown: "is something I don't understand",
};

export interface StepParam {
  label: string;
  value: string;
  options: string[];
}

export interface RoutineStep {
  id: string;
  /** The signature fragment that makes two sessions the same piece of work. */
  key: string;
  label: string;
  detail: string;
  app: AppId;
  certainty: Certainty;
  duration: number;
  action: StepAction;
  hardRule?: HardRuleKind;
  param?: StepParam;
}

export interface ObservedPath {
  id: string;
  label: string;
  seenCount: number;
  lastSeen: number;
  stepIds: string[];
}

export interface Lesson {
  id: string;
  stepId: string;
  stepLabel: string;
  lesson: string;
  at: number;
  runIndex: number;
  kind: "correction" | "answer" | "rule";
}

export type RunOutcome = "clean" | "corrected" | "stopped" | "autonomous";

export interface Reasoning {
  saw: string;
  inferred: string;
  applied?: string;
}

export interface RunRecord {
  id: string;
  routineId: string;
  routineTitle: string;
  at: number;
  durationSec: number;
  corrections: number;
  outcome: RunOutcome;
  note: string;
  minutesSaved: number;
  supervised: boolean;
  unattended: boolean;
  reasoning: Reasoning;
  steps: { label: string; state: StepState }[];
  /** What genuinely changed on disk. */
  changes: string[];
  reversible: boolean;
  rolledBack: boolean;
  rollbackNote?: string;
  recording: boolean;
}

export interface Routine {
  id: string;
  /** The identity of this piece of work, order ignored. */
  shape: string;
  title: string;
  intent: string;
  successCriteria: string[];
  source: string;
  hunch: string;
  unsure?: string;

  stage: Stage;
  confidence: number;
  observations: number;

  stepLibrary: RoutineStep[];
  observedPaths: ObservedPath[];

  lessons: Lesson[];
  confidenceHistory: { at: number; value: number }[];

  provingRunsRequired: number;
  provingRunsPassed: number;
  presentRunsRequired: number;
  presentRunsPassed: number;

  lastRunAt?: number;
  minutesPerRun: number;
  discoveredAt: number;

  order: string[];
  skipped: string[];
  overrides?: Record<string, { match?: string; pattern?: string }>;

  recentOutcomes: RunOutcome[];
  drifting: boolean;
  relearning: boolean;

  quarantined: boolean;
  sharedFrom?: string;
  taughtDirectly: boolean;
  taughtWeight: number;
}

export type StepState =
  | "pending"
  | "active"
  | "done"
  | "skipped"
  | "corrected"
  | "parked"
  | "unreached";

export type RunStatus =
  | "running"
  | "paused"
  | "correcting"
  | "parked"
  | "yielded"
  | "stopped"
  | "finished";

export interface RunSummary {
  outcome: RunOutcome;
  note: string;
  durationSec: number;
  corrections: number;
  minutesSaved: number;
  changes: string[];
  completed: string[];
  notCompleted: string[];
  runId: string;
  earned?: boolean;
}

export interface ActiveRun {
  id: string;
  routineId: string;
  routineTitle: string;
  runIndex: number;
  stepIndex: number;
  status: RunStatus;
  stepStates: Record<string, StepState>;
  /** What each finished step actually did, in its own words. */
  stepDetails: Record<string, string>;
  order: string[];
  skipped: string[];
  correctionsThisRun: Lesson[];
  startedAt: number;
  elapsedSec: number;
  changes: string[];
  irreversible: boolean;
  parkedReason: string | null;
  parkedRule: HardRuleKind | null;
  supervised: boolean;
  unattended: boolean;
  dispatchedFrom: "desk" | "pocket";
  summary: RunSummary | null;
}

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

/** One exact thing read off the screen — a quote or a figure. */
export interface Fragment {
  kind: "text" | "figure";
  what: string;
  value: string;
}

/** One thing Mimic said about what it saw. */
export interface NarrationLine {
  id: string;
  at: number;
  app: string | null;
  text: string;
  intent: string;
  salience: number;
  sensitive: boolean;
  reason: string;
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
   The agent
   -------------------------------------------------------------------------- */

export type AgentStatus = "running" | "parked" | "stopping" | "finished" | "stopped";

export interface AgentTask {
  id: string;
  routineId: string | null;
  title: string;
  instruction: string;
  status: AgentStatus;
  step: number;
  startedAt: number;
  narration: { at: number; text: string }[];
  changes: string[];
  irreversible: boolean;
  recalled: number;
  parked: {
    rule: HardRuleKind;
    detail: string;
    action: Record<string, unknown>;
    at: number;
  } | null;
  summary: {
    outcome: "done" | "stopped";
    text: string;
    changed: string[];
    incomplete: string[];
    durationSec: number;
    steps: number;
  } | null;
}

export interface Entity {
  id: string;
  kind: "person" | "client" | "project" | "account" | "thing";
  name: string;
  note: string;
  learnedAt: number;
}

export interface AwayAuthorization {
  active: boolean;
  grantedAt: number;
  expiresAt: number;
  routineIds: string[];
  actionCap: number;
  actionsUsed: number;
  keepAlive: boolean;
}

export type JobState = "queued" | "running" | "needs-you" | "held" | "done" | "stopped";

export interface PocketJob {
  id: string;
  routineId: string;
  routineTitle: string;
  state: JobState;
  dispatchedAt: number;
  startedAt?: number;
  finishedAt?: number;
  stepLabel?: string;
  stepIndex: number;
  stepCount: number;
  question?: { prompt: string; rule?: HardRuleKind } | null;
  runId?: string;
  heldReason?: string;
}

/** The whole of what the main process reports. */
export interface MimicSnapshot {
  version: number;
  createdAt: number;
  observation: { paused: boolean; roots: string[] };
  permissions: Permissions;
  ai: AiState;
  overlay: OverlayState;
  account: AccountState;
  routines: Routine[];
  runs: RunRecord[];
  entities: Entity[];
  jobs: PocketJob[];
  away: AwayAuthorization;
  devices: unknown[];
  stats: {
    eventsSeen: number;
    sessionsSeen: number;
    looks: number;
    visionTokens: number;
  };
  narration: NarrationLine[];
  recentEvents: ObservedEvent[];
}
