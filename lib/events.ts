import type { AppId, ObservedEvent } from "./types";

/** Plain language for one raw observation. */
export function describeEvent(e: ObservedEvent): string {
  const short = (p?: string) => (p ? p.split(/[\\/]/).pop() : "");
  switch (e.kind) {
    case "window.focus":
      return `You moved to ${appLabel(e.app)}`;
    case "file.created":
      return `${e.name} appeared in ${short(e.dir)}`;
    case "file.changed":
      return `${e.name} changed`;
    case "file.moved":
      return `${e.name} moved into ${short(e.dir)}`;
    case "file.removed":
      return `${e.name} left ${short(e.dir)}`;
    case "clip.copy":
      return `You copied ${e.shape}`;
    default:
      return "Something happened";
  }
}

const APP_NAMES: Record<string, string> = {
  excel: "Excel",
  winword: "Word",
  outlook: "Outlook",
  chrome: "Chrome",
  msedge: "Edge",
  firefox: "Firefox",
  explorer: "File Explorer",
  notepad: "Notepad",
  code: "VS Code",
  acrord32: "Acrobat",
  powerpnt: "PowerPoint",
  teams: "Teams",
  slack: "Slack",
  doppel: "Doppel",
  electron: "Doppel",
};

export const appLabel = (app?: string) =>
  APP_NAMES[(app ?? "").toLowerCase()] ?? app ?? "something";

const APP_GLYPHS: Record<string, AppId> = {
  excel: "sheet",
  winword: "doc",
  outlook: "mail",
  chrome: "browser",
  msedge: "browser",
  firefox: "browser",
  explorer: "files",
  notepad: "doc",
  code: "doc",
  acrord32: "pdf",
  powerpnt: "doc",
  teams: "chat",
  slack: "chat",
};

export const appGlyph = (app?: string): AppId =>
  APP_GLYPHS[(app ?? "").toLowerCase()] ?? "browser";

/** The window Doppel is currently watching, if it's seen one recently. */
export function currentApp(events: ObservedEvent[]): string | undefined {
  return events.find((e) => e.kind === "window.focus")?.app;
}
