/**
 * Mimic ships as a static export inside Electron, so screens that are "about
 * one routine" carry the id in the query string rather than the path.
 */
export const routineHref = (id: string) => `/routine/?id=${encodeURIComponent(id)}`;
export const runHref = (id: string) => `/run/?id=${encodeURIComponent(id)}`;

export const NAV = [
  { href: "/", label: "The Den" },
  { href: "/mind", label: "Mind" },
  { href: "/routines", label: "Routines" },
  { href: "/ledger", label: "Ledger" },
  { href: "/away", label: "Away Mode" },
  { href: "/permissions", label: "Permissions" },
  { href: "/account", label: "Account" },
] as const;
