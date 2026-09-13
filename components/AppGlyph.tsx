import type { AppId } from "@/lib/types";

/**
 * Quiet monochrome glyphs for the applications Doppel works inside.
 * Line only, no fills, no colour of their own — they inherit currentColor.
 */
export function AppGlyph({ app, size = 22 }: { app: AppId; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[app]}
    </svg>
  );
}

const paths: Record<AppId, React.ReactNode> = {
  sheet: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M9.5 9.5v10M15 9.5v10" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M4.5 8l6.4 4.6a2 2 0 0 0 2.2 0L19.5 8" />
    </>
  ),
  files: (
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.5.7l1 1.2h7.3a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  browser: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 9h18" />
      <circle cx="6.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="8.6" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  doc: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="14.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <circle cx="8.5" cy="13.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13.5" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  chat: (
    <path d="M20.5 12.2c0 3.6-3.8 6.5-8.5 6.5-1 0-2-.13-2.9-.38L4.2 20l1.1-3.3A6.1 6.1 0 0 1 3.5 12.2c0-3.6 3.8-6.5 8.5-6.5s8.5 2.9 8.5 6.5Z" />
  ),
  pdf: (
    <>
      <path d="M13.5 3.5H8a2.5 2.5 0 0 0-2.5 2.5v12A2.5 2.5 0 0 0 8 20.5h8a2.5 2.5 0 0 0 2.5-2.5V8.5z" />
      <path d="M13.5 3.5v3a2 2 0 0 0 2 2h3" />
    </>
  ),
};
