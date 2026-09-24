const { GoogleGenAI } = require("@google/genai");

const db = require("./db");

/**
 * Doppel's mind — Gemini 2.5 Flash edition.
 *
 * Every AI call goes through here. The callers never touch the SDK directly,
 * so the model swap is invisible to them. Same `ask()` and `streamAsk()`
 * signatures, same return shapes.
 *
 * Gemini 2.5 Flash is ~10x cheaper on input and ~6x cheaper on output than
 * Claude Sonnet 4.5, with comparable quality for vision + structured output.
 */

const MODEL = "gemini-3.6-flash";
const FAST_MODEL = "gemini-3.6-flash";

/** Depth per job. Maps to Gemini thinkingBudget. */
const EFFORT = {
  glance: "low",
  observe: "medium",
  consolidate: "medium",
  plan: "high",
  act: "xhigh",
};

/** Map effort levels to Gemini thinking budgets (token count).
 *  Kept lean — most calls use schema output where thinking adds latency
 *  for no quality gain. Only plan/act need real deliberation. */
const THINKING_BUDGET = {
  low: 128,
  medium: 512,
  high: 2048,
  xhigh: 4096,
};

let client = null;
let clientKey = null;

/* --------------------------------------------------------------------------- */

function apiKey() {
  const fromState = db.apiKey();
  return (fromState || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

const configured = () => Boolean(apiKey());

/** One client per key, rebuilt when the user pastes a new one. */
function gemini() {
  const key = apiKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    clientKey = key;
  }
  return client;
}

/* Keep the old export name so callers that reference `claude.anthropic` still
   get a truthy value when a key is set. */
const anthropic = gemini;

/* --------------------------------------------------------------------------- */

/**
 * Convert Anthropic-style messages to Gemini contents.
 *
 * Anthropic:  [{ role, content: [{ type: "text", text }, { type: "image", source: { media_type, data } }] }]
 * Gemini:     [{ role, parts: [{ text }, { inlineData: { mimeType, data } }] }]
 */
function toGeminiContents(messages) {
  return messages.map((msg) => {
    const role = msg.role === "assistant" ? "model" : "user";
    const rawContent = msg.content;

    /* Simple string content */
    if (typeof rawContent === "string") {
      return { role, parts: [{ text: rawContent }] };
    }

    /* Array of content blocks */
    const parts = (Array.isArray(rawContent) ? rawContent : [rawContent]).map((block) => {
      if (typeof block === "string") return { text: block };

      /* Anthropic text block */
      if (block.type === "text") return { text: block.text };

      /* Anthropic image block */
      if (block.type === "image" && block.source) {
        return {
          inlineData: {
            mimeType: block.source.media_type || "image/png",
            data: block.source.data,
          },
        };
      }

      /* Pass through anything that's already Gemini-shaped */
      if (block.inlineData) return block;
      if (block.text) return { text: block.text };

      /* Unknown block — stringify as text */
      return { text: JSON.stringify(block) };
    });

    return { role, parts };
  });
}

/* --------------------------------------------------------------------------- */

/** Roll the usage counters forward. Called after every API response. */
function trackUsage(usage) {
  if (!usage) return;
  const month = new Date().toISOString().slice(0, 7);

  db.update((s) => {
    if (!s.usage) s.usage = { current: {}, months: {} };
    const u = s.usage;

    if (u.current.month && u.current.month !== month) {
      u.months[u.current.month] = { ...u.current };
      u.current = { month, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, calls: 0 };
    }
    u.current.month = month;
    u.current.inputTokens = (u.current.inputTokens ?? 0) + (usage.promptTokenCount ?? 0);
    u.current.outputTokens = (u.current.outputTokens ?? 0) + (usage.candidatesTokenCount ?? 0);
    u.current.cacheRead = (u.current.cacheRead ?? 0) + (usage.cachedContentTokenCount ?? 0);
    u.current.cacheCreate = u.current.cacheCreate ?? 0; // Gemini doesn't separate this
    u.current.calls = (u.current.calls ?? 0) + 1;
  }, { silent: true });
}

/* --------------------------------------------------------------------------- */

/**
 * Ask for an answer — optionally structured via JSON schema.
 *
 * Same signature as the old Anthropic version. Callers don't change.
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
  const api = gemini();
  if (!api) return { ok: false, reason: "no-key" };

  /* Build system instruction text */
  const systemText = Array.isArray(system)
    ? system.map((b) => (typeof b === "string" ? b : b.text || "")).join("\n")
    : system;

  const config = {
    maxOutputTokens: maxTokens,
    systemInstruction: systemText,
  };

  /* Thinking budget — Gemini 2.5 Flash has built-in thinking */
  if (thinking) {
    const budget = THINKING_BUDGET[effort] || THINKING_BUDGET.medium;
    config.thinkingConfig = { thinkingBudget: budget };
  } else {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  /* Structured JSON output */
  if (schema) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = schema;
  }

  const contents = toGeminiContents(messages);

  try {
    const response = await api.models.generateContent({
      model: fast ? FAST_MODEL : MODEL,
      contents,
      config,
    });

    return interpret(response, schema);
  } catch (err) {
    return { ok: false, reason: "error", detail: describe(err) };
  }
}

