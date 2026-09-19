/**
 * Token economy.
 *
 * Every AI-powered action in Doppel costs tokens. The plan determines how
 * tokens are replenished:
 *
 *   free    — 50 tokens/day, resets at midnight local time
 *   pro     — unlimited (no gate)
 *   paygo   — buy packs, balance decrements, never resets
 *
 * Token balance is tracked locally for speed (no round-trip to the server on
 * every action) and synced to the identity server periodically so the account
 * page can show usage across devices.
 *
 * The gate is a simple check: "can the user afford this action?" If not, the
 * action is blocked and the UI is told to show an upgrade prompt.
 */

const db = require("./db");

/* ------------------------------------------------------------------ costs */

/** How many tokens each action type costs. */
const COST = {
  "vision:look":       1,
  "brain:ask":         2,
  "brain:ask-fast":    1,
  "brain:consolidate": 1,
  "brain:ingest":      3,
  "brain:morningBrief":2,
  "whisper:ask":       2,
  "whisper:transcribe":1,
  "nudge:evaluate":    1,
};

/* ------------------------------------------------------------------ plans */

const PLANS = {
  free: {
    name: "Free",
    dailyTokens: 50,
    price: 0,
  },
  pro: {
    name: "Pro",
    dailyTokens: Infinity,
    price: 2000, // cents — $20/mo
  },
  paygo: {
    name: "Pay-as-you-go",
    dailyTokens: 0, // uses purchased balance only
    price: 0, // per-token
  },
};

const TOKEN_PACKS = [
  { id: "pack_100",  tokens: 100,  price: 100,  stripePriceId: "price_1UFw8UGPQDGH6ygY5meqjAWI" },
  { id: "pack_500",  tokens: 500,  price: 500,  stripePriceId: "price_1UFw8jGPQDGH6ygYdATY7wPt" },
  { id: "pack_2000", tokens: 2000, price: 1500, stripePriceId: "price_1UFw95GPQDGH6ygY9KYQvKa7" },
  { id: "pack_5000", tokens: 5000, price: 3000, stripePriceId: "price_1UFw9sGPQDGH6ygYyP3C7abz" },
];

const STRIPE_PRO_PRICE_ID = "price_1UFwALGPQDGH6ygYesHAfUCL";

/* ------------------------------------------------------------------ state */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Ensure the billing state exists and is for today. */
function ensureBilling() {
  const s = db.get();
  if (!s.billing) {
    s.billing = {
      plan: "free",
      tokenBalance: 0,       // purchased tokens (paygo)
      dailyUsed: 0,           // tokens used today (free plan)
      dailyDate: todayKey(),   // which day dailyUsed is for
      totalSpent: 0,           // all-time tokens consumed
      history: [],             // recent transactions [{date, action, cost, balance}]
    };
    db.flush();
  }

  // Reset daily counters if it's a new day
  if (s.billing.dailyDate !== todayKey()) {
    s.billing.dailyUsed = 0;
    s.billing.dailyDate = todayKey();
    db.flush();
  }

  return s.billing;
}

/* ------------------------------------------------------------------ gate */

/**
 * Check whether the user can afford an action. Returns { allowed, reason }.
 * Does NOT deduct — call `spend()` after the action succeeds.
 */
function canAfford(action) {
  const billing = ensureBilling();
  const plan = PLANS[billing.plan] ?? PLANS.free;
  const cost = COST[action] ?? 0;

  // Pro plan: always allowed
  if (billing.plan === "pro") return { allowed: true, cost };

  // Pay-as-you-go: check purchased balance
  if (billing.plan === "paygo") {
    if (billing.tokenBalance < cost) {
      return { allowed: false, cost, reason: "no_tokens", balance: billing.tokenBalance };
    }
    return { allowed: true, cost };
  }

  // Free plan: check daily allowance
  const remaining = plan.dailyTokens - billing.dailyUsed;
  if (remaining < cost) {
    return {
      allowed: false,
      cost,
      reason: "daily_limit",
      used: billing.dailyUsed,
      limit: plan.dailyTokens,
      remaining: Math.max(0, remaining),
    };
  }

  return { allowed: true, cost };
}

/**
 * Deduct tokens for a completed action. Call after the action succeeds.
 */
function spend(action) {
  const billing = ensureBilling();
  const cost = COST[action] ?? 0;
  if (cost === 0) return;

  // Pro plan: track but don't limit
  if (billing.plan === "pro") {
    billing.totalSpent += cost;
    trackHistory(action, cost);
    return;
  }

  if (billing.plan === "paygo") {
    billing.tokenBalance = Math.max(0, billing.tokenBalance - cost);
  }

  billing.dailyUsed += cost;
  billing.totalSpent += cost;

  trackHistory(action, cost);
  db.flush();
}

function trackHistory(action, cost) {
  const billing = db.get().billing;
  billing.history.unshift({
    date: Date.now(),
    action,
    cost,
    balance: billing.plan === "paygo" ? billing.tokenBalance : undefined,
  });
  // Keep last 200 entries
  if (billing.history.length > 200) billing.history.length = 200;
}

/* --------------------------------------------------------------- mutations */

function setPlan(plan) {
  if (!PLANS[plan]) return { ok: false, reason: "unknown_plan" };
  const billing = ensureBilling();
  billing.plan = plan;
  db.flush();
  db.notify();
  return { ok: true, plan };
}

function addTokens(amount) {
  const billing = ensureBilling();
  billing.tokenBalance += Math.max(0, Math.round(amount));
  db.flush();
  db.notify();
  return { ok: true, balance: billing.tokenBalance };
}

/* ------------------------------------------------------------------ reads */

function status() {
  const billing = ensureBilling();
  const plan = PLANS[billing.plan] ?? PLANS.free;

  const result = {
    plan: billing.plan,
    planName: plan.name,
    price: plan.price,
    tokenBalance: billing.tokenBalance,
    dailyUsed: billing.dailyUsed,
    dailyLimit: plan.dailyTokens === Infinity ? null : plan.dailyTokens,
    dailyRemaining: plan.dailyTokens === Infinity ? null : Math.max(0, plan.dailyTokens - billing.dailyUsed),
    totalSpent: billing.totalSpent,
  };

  return result;
}

function getHistory(limit = 50) {
  const billing = ensureBilling();
  return (billing.history ?? []).slice(0, limit);
}

function getCosts() {
  return { ...COST };
}

function getPlans() {
  return Object.entries(PLANS).map(([id, p]) => ({
    id,
    name: p.name,
    dailyTokens: p.dailyTokens === Infinity ? null : p.dailyTokens,
    price: p.price,
  }));
}

function getTokenPacks() {
  return TOKEN_PACKS;
}

module.exports = {
  COST,
  PLANS,
  TOKEN_PACKS,
  canAfford,
  spend,
  setPlan,
  addTokens,
  status,
  getHistory,
  getCosts,
  getPlans,
  getTokenPacks,
};
