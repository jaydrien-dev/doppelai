const Anthropic = require("@anthropic-ai/sdk");

const db = require("./db");

/**
 * Doppel's mind.
 *
 * Every call to Claude goes through here so there is exactly one place that
 * knows the model, the thinking configuration, and how the cache is laid out.
 *
 * Three things are deliberate:
 *
 *   - Sonnet 4.5 thinks by default. We never send `budget_tokens`, `temperature`,
 *     `top_p` or `top_k` — all four are rejected on this model. Depth is
 *     controlled with `effort`, chosen per job below.
 *   - The system prompt is a frozen prefix with a cache breakpoint on it, so
 *     the expensive part is written once and read back at a tenth of the price
 *     on every subsequent observation.
 *   - A refusal is a normal outcome, not an exception. We check `stop_reason`
 *     before ever touching `content`, and opt into server-side fallbacks so a
 *     declined request is answered rather than dropped.
 */

const MODEL = "claude-sonnet-4-5";
const FAST_MODEL = "claude-haiku-4-5";

/** Depth per job. Watching is cheap and constant; acting is not. */
const EFFORT = {
  glance: "low", // is anything worth noticing on screen
  observe: "medium", // describe what the user is doing
  consolidate: "medium", // fold observations into the brain
  plan: "high", // work out how to do a task
  act: "xhigh", // drive the machine (coding/agentic — the documented default)
};

/** Fallbacks are opt-in; a refused request otherwise just stops. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client = null;
let clientKey = null;

/* --------------------------------------------------------------------------- */

function apiKey() {
  /* db.apiKey() returns the decrypted key — never read state.ai.apiKey directly. */
  const fromState = db.apiKey();
  return (fromState || process.env.ANTHROPIC_API_KEY || "").trim();
}

const configured = () => Boolean(apiKey());

