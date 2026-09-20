const fs = require("node:fs");
const path = require("node:path");

const db = require("./db");
const claude = require("./claude");
const brain = require("./brain");

/**
 * Doppel becomes you.
 *
 * A persistent model of the user built from observation — communication style,
 * decision patterns, priorities, expertise — that agents can query to
 * understand and even respond as the user.
 *
 * The profile is generated after 50 episodes, then refined every 200 new ones.
 * It lives at brain/profile.json and is included in brain exports.
 */

let profilePath = null;
let profile = null;
let lastObservationCount = 0;

const INITIAL_THRESHOLD = 50;
const REFINEMENT_INTERVAL = 200;

/* -------------------------------------------------------------------- setup */

function init() {
  const brainDir = path.join(db.paths.dir, "brain");
  profilePath = path.join(brainDir, "profile.json");

  try {
    profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    lastObservationCount = profile.observationsProcessed || 0;
  } catch {
    profile = null;
    lastObservationCount = 0;
  }

  return { hasProfile: !!profile };
}

function getProfile() {
  return profile;
}

/** Should we generate or refine the profile given the current episode count? */
function shouldRefine(episodeCount) {
  if (!profile) return episodeCount >= INITIAL_THRESHOLD;
  const sinceLastRefine = episodeCount - lastObservationCount;
  return sinceLastRefine >= REFINEMENT_INTERVAL;
}

/* ------------------------------------------------------------ generation */

const PROFILE_SYSTEM = `You are building a model of a human being from observations of their daily computer use.

You are given digests (summaries of what they did over hours and days), detected patterns, entities (people, apps, projects they interact with), and recent raw episodes (moment-by-moment observations of their screen).

From this data, extract a structured profile that captures WHO this person is — not just what they do, but how they think, communicate, decide, and prioritise.

Be specific. "Good communicator" is useless. "Writes in short, direct sentences; favours concrete examples over abstractions; tends to acknowledge others' points before disagreeing" is a profile.

Look for:
- Communication patterns: sentence length, formality, humour, how they give feedback, how they handle disagreement
- Decision patterns: do they decide fast or deliberate? Do they seek consensus or move unilaterally? What triggers reconsideration?
- Priorities: what do they spend the most time on? What do they return to? What do they avoid?
- Expertise: what domains do they navigate fluently vs. where do they need to look things up?
- Preferences: tools, workflows, aesthetics, working hours, break patterns
- The portrait should read like a paragraph a close colleague would write about them — specific, honest, warm`;

const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["communication", "priorities", "expertise", "preferences", "decisions", "portrait"],
  properties: {
    communication: {
      type: "object",
      additionalProperties: false,
      required: ["tone", "patterns", "vocabulary"],
      properties: {
        tone: { type: "string", description: "Overall communication tone in 1-2 sentences." },
        patterns: { type: "array", items: { type: "string" }, description: "Specific communication habits observed." },
        vocabulary: { type: "array", items: { type: "string" }, description: "Distinctive words or phrases they use often." },
      },
    },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "evidence", "confidence"],
        properties: {
          label: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "number", description: "0-1" },
        },
      },
    },
    expertise: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["domain", "depth", "evidence"],
        properties: {
          domain: { type: "string" },
          depth: { type: "string", enum: ["surface", "working", "deep"] },
          evidence: { type: "string" },
        },
      },
    },
    preferences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "evidence"],
        properties: {
          label: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pattern", "evidence"],
        properties: {
          pattern: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    portrait: { type: "string", description: "One paragraph capturing who this person is." },
  },
};

const REFINE_SYSTEM = `You are refining an existing user profile with new observations.

You have the current profile and new data (recent digests, episodes, patterns, entities). Update the profile:
- Strengthen patterns that new data confirms
- Add new patterns the data reveals
- Adjust confidence levels based on consistency
- Remove patterns that new data contradicts
- Update the portrait to reflect the fuller picture

Do not start from scratch. Build on what exists. Be specific.`;

async function generateProfile() {
  if (!profilePath) init();

  const s = brain.stats();
  const digests = brain.recentDigests(14);
  const patterns = brain.detectPatterns({ minCount: 2, windowDays: 30 });
  const ents = brain.knownEntities();
  const recent = brain.recentEpisodes(100);

  const parts = [];

  if (digests.length > 0) {
    parts.push("## Recent digests\n" + digests.map((d) =>
      `[${d.date || "unknown"}] ${d.hourly?.map((h) => h.summary).join(" ") || d.summary || JSON.stringify(d).slice(0, 500)}`
    ).join("\n"));
  }

  if (patterns.length > 0) {
    parts.push("## Detected patterns\n" + patterns.map((p) =>
      `- ${p.label || p.pattern || JSON.stringify(p)}`
    ).join("\n"));
  }

  if (ents.length > 0) {
    const top = ents.sort((a, b) => (b.seenCount || 0) - (a.seenCount || 0)).slice(0, 30);
    parts.push("## Key entities\n" + top.map((e) =>
      `- ${e.name} (${e.kind})${e.note ? `: ${e.note}` : ""} — seen ${e.seenCount || 0} times`
    ).join("\n"));
  }

  if (recent.length > 0) {
    parts.push("## Recent episodes (newest first)\n" + recent.slice(0, 50).map((ep) =>
      `[${new Date(ep.at).toISOString().slice(0, 16)}] ${ep.app || "?"} — ${ep.activity || ""} ${ep.detail || ""}`
    ).join("\n"));
  }

  if (parts.length < 2) {
    return { ok: false, reason: "not-enough", detail: "Not enough data to build a profile yet." };
  }

  const system = profile ? REFINE_SYSTEM : PROFILE_SYSTEM;
  const userContent = profile
    ? `Current profile:\n${JSON.stringify(profile, null, 2)}\n\nNew observations:\n${parts.join("\n\n")}`
    : parts.join("\n\n");

  const result = await claude.ask({
    system,
    effort: claude.EFFORT.consolidate,
    maxTokens: 2000,
    schema: PROFILE_SCHEMA,
    messages: [{ role: "user", content: userContent }],
  });

  if (!result.ok) return result;

  profile = {
    updatedAt: Date.now(),
    observationsProcessed: s.episodes,
    ...result.value,
  };
  lastObservationCount = s.episodes;

  try {
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");
  } catch (err) {
    console.error("[doppel] could not save profile:", err.message);
  }

  return { ok: true, profile };
}

module.exports = { init, getProfile, shouldRefine, generateProfile };
