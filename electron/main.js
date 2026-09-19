const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
  ipcMain,
  protocol,
  net,
  screen,
  session,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const { autoUpdater } = require("electron-updater");
const db = require("./core/db");
const ipc = require("./core/ipc");
const observer = require("./core/observer");
const win32 = require("./core/win32");
const vision = require("./core/vision");
const brain = require("./core/brain");

/**
 * Doppel runs as a real desktop application. In development it points at the
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

  // Next asks for segment prefetch payloads with a dot separator but exports
  // them into a nested folder. Accept both spellings.
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
  return isDev ? "http://localhost:3000" : "app://doppel";
}

let deskWindow = null;
let overlayWindow = null;
let whisperWindow = null;
let guideWindow = null;
let trayIcon = null;
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
   The overlay — Doppel's presence on the desktop.

   A small frameless window that sits in the corner above everything else. It
   is the only part of Doppel that is always visible, so it does the one job
   that has to be reachable without opening anything: start and stop watching.
   -------------------------------------------------------------------------- */

const OVERLAY = { width: 240, height: 200, margin: 18 };

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
     display arrangement changed while Doppel was closed, come home instead. */
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

/* --------------------------------------------------------- guide overlay
   Fullscreen, transparent, click-through window for the Clicky-style
   pointer that highlights UI elements during walkthroughs. */

function createGuideWindow() {
  if (guideWindow && !guideWindow.isDestroyed()) return guideWindow;

  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.bounds;

  guideWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
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

  guideWindow.setAlwaysOnTop(true, "screen-saver");
  guideWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  guideWindow.setIgnoreMouseEvents(true, { forward: true });

  guideWindow.once("ready-to-show", () => guideWindow.showInactive());
  guideWindow.on("closed", () => { guideWindow = null; });

  guideWindow.loadURL(`${baseUrl()}/guide/`);
  return guideWindow;
}

function showGuideWindow() {
  if (!guideWindow || guideWindow.isDestroyed()) createGuideWindow();
  else guideWindow.showInactive();
}

function hideGuideWindow() {
  if (guideWindow && !guideWindow.isDestroyed()) guideWindow.hide();
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

/* --------------------------------------------------------------------------
   The whisper panel — Doppel's voice hotkey surface.

   A glassmorphic floating panel that appears on a global hotkey. The user
   speaks a question and Doppel answers from memory. It follows the same
   window pattern as the overlay: frameless, transparent, always-on-top,
   position saved across restarts.
   -------------------------------------------------------------------------- */

const WHISPER = { width: 680, height: 400 };

function whisperHome() {
  const { workArea, scaleFactor } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + (workArea.width - WHISPER.width) / 2),
    y: workArea.y + 8,
  };
}