/** One client per key, rebuilt when the user pastes a new one. */
function anthropic() {
  const key = apiKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

/**
 * A refusal arrives as a successful response with an empty or partial body.
 * Reading `content[0]` without checking this is the classic way to crash on it.
 */
function refused(response) {
  return response?.stop_reason === "refusal";
}

function textOf(response) {
  return (response?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** The reasoning summary, when we asked for one. Never the raw chain of thought. */
function thinkingOf(response) {
  return (response?.content ?? [])
    .filter((b) => b.type === "thinking" && b.thinking)
    .map((b) => b.thinking)
    .join("\n")
    .trim();
}

/* --------------------------------------------------------------------------- */

/** Roll the usage counters forward. Called after every API response. */
function trackUsage(usage) {
  if (!usage) return;
  const month = new Date().toISOString().slice(0, 7); // "2026-09"

  db.update((s) => {
    if (!s.usage) s.usage = { current: {}, months: {} };
    const u = s.usage;

    /* If the month rolled over, archive the old one and start fresh. */
    if (u.current.month && u.current.month !== month) {
      u.months[u.current.month] = { ...u.current };
      u.current = { month, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, calls: 0 };
    }
    u.current.month = month;
    u.current.inputTokens = (u.current.inputTokens ?? 0) + (usage.input_tokens ?? 0);
    u.current.outputTokens = (u.current.outputTokens ?? 0) + (usage.output_tokens ?? 0);
    u.current.cacheRead = (u.current.cacheRead ?? 0) + (usage.cache_read_input_tokens ?? 0);
    u.current.cacheCreate = (u.current.cacheCreate ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    u.current.calls = (u.current.calls ?? 0) + 1;
  }, { silent: true });
}

/* --------------------------------------------------------------------------- */

/**
 * Ask for a structured answer.
 *
 * `schema` is plain JSON Schema — every object needs `additionalProperties:
 * false` and a `required` list, which is what makes the output guaranteed to
 * parse rather than merely likely to.
 */
async function ask({
  system,
  messages,
  schema,
  effort = "medium",
  maxTokens = 4000,
  thinking = true,
  showThinking = false,
  betas = [],
  tools,
  fast = false,
}) {
  const api = anthropic();
  if (!api) return { ok: false, reason: "no-key" };

  /* The system prompt is the cached prefix. Anything volatile belongs in
     `messages`, after the breakpoint, or the cache is invalidated every call. */
  const systemBlocks = Array.isArray(system) ? system : [{ type: "text", text: system }];
  systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral" };

  const request = {
    model: fast ? FAST_MODEL : MODEL,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages,
  };

  if (thinking && maxTokens > 1024) {
    request.thinking = { type: "enabled", budget_tokens: 1024 };
  }

  if (schema) {
    request.output_config = { format: { type: "json_schema", schema } };
  }
  if (tools) request.tools = tools;

  const useBeta = betas.length > 0;
  const params = useBeta
    ? { ...request, betas: [...new Set([...betas, FALLBACK_BETA])], fallbacks: "default" }
    : { ...request, betas: [FALLBACK_BETA], fallbacks: "default" };

  try {
    const response = await api.beta.messages.create(params);
    return interpret(response, schema);
  } catch (err) {
    /* Fallbacks and any tool beta are best-effort: if this deployment doesn't
       recognise one, drop the extras and make the plain call rather than fail. */
    if (err?.status === 400) {
      try {
        const response = await api.messages.create(request);
        return interpret(response, schema);
      } catch (inner) {
        return { ok: false, reason: "error", detail: describe(inner) };
      }
    }
    return { ok: false, reason: "error", detail: describe(err) };
  }
}

function interpret(response, schema) {
  trackUsage(response?.usage);

  if (refused(response)) {
    return {
      ok: false,
      reason: "refused",
      detail: response.stop_details?.explanation ?? "",
      category: response.stop_details?.category ?? null,
    };
  }

  const text = textOf(response);
  const usage = response.usage ?? {};

  if (!schema) {
    return { ok: true, text, thinking: thinkingOf(response), usage };
  }

  try {
    return { ok: true, value: JSON.parse(text), thinking: thinkingOf(response), usage };
  } catch {
    return { ok: false, reason: "unparseable", detail: text.slice(0, 400) };
  }
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return "That key isn't being accepted.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. I'll ease off.";
  if (err instanceof Anthropic.APIConnectionError) return "I couldn't reach the API.";
  if (err instanceof Anthropic.APIError) return `${err.status}: ${err.message}`;
  return err?.message ?? String(err);
}

/* --------------------------------------------------------------------------- */

/**
 * Streaming variant of ask().
 *
 * Designed for the fast-answer path where the user is watching the whisper
 * panel — tokens arrive one at a time via `onText(delta)`, so perceived
 * latency drops from "wait 3 seconds for full response" to "first word
 * appears in ~300ms". Returns the same shape as ask() once the stream ends.
 */
async function streamAsk({
  system,
  messages,
  maxTokens = 1200,
  fast = true,
  thinking = false,
  onText,
  onThinking,
}) {
  const api = anthropic();
  if (!api) return { ok: false, reason: "no-key" };

  const systemBlocks = Array.isArray(system) ? system : [{ type: "text", text: system }];
  systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral" };

  const request = {
    model: fast ? FAST_MODEL : MODEL,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages,
  };

  if (thinking) {
    request.thinking = { type: "enabled", budget_tokens: 1024 };
    /* max_tokens must exceed budget_tokens */
    if (request.max_tokens <= 1024) request.max_tokens = 2048;
  }

  try {
    const stream = api.messages.stream(request);
    if (onThinking) stream.on("thinking", (delta) => onThinking(delta));
    if (onText) stream.on("text", (delta) => onText(delta));
    const response = await stream.finalMessage();
    trackUsage(response?.usage);

    if (refused(response)) {
      return {
        ok: false,
        reason: "refused",
        detail: response.stop_details?.explanation ?? "",
      };
    }

    return { ok: true, text: textOf(response), usage: response.usage ?? {} };
  } catch (err) {
    return { ok: false, reason: "error", detail: describe(err) };
  }
}

/* --------------------------------------------------------------------------- */

/** Confirm a pasted key works before the user walks away trusting it. */
async function verifyKey(key) {
  try {
    const probe = new Anthropic({ apiKey: key.trim(), maxRetries: 0 });
    await probe.messages.create({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: describe(err) };
  }
}

module.exports = {
  MODEL,
  FAST_MODEL,
  EFFORT,
  ask,
  streamAsk,
  trackUsage,
  anthropic,
  configured,
  verifyKey,
  refused,
  textOf,
  thinkingOf,
  describe,
};
