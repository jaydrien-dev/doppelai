/**
 * License gating.
 *
 * Controls which features are available on each plan. The gate is checked
 * before the action runs — if the plan doesn't include it, the action
 * returns { ok: false, reason: "upgrade_required", ... } and the UI shows
 * an upgrade prompt.
 *
 * Free  — core experience: watching, memory, basic Q&A, 1 agent connector
 * Pro   — everything: unlimited agents, workflows, MCP, export/import,
 *         user profile, voice commands, nudges, guide walkthroughs
 */

const db = require("./db");

/* ------------------------------------------------------------------ gates */

/**
 * Features and which plans unlock them.
 * "free" means available on all plans.
 */
const FEATURES = {
  /* Core — always available */
  "vision:look":        "free",
  "brain:ask":          "free",
  "brain:ask-fast":     "free",
  "brain:consolidate":  "free",
  "brain:recall":       "free",
  "brain:morningBrief": "free",
  "whisper:transcribe": "free",
  "whisper:ask":        "free",

  /* Pro — paid features */
  "brain:export":       "pro",
  "brain:import":       "pro",
  "brain:ingest":       "pro",
  "profile:generate":   "pro",
  "profile:get":        "pro",
  "workflow:create":    "pro",
  "workflow:list":      "free",   // can see workflows, can't create on free
  "nudge:evaluate":     "pro",
  "guide:walkthrough":  "pro",
  "computer:create":    "free",
  "mcp:serve":          "pro",

  /* Agent limits — free gets 1 connector, pro gets unlimited */
  "agent:connect":      "free",   // checked separately with count limit
};

/** Max agent connectors per plan. */
const AGENT_LIMITS = {
  free: 1,
  paygo: 3,
  pro: Infinity,
};

/* ------------------------------------------------------------------ check */

function currentPlan() {
  const s = db.get();
  return s?.billing?.plan ?? "free";
}

/**
 * Check whether a feature is available on the current plan.
 * Returns { allowed: true } or { allowed: false, reason, requiredPlan, feature }.
 */
function check(feature) {
  const plan = currentPlan();
  const required = FEATURES[feature];

  /* Unknown feature — allow by default (don't block unregistered actions) */
  if (!required) return { allowed: true };

  /* Free features are always available */
  if (required === "free") return { allowed: true };

  /* Pro features need pro or paygo plan */
  if (required === "pro" && (plan === "pro" || plan === "paygo")) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "upgrade_required",
    feature,
    requiredPlan: required,
    currentPlan: plan,
  };
}

/**
 * Check whether the user can connect another agent.
 */
function canConnectAgent(currentCount) {
  const plan = currentPlan();
  const limit = AGENT_LIMITS[plan] ?? AGENT_LIMITS.free;
  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: "agent_limit",
      limit,
      current: currentCount,
      currentPlan: plan,
    };
  }
  return { allowed: true };
}

/**
 * Get a summary of all features and their availability on the current plan.
 * Used by the UI to show what's locked/unlocked.
 */
function featureSummary() {
  const plan = currentPlan();
  const summary = {};
  for (const [feature, required] of Object.entries(FEATURES)) {
    const unlocked = required === "free" || plan === "pro" || plan === "paygo";
    summary[feature] = { unlocked, requiredPlan: required };
  }
  summary._agentLimit = AGENT_LIMITS[plan] ?? AGENT_LIMITS.free;
  summary._plan = plan;
  return summary;
}

module.exports = {
  FEATURES,
  AGENT_LIMITS,
  check,
  canConnectAgent,
  featureSummary,
};
