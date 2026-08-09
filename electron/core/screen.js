const { desktopCapturer, screen } = require("electron");

const win32 = require("./win32");

/**
 * Mimic's eyes.
 *
 * Two coordinate spaces meet here and getting them confused is the classic way
 * to build an agent that clicks 200 pixels from where it meant to:
 *
 *   capture space   the pixels of the screenshot we actually send to Claude.
 *                   Opus 5 returns coordinates 1:1 in this space, so whatever
 *                   we send is what its numbers refer to.
 *   pointer space   what SetCursorPos moves in, which is what GetSystemMetrics
 *                   reports. On a scaled display these differ from both the
 *                   panel's native pixels and the capture size.
 *
 * `toPointer()` is the only sanctioned bridge between the two.
 */

/**
 * 1366px on the long edge. Anthropic's guidance for computer use is that
 * 1080p balances accuracy and cost and that 1366×768 is the cost-effective
 * option with strong performance — and screenshots are the single largest
 * recurring token cost in a watching agent, taken every few seconds.
 */
const DEFAULT_MAX_EDGE = 1366;

let pointerSize = null;

/** The space SetCursorPos works in. Asked once — it doesn't change mid-session. */
async function pointerSpace() {
  if (pointerSize) return pointerSize;
  const [result] = await win32.act([{ kind: "screen-size" }]);
  if (result?.ok && result.detail?.width) {
    pointerSize = { width: result.detail.width, height: result.detail.height };
  } else {
    const display = screen.getPrimaryDisplay();
    pointerSize = { width: display.size.width, height: display.size.height };
  }
  return pointerSize;
}

/**
 * Grab the screen, scaled to fit `maxEdge`.
 *
 * Returns the PNG as base64 alongside the dimensions actually captured — the
 * caller must pass those to the model as `display_width_px`/`display_height_px`
 * so its coordinates and our image agree.
 */
async function capture({ maxEdge = DEFAULT_MAX_EDGE } = {}) {
  const display = screen.getPrimaryDisplay();
  const native = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };

  const scale = Math.min(1, maxEdge / Math.max(native.width, native.height));
  const width = Math.max(320, Math.round(native.width * scale));
  const height = Math.max(200, Math.round(native.height * scale));

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
    fetchWindowIcons: false,
  });

  const source = sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    return { ok: false, detail: "The screen didn't come back." };
  }

  const size = source.thumbnail.getSize();
  return {
    ok: true,
    base64: source.thumbnail.toPNG().toString("base64"),
    mediaType: "image/png",
    width: size.width,
    height: size.height,
    displayName: source.name,
    at: Date.now(),
  };
}

/** Convert a coordinate the model gave us into one the pointer can use. */
async function toPointer([x, y], captured) {
  const space = await pointerSpace();
  if (!captured?.width || !captured?.height) return { x: Math.round(x), y: Math.round(y) };
  return {
    x: Math.round((x / captured.width) * space.width),
    y: Math.round((y / captured.height) * space.height),
  };
}

/** An image content block, ready to drop into a message. */
const asImageBlock = (shot) => ({
  type: "image",
  source: { type: "base64", media_type: shot.mediaType, data: shot.base64 },
});

module.exports = { capture, pointerSpace, toPointer, asImageBlock, DEFAULT_MAX_EDGE };
