const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  protocol,
  net,
  screen,
  shell,
  powerSaveBlocker,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const db = require("./core/db");
const ipc = require("./core/ipc");
const observer = require("./core/observer");
const win32 = require("./core/win32");
const vision = require("./core/vision");
const brain = require("./core/brain");

/**
 * Mimic runs as a real desktop application. In development it points at the
 * Next dev server; in production it serves the static export over a private
 * app:// protocol so there is no local HTTP server and no file:// path games.
 */

const isDev = !app.isPackaged && process.env.ELECTRON_DEV === "1";
const OUT_DIR = path.join(__dirname, "..", "out");

/* Native window chrome has to be told the colours in its own language.
   These mirror --bg-base and --slate from app/tokens.css. */
const CHROME = {
  background: "#F0F3F8",
  symbol: "#64748B",
  height: 44,
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Map an app:// request onto the exported file that answers it. */
function resolveExported(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  if (p.endsWith("/")) p += "index.html";
  if (!path.extname(p)) p += "/index.html";

  const candidates = [p];

  // Next asks for segment prefetch payloads with a dot separator
  // (/routines/__next.routines.__PAGE__.txt) but exports them into a nested
  // folder (/routines/__next.routines/__PAGE__.txt). Accept both spellings.
  const nested = p.match(/^(.*)\.([^./]+\.txt)$/);
  if (nested) candidates.push(`${nested[1]}/${nested[2]}`);

  for (const candidate of candidates) {
    const resolved = path.join(OUT_DIR, candidate);
    // Never let a crafted path escape the export directory.
    if (!resolved.startsWith(OUT_DIR)) continue;
    if (fs.existsSync(resolved)) return resolved;
  }

  return path.join(OUT_DIR, p);
}

function baseUrl() {
  return isDev ? "http://localhost:3000" : "app://mimic";
}

let deskWindow = null;
let pocketWindow = null;
let overlayWindow = null;
let quitting = false;

function createDeskWindow() {
  deskWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: CHROME.background,
    show: false,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 18, y: 16 } }
      : {
          titleBarOverlay: {
            color: CHROME.background,
            symbolColor: CHROME.symbol,
            height: CHROME.height,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  deskWindow.once("ready-to-show", () => deskWindow.show());
  deskWindow.on("closed", () => {
    deskWindow = null;
  });

  deskWindow.loadURL(`${baseUrl()}/`);
  return deskWindow;
}

/* --------------------------------------------------------------------------
   The overlay — Mimic's presence on the desktop.

   A small frameless window that sits in the corner above everything else. It
   is the only part of Mimic that is always visible, so it does the one job
   that has to be reachable without opening anything: start and stop watching.
   -------------------------------------------------------------------------- */

const OVERLAY = { width: 104, height: 116, margin: 18 };

function overlayHome() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - OVERLAY.width - OVERLAY.margin,
    y: workArea.y + workArea.height - OVERLAY.height - OVERLAY.margin,
  };
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    return overlayWindow;
  }

  /* A remembered position survives restarts, but never off-screen: if the
     display arrangement changed while Mimic was closed, come home instead. */
  const saved = db.get().overlay?.position;
  const home = overlayHome();
  const start = saved && onSomeDisplay(saved) ? saved : home;

  overlayWindow = new BrowserWindow({
    ...start,
    width: OVERLAY.width,
    height: OVERLAY.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /* Above full-screen applications too — an agent you can't see isn't a
     presence, it's a background process. */
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWindow.once("ready-to-show", () => overlayWindow.showInactive());
  overlayWindow.on("moved", rememberOverlayPosition);
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  overlayWindow.loadURL(`${baseUrl()}/overlay/`);
  return overlayWindow;
}

function onSomeDisplay({ x, y }) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return x >= a.x - 40 && y >= a.y - 40 && x < a.x + a.width && y < a.y + a.height;
  });
}

function rememberOverlayPosition() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const [x, y] = overlayWindow.getPosition();
  db.update(
    (s) => {
      s.overlay.position = { x, y };
    },
    { silent: true },
  );
}