function interpret(response, schema) {
  const usage = response?.usageMetadata ?? {};
  trackUsage(usage);

  /* Check for blocked / empty responses */
  if (response?.promptFeedback?.blockReason) {
    return {
      ok: false,
      reason: "refused",
      detail: response.promptFeedback.blockReasonMessage ?? response.promptFeedback.blockReason,
      category: response.promptFeedback.blockReason,
    };
  }

  const candidate = response?.candidates?.[0];
  if (!candidate || candidate.finishReason === "SAFETY") {
    return {
      ok: false,
      reason: "refused",
      detail: candidate?.finishMessage ?? "Content filtered",
      category: "safety",
    };
  }

  const text = response.text ?? "";

  /* Extract thinking parts if any */
  const thinkingText = (candidate.content?.parts ?? [])
    .filter((p) => p.thought && p.text)
    .map((p) => p.text)
    .join("\n")
    .trim();

  /* Map Gemini usage to the shape callers expect */
  const usageOut = {
    input_tokens: usage.promptTokenCount ?? 0,
    output_tokens: usage.candidatesTokenCount ?? 0,
    cache_read_input_tokens: usage.cachedContentTokenCount ?? 0,
    cache_creation_input_tokens: 0,
  };

  if (!schema) {
    return { ok: true, text: text.trim(), thinking: thinkingText, usage: usageOut };
  }

  try {
    return { ok: true, value: JSON.parse(text), thinking: thinkingText, usage: usageOut };
  } catch {
    return { ok: false, reason: "unparseable", detail: text.slice(0, 400) };
  }
}

/* Helpers kept for API compatibility with callers */
function refused(response) {
  return response?.promptFeedback?.blockReason != null;
}

function textOf(response) {
  return response?.text ?? "";
}

function thinkingOf(response) {
  const candidate = response?.candidates?.[0];
  if (!candidate) return "";
  return (candidate.content?.parts ?? [])
    .filter((p) => p.thought && p.text)
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function describe(err) {
  if (err?.status === 401 || err?.status === 403) return "That key isn't being accepted.";
  if (err?.status === 429) return "Rate limited. I'll ease off.";
  if (err?.message?.includes("fetch")) return "I couldn't reach the API.";
  if (err?.status) return `${err.status}: ${err.message}`;
  return err?.message ?? String(err);
}

/* --------------------------------------------------------------------------- */

/**
 * Streaming variant of ask().
 *
 * Tokens arrive via `onText(delta)` as they're generated. Returns the same
 * shape as ask() once the stream ends.
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
  const api = gemini();
  if (!api) return { ok: false, reason: "no-key" };

  const systemText = Array.isArray(system)
    ? system.map((b) => (typeof b === "string" ? b : b.text || "")).join("\n")
    : system;

  const config = {
    maxOutputTokens: maxTokens,
    systemInstruction: systemText,
  };

  if (thinking) {
    config.thinkingConfig = { thinkingBudget: 1024, includeThoughts: true };
  } else {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  const contents = toGeminiContents(messages);

  try {
    const stream = await api.models.generateContentStream({
      model: fast ? FAST_MODEL : MODEL,
      contents,
      config,
    });

    let fullText = "";
    let fullThinking = "";
    let usage = {};

    for await (const chunk of stream) {
      /* Track usage from the last chunk */
      if (chunk.usageMetadata) usage = chunk.usageMetadata;

      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.thought && part.text) {
          fullThinking += part.text;
          if (onThinking) onThinking(part.text);
        } else if (part.text) {
          fullText += part.text;
          if (onText) onText(part.text);
        }
      }

      /* Check for safety block mid-stream */
      if (chunk.promptFeedback?.blockReason) {
        return {
          ok: false,
          reason: "refused",
          detail: chunk.promptFeedback.blockReasonMessage ?? "Content filtered",
        };
      }
    }

    trackUsage(usage);

    return { ok: true, text: fullText.trim(), usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: usage.candidatesTokenCount ?? 0,
    }};
  } catch (err) {
    return { ok: false, reason: "error", detail: describe(err) };
  }
}

/* --------------------------------------------------------------------------- */

/** Confirm a pasted key works before the user walks away trusting it. */
async function verifyKey(key) {
  try {
    const probe = new GoogleGenAI({ apiKey: key.trim() });
    await probe.models.generateContent({
      model: MODEL,
      contents: "Reply with the single word: ready",
      config: { maxOutputTokens: 16, thinkingConfig: { thinkingBudget: 0 } },
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
