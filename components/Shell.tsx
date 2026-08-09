"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { awayMinutesLeft, mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { NAV } from "@/lib/nav";
import { useDesktop } from "@/lib/desktop";
import { Pulse } from "./Pulse";
import { Mascot } from "./Mascot";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { WatchThis } from "./WatchThis";
import { GraduationModal } from "./GraduationModal";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const connect = useMimic((s) => s.connect);
  const tick = useMimic((s) => s.tick);
  const paused = useMimic((s) => s.observation.paused);
  const away = useMimic((s) => s.away);
  const now = useMimic((s) => s.now);
  const teaching = useMimic((s) => s.teaching);
  const setTeaching = useMimic((s) => s.setTeaching);
  const { desktop, mac } = useDesktop();

  /* One connection to the main process, held for the life of the window. */
  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tick]);

  const isTheatre = pathname.startsWith("/run");
  const isPocket = pathname.startsWith("/pocket");
  /* The overlay is a bare transparent window — no rail, no panels, no chrome. */
  const isOverlay = pathname.startsWith("/overlay");

  /* Away Mode cools the whole app down a little: the heartbeat slows. */
  const ambient = away.active ? { ["--pulse-cycle" as string]: "6.5s" } : undefined;

  const dragStrip = desktop ? (
    <div
      aria-hidden
      className="fixed left-0 right-0 top-0 z-40"
      style={{ height: 44, WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  ) : null;

  const chrome = (
    <>
      <GraduationModal />
      <WatchThis open={teaching} onClose={() => setTeaching(false)} />
      <DiagnosticsPanel />
    </>
  );

  if (isOverlay) return <>{children}</>;

  if (isPocket) {
    return (
      <div style={ambient}>
        {dragStrip}
        {children}
      </div>
    );
  }

  if (isTheatre) {
    return (
      <div style={ambient}>
        {dragStrip}
        {children}
        {chrome}
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[1240px] flex-col md:flex-row"
      style={{ ...ambient, paddingTop: desktop ? 20 : 0 }}
    >
      {dragStrip}

      {/* ---------------------------------------------------------------- rail */}
      <aside
        className="shrink-0 px-6 pt-8 md:sticky md:top-0 md:h-dvh md:w-[236px] md:px-8 md:py-10"
        style={desktop && mac ? { paddingTop: 52 } : undefined}
      >
        <div className="flex items-center justify-between md:block">
          <Link href="/" className="flex items-center gap-3">
            <Mascot mood={paused ? "paused" : away.active ? "working" : "idle"} size="sm" />
            <span
              style={{
                fontSize: "var(--text-title)",
                fontWeight: 700,
                letterSpacing: "var(--tracking-tight)",
              }}
            >
              mimic
            </span>
          </Link>
          <div className="md:hidden">
            <Pulse size={40} paused={paused} />
          </div>
        </div>

        <nav className="mt-8 flex gap-2 overflow-x-auto md:mt-12 md:flex-col md:gap-1 md:overflow-visible">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between gap-2 whitespace-nowrap transition-colors"
                style={{
                  padding: "10px 16px",
                  borderRadius: "var(--radius-control)",
                  fontSize: "var(--text-body)",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--ink)" : "var(--slate)",
                  background: active ? "var(--bg-base)" : "transparent",
                  boxShadow: active ? "var(--elev-pressed-sm)" : "none",
                }}
              >
                {item.label}
                {item.href === "/away" && away.active && (
                  <span
                    aria-hidden
                    className="block shrink-0 rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: "var(--primary)",
                      boxShadow: "0 0 6px var(--primary-glow)",
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 flex flex-col gap-2 md:mt-8">
          {/* Teaching is always one click away — it is the cold-start answer. */}
          <button
            onClick={() => setTeaching(true)}
            className="pressable w-full cursor-pointer text-left"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-control)",
              background: "var(--primary-soft)",
              color: "var(--primary)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
            }}
          >
            {voice.teach.cta}
          </button>

          <button
            onClick={() => mimic.openPocket()}
            className="pressable w-full cursor-pointer text-left"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-control)",
              background: "var(--surface)",
              boxShadow: "var(--elev-raised-sm)",
              fontSize: "var(--text-sm)",
            }}
          >
            Open Pocket
          </button>
        </div>

        {/* The stop button. Never more than one click away, on any screen. */}
        <div className="mt-8 md:absolute md:bottom-10 md:left-8 md:right-8 md:mt-0">
          {away.active && (
            <p className="micro-label mb-3" style={{ color: "var(--primary)" }}>
              {voice.away.active} &middot; {awayMinutesLeft(away, now)}m
            </p>
          )}
          <button
            onClick={() => mimic.setPaused(!paused)}
            className="pressable w-full cursor-pointer text-left"
            style={{
              padding: "14px 16px",
              borderRadius: "var(--radius-control)",
              background: paused ? "var(--bg-base)" : "var(--surface)",
              boxShadow: paused ? "var(--elev-pressed-sm)" : "var(--elev-raised-sm)",
            }}
          >
            <span className="flex items-center gap-3">
              <span
                className="block shrink-0 rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background: paused ? "var(--slate)" : "var(--primary)",
                  boxShadow: paused ? "none" : "0 0 8px var(--primary-glow)",
                }}
              />
              <span style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>
                {paused ? voice.permissions.resume : voice.permissions.pause}
              </span>
            </span>
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-6 py-10 md:px-12 md:py-14">{children}</main>

      {chrome}
    </div>
  );
}