/** Pocket opens as its own phone-shaped window, so both surfaces sit side by side. */
function createPocketWindow() {
  if (pocketWindow && !pocketWindow.isDestroyed()) {
    pocketWindow.focus();
    return pocketWindow;
  }

  pocketWindow = new BrowserWindow({
    width: 412,
    height: 880,
    minWidth: 380,
    minHeight: 700,
    backgroundColor: CHROME.background,
    title: "Pocket",
    show: false,
    alwaysOnTop: true,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 14, y: 14 } }
      : {
          titleBarOverlay: {
            color: CHROME.background,
            symbolColor: CHROME.symbol,
            height: 38,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  pocketWindow.once("ready-to-show", () => pocketWindow.show());
  pocketWindow.on("closed", () => {
    pocketWindow = null;
  });

  pocketWindow.loadURL(`${baseUrl()}/pocket/?window=1`);
  return pocketWindow;
}

app.whenReady().then(() => {
  if (!isDev) {
    protocol.handle("app", async (request) => {
      const { pathname } = new URL(request.url);
      const file = resolveExported(pathname);
      try {
        return await net.fetch(pathToFileURL(file).toString());
      } catch (err) {
        console.error(`[app://] ${pathname} -> ${file}: ${err.message}`);
        throw err;
      }
    });
  }

  // Mimic's memory comes up before its face does.
  db.init();
  ipc.register();
  startKeepAlive();

  createDeskWindow();
  if (db.get().overlay?.enabled !== false) createOverlayWindow();

  app.on("activate", () => {
    if (!deskWindow) createDeskWindow();
  });
});

/**
 * While the user is out and has asked for it, hold the machine awake — an
 * agent that sleeps mid-errand is worse than one that never started.
 */
let keepAliveId = null;
function startKeepAlive() {
  setInterval(() => {
    const { away } = db.get();
    const wanted = away.active && away.keepAlive;
    if (wanted && keepAliveId === null) {
      keepAliveId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!wanted && keepAliveId !== null) {
      powerSaveBlocker.stop(keepAliveId);
      keepAliveId = null;
    }
  }, 5000);
}

app.on("before-quit", () => {
  observer.stop();
  vision.stop();
  win32.stopWatching();
  brain.flush();
  db.flush();
});

/**
 * Closing the main window does not close Mimic.
 *
 * The whole premise is an agent that lives on the machine, so it keeps
 * watching from the overlay with its window put away. Quit is on the overlay's
 * right-click menu, which is the only place it needs to be — but if the
 * overlay is switched off, the last window closing does mean goodbye.
 */
app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (!quitting && overlayWindow && !overlayWindow.isDestroyed()) return;
  app.quit();
});

app.on("before-quit", () => {
  quitting = true;
});

/* External links open in the user's browser, never inside the app. */
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost") || url.startsWith("app://")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
});

ipcMain.handle("mimic:open-pocket", () => {
  createPocketWindow();
  return true;
});

/* --------------------------------------------------------------- overlay -- */

/** Bring the main window back, at a particular screen if asked. */
ipcMain.handle("overlay:open", (_event, route) => {
  const win = deskWindow && !deskWindow.isDestroyed() ? deskWindow : createDeskWindow();
  if (route) win.loadURL(`${baseUrl()}${route}`);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
});

ipcMain.handle("overlay:setEnabled", (_event, enabled) => {
  db.update((s) => {
    s.overlay.enabled = Boolean(enabled);
  });
  if (enabled) createOverlayWindow();
  else if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  return true;
});

ipcMain.handle("overlay:home", () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false;
  const home = overlayHome();
  overlayWindow.setPosition(home.x, home.y);
  rememberOverlayPosition();
  return true;
});

/** Right-clicking the overlay. Built here because menus are a main-process thing. */
ipcMain.handle("overlay:menu", () => {
  const state = db.get();
  const watching = state.permissions.screen && !state.observation.paused;

  const menu = Menu.buildFromTemplate([
    {
      label: watching ? "Stop watching the screen" : "Start watching the screen",
      click: () => toggleWatching(),
    },
    { type: "separator" },
    { label: "Open Mimic", click: () => focusDesk("/") },
    { label: "What it's thinking", click: () => focusDesk("/mind") },
    { label: "Permissions", click: () => focusDesk("/permissions") },
    { type: "separator" },
    { label: "Move back to the corner", click: () => moveOverlayHome() },
    { label: "Hide this overlay", click: () => hideOverlay() },
    { type: "separator" },
    { label: "Quit Mimic", click: () => app.quit() },
  ]);

  menu.popup({ window: overlayWindow ?? undefined });
  return true;
});

function focusDesk(route) {
  const win = deskWindow && !deskWindow.isDestroyed() ? deskWindow : createDeskWindow();
  win.loadURL(`${baseUrl()}${route}`);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function moveOverlayHome() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const home = overlayHome();
  overlayWindow.setPosition(home.x, home.y);
  rememberOverlayPosition();
}

function hideOverlay() {
  db.update((s) => {
    s.overlay.enabled = false;
  });
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
}

/**
 * The overlay's one job. Turning watching on also lifts a global pause, since
 * clicking "start watching" while paused otherwise appears to do nothing.
 */
function toggleWatching() {
  const state = db.get();
  const watching = state.permissions.screen && !state.observation.paused;
  db.update((s) => {
    s.permissions.screen = !watching;
    if (!watching) s.observation.paused = false;
  });
  return !watching;
}

ipcMain.handle("overlay:toggleWatch", () => toggleWatching());

ipcMain.handle("mimic:close-window", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