function createWhisperWindow() {
  if (whisperWindow && !whisperWindow.isDestroyed()) {
    whisperWindow.show();
    whisperWindow.focus();
    return whisperWindow;
  }

  const home = whisperHome();
  const start = home;

  whisperWindow = new BrowserWindow({
    ...start,
    width: WHISPER.width,
    height: WHISPER.height,
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
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  whisperWindow.setAlwaysOnTop(true, "screen-saver");
  whisperWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  whisperWindow.once("ready-to-show", () => {
    whisperWindow.show();
    whisperWindow.focus();
  });
  whisperWindow.on("moved", rememberWhisperPosition);
  whisperWindow.on("closed", () => {
    whisperWindow = null;
  });

  whisperWindow.loadURL(`${baseUrl()}/whisper/`);
  return whisperWindow;
}

function rememberWhisperPosition() {
  if (!whisperWindow || whisperWindow.isDestroyed()) return;
  const [x, y] = whisperWindow.getPosition();
  db.update(
    (s) => {
      s.whisper.position = { x, y };
    },
    { silent: true },
  );
}

function registerWhisperHotkey() {
  const wState = db.get().whisper ?? {};
  const hotkey = wState.hotkey || "Ctrl+Shift+Space";
  try {
    globalShortcut.register(hotkey, () => {
      if (whisperWindow && !whisperWindow.isDestroyed()) {
        if (whisperWindow.isVisible()) {
          whisperWindow.hide();
        } else {
          whisperWindow.show();
          whisperWindow.focus();
        }
      } else {
        createWhisperWindow();
      }
    });
  } catch (err) {
    console.error("[doppel] could not register whisper hotkey:", err.message);
  }
}

function unregisterWhisperHotkey() {
  const wState = db.get().whisper ?? {};
  const hotkey = wState.hotkey || "Ctrl+Shift+Space";
  try {
    globalShortcut.unregister(hotkey);
  } catch {
    /* already gone */
  }
}

/* --------------------------------------------------------------------------
   System tray icon — always in the taskbar.

   Right-click opens a context menu with the same actions as the overlay menu
   plus a few extras. Left-click toggles the whisper panel.
   -------------------------------------------------------------------------- */

/* Tiny 16x16 PNG encoded as base64 — a blue "D" circle.
   Embedded so the tray icon is guaranteed to appear even if every file path fails. */
const TRAY_ICON_DATA_URL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAbElEQVR4nGNgoAVI" +
  "TvvImZz2MSQ57WM1FIPYnMRqBmn4kpz28T8aBolVE9K8CItGdLwIn82ENMNwNbpm" +
  "ThzOxoW/oIQJNJCI1QzDIeQ6H9Mb1DCAYi9QFogURyNVEhKaS8hLymhhQl5mIhUA" +
  "AHq9kbgpKM8rAAAAAElFTkSuQmCC";

function createTray() {
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  const candidates = [
    path.join(__dirname, "..", "build", iconFile),
    path.join(process.resourcesPath || "", iconFile),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "build", iconFile),
  ];
  let image = null;
  for (const p of candidates) {
    if (!p) continue;
    try {
      if (!fs.existsSync(p)) continue;
      image = nativeImage.createFromPath(p);
      if (!image.isEmpty()) {
        image = image.resize({ width: 16, height: 16 });
        console.log("[tray] icon loaded from:", p);
        break;
      }
      image = null;
    } catch { /* try next */ }
  }
  if (!image || image.isEmpty()) {
    console.warn("[tray] no icon file found, using embedded fallback");
    image = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  }

  /* macOS menu bar icons must be Template images to adapt to light/dark mode. */
  if (process.platform === "darwin") {
    image.setTemplateImage(true);
  }

  trayIcon = new Tray(image);
  trayIcon.setToolTip("Doppel");

  const buildMenu = () => {
    const state = db.get();
    const watching = state.permissions.screen && !state.observation.paused;

    return Menu.buildFromTemplate([
      {
        label: watching ? "Stop watching" : "Start watching",
        click: () => toggleWatching(),
      },
      { type: "separator" },
      { label: "Open Doppel", click: () => focusDesk("/") },
      { label: "What it's thinking", click: () => focusDesk("/mind") },
      { label: "Permissions", click: () => focusDesk("/permissions") },
      { type: "separator" },
      {
        label: "Toggle chat",
        click: () => {
          if (whisperWindow && !whisperWindow.isDestroyed()) {
            if (whisperWindow.isVisible()) whisperWindow.hide();
            else { whisperWindow.show(); whisperWindow.focus(); }
          } else {
            createWhisperWindow();
          }
        },
      },
      { type: "separator" },
      { label: "Quit Doppel", click: () => app.quit() },
    ]);
  };

  trayIcon.setContextMenu(buildMenu());

  /* Rebuild the menu on click so the watch label stays current. */
  trayIcon.on("click", () => {
    if (whisperWindow && !whisperWindow.isDestroyed()) {
      if (whisperWindow.isVisible()) whisperWindow.hide();
      else { whisperWindow.show(); whisperWindow.focus(); }
    } else {
      createWhisperWindow();
    }
  });

  trayIcon.on("right-click", () => {
    trayIcon.setContextMenu(buildMenu());
  });
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

  /* Grant microphone access so the whisper panel can use speech recognition. */
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(["media", "audioCapture"].includes(permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      return ["media", "audioCapture"].includes(permission);
    },
  );

  // Doppel's memory comes up before its face does.
  db.init();
  ipc.register({ showGuideWindow, hideGuideWindow });

  /* On startup: the overlay is always visible, plus tray icon and whisper.
     The main window opens from the tray or overlay's right-click menu. */
  db.update((s) => { s.overlay.enabled = true; }, { silent: true });
  createOverlayWindow();
  createTray();
  if (db.get().whisper?.enabled !== false) {
    registerWhisperHotkey();
    createWhisperWindow();
  }

  /* ------------------------------------------------ MCP HTTP server */
  const { spawn } = require("node:child_process");
  const mcpScript = path.join(__dirname, "mcp-server.js");
  const mcpProc = spawn(process.execPath, [mcpScript, "--http"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env },
  });
  mcpProc.stderr.on("data", (d) => console.log(d.toString().trim()));
  mcpProc.on("exit", (code) => console.log(`[mcp-http] exited (${code})`));
  app._mcpProc = mcpProc;

  /* --------------------------------------------------------- auto-update */
  if (!isDev) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch((e) =>
      console.error("[auto-update] startup check failed:", e?.message ?? e)
    );
  }

  app.on("activate", () => {
    if (!deskWindow) createDeskWindow();
  });
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  observer.stop();
  vision.stop();
  win32.stopWatching();
  brain.flush();
  db.update((s) => { s.stats.lastRunAt = Date.now(); }, { silent: true });
  db.flush();
  try { require("./core/browser").shutdown(); } catch {}
  try { require("./core/addons").shutdown(); } catch {}
  try { app._mcpProc?.kill(); } catch {}
});

