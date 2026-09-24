const claude = require("./claude");
const screen = require("./screen");

/**
 * Doppel's guide — the "Clicky-style" walkthrough system.
 *
 * Three capabilities:
 *   1. Element detection — ask Claude where a UI element is on screen
 *   2. Pointing — tell the guide overlay to highlight a coordinate
 *   3. Walkthroughs — step-by-step instruction loops
 *
 * The guide overlay is a fullscreen transparent click-through window that
 * renders a pulsing pointer, arrow, and instruction bubble wherever we say.
 */

let broadcast = null;
let walkthrough = null; /* active walkthrough state, or null */
let showWindow = null;  /* called to ensure the guide overlay is visible */
let hideWindow = null;  /* called to hide the guide overlay */

function init(broadcastFn, { onShow, onHide } = {}) {
  broadcast = broadcastFn;
  showWindow = onShow ?? null;
  hideWindow = onHide ?? null;
}

/* -------------------------------------------------------- element detection */

const FIND_ELEMENT_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    x: { type: "number", description: "Center x of the element in image pixels" },
    y: { type: "number", description: "Center y of the element in image pixels" },
    label: { type: "string", description: "What the element says or looks like" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["found", "x", "y", "label", "confidence"],
  additionalProperties: false,
};

/**
 * Find a UI element on screen by description.
 * Returns { ok, screenX, screenY, label, confidence } or { ok: false }.
 */
async function findElement(description) {
  const shot = await screen.capture({ maxEdge: 1366 });
  if (!shot.ok) return { ok: false, reason: "capture-failed" };

  const result = await claude.ask({
    system: `You are a UI element locator. Given a screenshot, find the described UI element and return its CENTER coordinates in the image's pixel space. Be precise — the coordinates will be used to point an arrow at the element. If you can't find it, set found to false.`,
    messages: [{
      role: "user",
      content: [
        screen.asImageBlock(shot),
        { type: "text", text: `Find this element: "${description}"` },
      ],
    }],
    schema: FIND_ELEMENT_SCHEMA,
    thinking: false,
    fast: true,
    maxTokens: 200,
  });

  if (!result.ok || !result.value?.found) {
    return { ok: false, reason: result.reason ?? "not-found" };
  }

  /* Convert from image space → real screen pointer space. */
  const pointer = screen.toPointer([result.value.x, result.value.y], shot);

  return {
    ok: true,
    screenX: pointer.x,
    screenY: pointer.y,
    imageX: result.value.x,
    imageY: result.value.y,
    label: result.value.label,
    confidence: result.value.confidence,
  };
}

/* ----------------------------------------------------------- pointing */

/**
 * Point at a screen coordinate with an instruction.
 * Sends an IPC event to the guide overlay.
 */
function pointAt(x, y, instruction, opts = {}) {
  if (!broadcast) return;
  /* Ensure the guide overlay window exists and is visible. */
  showWindow?.();
  broadcast("guide:point", {
    x, y, instruction,
    step: opts.step ?? null,
    total: opts.total ?? null,
    action: opts.action ?? null, /* "click", "type", "scroll", etc. */
  });
}

/**
 * Clear the pointer.
 */
function clearPointer() {
  if (!broadcast) return;
  broadcast("guide:clear", {});
  hideWindow?.();
}

/* ----------------------------------------------------------- walkthroughs */

const WALKTHROUGH_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "What the user should do in this step" },
          element: { type: "string", description: "The UI element to interact with (button name, menu item, etc.)" },
          action: { type: "string", enum: ["click", "type", "scroll", "hover", "wait", "read", "select"] },
        },
        required: ["instruction", "element", "action"],
        additionalProperties: false,
      },
    },
    done: { type: "boolean" },
  },
  required: ["steps", "done"],
  additionalProperties: false,
};

/**
 * Start a step-by-step walkthrough.
 * Captures the screen, asks Claude for steps, then guides the user through
 * each one by pointing at the relevant UI elements.
 */
