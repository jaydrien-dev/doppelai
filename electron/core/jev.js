/**
 * Jev — shared TypeSafe SDK client.
 *
 * Provides a singleton client and thin wrappers for the two primitives
 * used across Doppel: choice() (enum decision) and noul() (0-1 score).
 *
 * Every caller gets the same cached client; if the key isn't set or the
 * SDK isn't installed, calls gracefully degrade (choice → first option,
 * noul → provided default).
 */

const db = require("./db");

let client = null;

function getClient() {
  if (client) return client;
  try {
    const { TypeSafeClient } = require("@typesafe-ai/sdk");
    const key = db.typesafeKey() || process.env.TYPESAFE_API_KEY || "";
    if (!key) return null;
    client = new TypeSafeClient({ apiKey: key });
    return client;
  } catch {
    return null;
  }
}

function resetClient() { client = null; }

/**
 * Fast enum decision.
 *
 * @param {Record<string,unknown>} state   — structured context for the decision
 * @param {string}                 question — what to decide
 * @param {Record<string,string>}  options  — { optionKey: "description", ... }
 * @param {string}                 fallback — returned if Jev is unavailable
 * @returns {Promise<string>}      the chosen option key
 */
async function decide(state, question, options, fallback) {
  const jev = getClient();
  if (!jev) return fallback;
  try {
    const { choice } = require("@typesafe-ai/sdk");
    const res = await jev.systemOne({
      state,
      questions: { verdict: choice(question, options) },
    });
    return res.answers.verdict?.choice ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fast confidence score (0-1).
 *
 * @param {Record<string,unknown>} state      — structured context
 * @param {string}                 statement   — what to score
 * @param {number}                 fallback    — returned if Jev is unavailable
 * @returns {Promise<number>}      0-1 confidence
 */
async function score(state, statement, fallback = 0.5) {
  const jev = getClient();
  if (!jev) return fallback;
  try {
    const { noul } = require("@typesafe-ai/sdk");
    const res = await jev.systemOne({
      state,
      questions: { confidence: noul(statement) },
    });
    return res.answers.confidence?.noul ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Combined: one choice + one noul in a single call.
 */
async function decideWithScore(state, choiceQ, options, noulStatement, fallbackChoice, fallbackScore = 0.5) {
  const jev = getClient();
  if (!jev) return { verdict: fallbackChoice, confidence: fallbackScore };
  try {
    const { choice, noul } = require("@typesafe-ai/sdk");
    const res = await jev.systemOne({
      state,
      questions: {
        verdict: choice(choiceQ, options),
        confidence: noul(noulStatement),
      },
    });
    return {
      verdict: res.answers.verdict?.choice ?? fallbackChoice,
      confidence: res.answers.confidence?.noul ?? fallbackScore,
    };
  } catch {
    return { verdict: fallbackChoice, confidence: fallbackScore };
  }
}

module.exports = { getClient, resetClient, decide, score, decideWithScore };