/**
 * Closing the main window does not close Doppel.
 *
 * The whole premise is an agent that lives on the machine, so it keeps
 * watching from the overlay with its window put away. Quit is on the overlay's
 * right-click menu, which is the only place it needs to be — but if the
 * overlay is switched off, the last window closing does mean goodbye.
 */
app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  /* Doppel lives in the overlay and whisper — closing the main window doesn't quit. */
  if (!quitting) return;
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

/* --------------------------------------------------------------- updates -- */

let updateStatus = { state: "idle", version: null, progress: null };

function broadcastUpdate() {
  const payload = { ...updateStatus };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("doppel:update", payload);
  }
}

autoUpdater.on("checking-for-update", () => {
  updateStatus = { state: "checking", version: null, progress: null };
});
autoUpdater.on("update-available", (info) => {
  updateStatus = { state: "available", version: info.version, progress: null };
  broadcastUpdate();
});
autoUpdater.on("update-not-available", () => {
  updateStatus = { state: "idle", version: null, progress: null };
});
autoUpdater.on("download-progress", (prog) => {
  updateStatus = { ...updateStatus, state: "downloading", progress: Math.round(prog.percent) };
  broadcastUpdate();
});
autoUpdater.on("update-downloaded", (info) => {
  updateStatus = { state: "ready", version: info.version, progress: 100 };
  broadcastUpdate();
});
autoUpdater.on("error", (err) => {
  console.error("[auto-update] error:", err?.message ?? err);
  updateStatus = { state: "idle", version: null, progress: null };
});

ipcMain.handle("update:status", () => updateStatus);
ipcMain.handle("update:check", () => autoUpdater.checkForUpdatesAndNotify().catch((e) =>
  console.error("[auto-update] manual check failed:", e?.message ?? e)
));
ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());

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
    { label: "Open Doppel", click: () => focusDesk("/") },
    { label: "What it's thinking", click: () => focusDesk("/mind") },
    { label: "Permissions", click: () => focusDesk("/permissions") },
    { type: "separator" },
    { label: "Move back to the corner", click: () => moveOverlayHome() },
    { type: "separator" },
    { label: "Quit Doppel", click: () => app.quit() },
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

ipcMain.handle("overlay:toggleWhisper", () => {
  if (whisperWindow && !whisperWindow.isDestroyed()) {
    if (whisperWindow.isVisible()) {
      whisperWindow.hide();
    } else {
      whisperWindow.show();
      whisperWindow.focus();
    }
  } else {
    createWhisperWindow();
  }
  return true;
});

ipcMain.handle("doppel:close-window", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

/* ------------------------------------------------------------ whisper -- */

ipcMain.handle("whisper:setEnabled", (_event, enabled) => {
  db.update((s) => {
    s.whisper.enabled = Boolean(enabled);
  });
  if (enabled) {
    registerWhisperHotkey();
  } else {
    unregisterWhisperHotkey();
    if (whisperWindow && !whisperWindow.isDestroyed()) whisperWindow.destroy();
  }
  return true;
});

ipcMain.handle("whisper:home", () => {
  if (!whisperWindow || whisperWindow.isDestroyed()) return false;
  const home = whisperHome();
  whisperWindow.setPosition(home.x, home.y);
  rememberWhisperPosition();
  return true;
});

ipcMain.handle("whisper:setAutoDismiss", (_event, sec) => {
  db.update((s) => {
    s.whisper.autoDismiss = Math.max(0, Number(sec) || 0);
  });
  return true;
});

ipcMain.handle("whisper:setMicSensitivity", (_event, level) => {
  db.update((s) => {
    s.whisper.micSensitivity = Math.max(10, Math.min(200, Number(level) || 80));
  });
  return true;
});

ipcMain.handle("whisper:hide", () => {
  if (whisperWindow && !whisperWindow.isDestroyed()) whisperWindow.hide();
  return true;
});