async function startWalkthrough(goal) {
  if (walkthrough) {
    return { ok: false, reason: "already-active" };
  }

  const shot = await screen.capture({ maxEdge: 1366 });
  if (!shot.ok) return { ok: false, reason: "capture-failed" };

  /* Ask Claude to plan the walkthrough based on what's on screen. */
  const plan = await claude.ask({
    system: `Break the goal into concrete UI steps. Each step: name the exact UI element (button text, menu name, label) and action (click, type, scroll). Max 15 steps. Reference exact text visible on screen.`,
    messages: [{
      role: "user",
      content: [
        screen.asImageBlock(shot),
        { type: "text", text: `Goal: "${goal}"\n\nWhat steps should the user take to accomplish this? Look at what's currently on their screen.` },
      ],
    }],
    schema: WALKTHROUGH_SCHEMA,
    thinking: false,
    fast: false, /* use Sonnet for better accuracy */
    maxTokens: 1200,
  });

  if (!plan.ok || !plan.value?.steps?.length) {
    return { ok: false, reason: "planning-failed", detail: plan.detail };
  }

  walkthrough = {
    goal,
    steps: plan.value.steps,
    currentStep: 0,
    startedAt: Date.now(),
  };

  broadcast?.("guide:walkthrough", {
    active: true,
    goal,
    step: 0,
    total: walkthrough.steps.length,
    instruction: walkthrough.steps[0].instruction,
  });

  /* Show the first step. */
  await showCurrentStep();

  return {
    ok: true,
    steps: walkthrough.steps.length,
    firstStep: walkthrough.steps[0].instruction,
  };
}

/**
 * Show the current walkthrough step by finding the element and pointing at it.
 */
async function showCurrentStep() {
  if (!walkthrough) return;

  const step = walkthrough.steps[walkthrough.currentStep];
  if (!step) {
    await endWalkthrough("complete");
    return;
  }

  /* Find the element on screen. */
  const found = await findElement(step.element);

  if (found.ok) {
    pointAt(found.screenX, found.screenY, step.instruction, {
      step: walkthrough.currentStep + 1,
      total: walkthrough.steps.length,
      action: step.action,
    });
  } else {
    /* Element not found — still show the instruction without pointing. */
    showWindow?.();
    broadcast?.("guide:instruction", {
      instruction: step.instruction,
      step: walkthrough.currentStep + 1,
      total: walkthrough.steps.length,
      elementNotFound: true,
    });
  }
}

/**
 * Advance to the next step.  Called when the user says "next" or "done",
 * or when we detect the screen changed (user performed the action).
 */
async function nextStep() {
  if (!walkthrough) return { ok: false, reason: "no-walkthrough" };

  walkthrough.currentStep++;

  if (walkthrough.currentStep >= walkthrough.steps.length) {
    await endWalkthrough("complete");
    return { ok: true, done: true };
  }

  broadcast?.("guide:walkthrough", {
    active: true,
    goal: walkthrough.goal,
    step: walkthrough.currentStep,
    total: walkthrough.steps.length,
    instruction: walkthrough.steps[walkthrough.currentStep].instruction,
  });

  await showCurrentStep();

  return {
    ok: true,
    done: false,
    step: walkthrough.currentStep + 1,
    total: walkthrough.steps.length,
    instruction: walkthrough.steps[walkthrough.currentStep].instruction,
  };
}

/**
 * Go back one step.
 */
async function prevStep() {
  if (!walkthrough || walkthrough.currentStep <= 0) return { ok: false };
  walkthrough.currentStep--;
  await showCurrentStep();
  return { ok: true, step: walkthrough.currentStep + 1 };
}

/**
 * End the walkthrough.
 */
async function endWalkthrough(reason = "cancelled") {
  walkthrough = null;
  clearPointer();
  broadcast?.("guide:walkthrough", { active: false, reason });
  return { ok: true };
}

/**
 * Get current walkthrough state.
 */
function getState() {
  if (!walkthrough) return { active: false };
  return {
    active: true,
    goal: walkthrough.goal,
    step: walkthrough.currentStep + 1,
    total: walkthrough.steps.length,
    instruction: walkthrough.steps[walkthrough.currentStep]?.instruction ?? "",
  };
}

/**
 * "Do it for me" — perform the current step automatically.
 */
async function doCurrentStep() {
  if (!walkthrough) return { ok: false, reason: "no-walkthrough" };
  const step = walkthrough.steps[walkthrough.currentStep];
  if (!step) return { ok: false, reason: "no-step" };

  /* Find the element. */
  const found = await findElement(step.element);
  if (!found.ok) return { ok: false, reason: "element-not-found" };

  /* Return the action for the IPC layer to execute via win32/actions. */
  return {
    ok: true,
    action: step.action,
    x: found.screenX,
    y: found.screenY,
    element: step.element,
    instruction: step.instruction,
  };
}

module.exports = {
  init,
  findElement,
  pointAt,
  clearPointer,
  startWalkthrough,
  nextStep,
  prevStep,
  endWalkthrough,
  doCurrentStep,
  getState,
};
