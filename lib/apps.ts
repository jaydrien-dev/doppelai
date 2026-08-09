import type { AppId } from "./types";

/** The applications Mimic is seen working inside. The mascot perches on these. */
export const APPS: Record<AppId, { name: string; short: string }> = {
  sheet: { name: "Numbers", short: "Sheet" },
  mail: { name: "Mail", short: "Mail" },
  files: { name: "Files", short: "Files" },
  browser: { name: "Browser", short: "Web" },
  doc: { name: "Pages", short: "Doc" },
  calendar: { name: "Calendar", short: "Cal" },
  chat: { name: "Chat", short: "Chat" },
  pdf: { name: "Reader", short: "PDF" },
};

export const appName = (id: AppId) => APPS[id].name;
