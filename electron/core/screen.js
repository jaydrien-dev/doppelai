const { desktopCapturer, screen } = require("electron");

const win32 = require("./win32");

/**
 * Doppel's eyes.
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
/**
 * Capture a specific display.
 *
 * `displayId` selects which monitor to grab. When null/undefined, the
 * preferred display from `db.observation.displayId` is used, falling back
 * to the primary display. This is what makes multi-monitor setups work:
 * the user picks their "work" screen in Permissions, and Doppel only
 * watches that one.
 */
async function capture({ maxEdge = DEFAULT_MAX_EDGE, displayId = undefined } = {}) {
  const db = require("./db");
  const targetId = displayId ?? db.get().observation?.displayId ?? null;

  const allDisplays = screen.getAllDisplays();
  const display = targetId
    ? allDisplays.find((d) => String(d.id) === String(targetId)) ?? screen.getPrimaryDisplay()
    : screen.getPrimaryDisplay();

  const native = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };

  const scale = Math.min(1, maxEdge / Math.max(native.width, native.height));
  const width = Math.max(320, Math.round(native.width * scale));
  const height = Math.max(200, Math.round(native.height * scale));

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });
  } catch {
    return { ok: false, detail: "Screen capture unavailable (GPU busy)." };
  }

  /* Match the source to the target display. desktopCapturer names them
     "Screen 1", "Screen 2", etc., and their display_id property matches
     Electron's display.id. Try display_id first, then index fallback. */
  const displayIndex = allDisplays.findIndex((d) => d.id === display.id);
  const source =
    sources.find((s) => s.display_id === String(display.id)) ??
    sources[displayIndex] ??
    sources[0];

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
    displayId: display.id,
    at: Date.now(),
  };
}

/** List all connected displays for the UI. */
function listDisplays() {
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: d.label || ("Display " + (i + 1)),
    width: d.size.width,
    height: d.size.height,
    primary: d.id === screen.getPrimaryDisplay().id,
    scaleFactor: d.scaleFactor,
    bounds: d.bounds,
  }));
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

/**
 * Cheap local pixel-diff between two screenshots (as NativeImage PNGs).
 * Decodes both to raw RGBA, compares a sparse grid of pixels, and returns
 * the percentage that differ beyond a small threshold.
 *
 * This runs in ~1ms on a 1366px screenshot and uses no external dependencies.
 * The point is to distinguish cursor blinks (< 2%) from real work (> 15%)
 * without calling the API.
 */
function diffPercent(base64A, base64B) {
  try {
    const { nativeImage } = require("electron");
    const a = nativeImage.createFromBuffer(Buffer.from(base64A, "base64"));
    const b = nativeImage.createFromBuffer(Buffer.from(base64B, "base64"));

    const bmpA = a.toBitmap();
    const bmpB = b.toBitmap();
    const sizeA = a.getSize();
    const sizeB = b.getSize();

    if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) return 100;
    if (bmpA.length !== bmpB.length) return 100;

    /* Sample every 8th pixel — 1.5% of pixels, plenty for a rough diff. */
    const stride = sizeA.width * 4;
    let changed = 0;
    let sampled = 0;

    for (let y = 0; y < sizeA.height; y += 8) {
      const row = y * stride;
      for (let x = 0; x < sizeA.width; x += 8) {
        const i = row + x * 4;
        const dr = Math.abs(bmpA[i] - bmpB[i]);
        const dg = Math.abs(bmpA[i + 1] - bmpB[i + 1]);
        const db = Math.abs(bmpA[i + 2] - bmpB[i + 2]);
        sampled++;
        if (dr + dg + db > 30) changed++;
      }
    }

    return sampled === 0 ? 0 : (changed / sampled) * 100;
  } catch {
    return 100; // can't compare — treat as fully changed
  }
}

module.exports = { capture, pointerSpace, toPointer, asImageBlock, diffPercent, listDisplays, DEFAULT_MAX_EDGE };
