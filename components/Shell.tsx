"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { NAV } from "@/lib/nav";
import { useDesktop } from "@/lib/desktop";
import { ago } from "@/lib/time";
import { appLabel } from "@/lib/events";
import type { NarrationLine, BrainStats } from "@/lib/types";
import { Pulse } from "./Pulse";
import { Mascot } from "./Mascot";
import type { Mood } from "./Mascot";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const connect = useDoppel((s) => s.connect);
  const tick = useDoppel((s) => s.tick);
  const paused = useDoppel((s) => s.observation.paused);
  const narration = useDoppel((s) => s.narration);
  const nudges = useDoppel((s) => s.nudges);
  const now = useDoppel((s) => s.now);
  const flash = useDoppel((s) => s.flash);
  const setFlash = useDoppel((s) => s.setFlash);
  const updateStatus = useDoppel((s) => s.updateStatus);
  const { desktop, mac } = useDesktop();

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tick]);

  /* The overlay is a bare transparent window — no rail, no panels, no chrome. */
  const isOverlay = pathname.startsWith("/overlay") || pathname.startsWith("/whisper");

  if (isOverlay) return <>{children}</>;

  /* ---- derived state for ambient presence ---- */

  const mascotMood: Mood = paused
    ? "paused"
    : narration[0] && now - narration[0].at < 15_000
      ? "watching"
      : "idle";

  const lastSeen = narration[0];
  const hasNudges = nudges.length > 0;

  /* Whether Doppel is actively doing something (watching). */
  const alive = !paused && mascotMood === "watching";

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[1240px] flex-col md:flex-row"
      style={{ paddingTop: desktop ? 20 : 0 }}
    >
      {desktop && (
        <div
          aria-hidden
          className="fixed left-0 right-0 top-0 z-40"
          style={{ height: 44, WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      )}

      {/* ---------------------------------------------------------------- rail */}
      <aside
        className="shrink-0 px-6 pt-8 md:sticky md:top-0 md:h-dvh md:w-[236px] md:px-8 md:py-10"
        style={{
          ...(desktop && mac ? { paddingTop: 52 } : undefined),
          /* Feature 4: soft edge glow when actively watching */
          borderRight: "1px solid transparent",
          transition: "border-color 0.3s ease-out, box-shadow 0.3s ease-out",
          ...(alive
            ? {
                borderRight: "1px solid var(--primary-glow-soft)",
                boxShadow: "1px 0 12px -4px var(--primary-glow-soft)",
              }
            : {}),
        }}
      >
        <div className="flex items-center justify-between md:block">
          <Link href="/" className="flex items-center gap-3">
            {/* Feature 3: mascot mood reacts to state */}
            <Mascot mood={mascotMood} size="sm" />
            <span
              style={{
                fontSize: "var(--text-title)",
                fontWeight: 700,
                letterSpacing: "var(--tracking-tight)",
              }}
            >
              doppel
            </span>
            {/* Feature 1: breathing dot — tiny pulse next to the name */}
            <Pulse size={12} paused={paused} className="-ml-1" />
          </Link>
          <div className="md:hidden">
            <Pulse size={40} paused={paused} />
          </div>
        </div>

        <nav className="mt-8 flex gap-2 overflow-x-auto md:mt-12 md:flex-col md:gap-1 md:overflow-visible">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            /* Feature 5: nudge badge on Home */
            const showBadge = item.href === "/" && hasNudges && !active;
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
                <span>{item.label}</span>
                {showBadge && (
                  <span
                    className="shrink-0 rounded-full"
                    style={{
                      width: 7,
                      height: 7,
                      background: "var(--primary)",
                      boxShadow: "0 0 6px var(--primary-glow)",
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Feature 2: ambient status — what Doppel last noticed */}
        <AmbientStatus lastSeen={lastSeen} now={now} paused={paused} />

        {/* Feature 6: focus timer — how long you've been in one app */}
        <FocusTimer narration={narration} now={now} paused={paused} />

        {/* Feature 7: memory depth — how much Doppel knows */}
        <MemoryDepth />

        {/* Feature 8: quick recall search */}
        <QuickRecall />

        {/* The stop button. Never more than one click away, on any screen. */}
        <div className="mt-8 md:absolute md:bottom-10 md:left-8 md:right-8 md:mt-0">
          <button
            onClick={() => doppel.setPaused(!paused)}
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

      <DiagnosticsPanel />

      {/* Update banner */}
      <UpdateBanner status={updateStatus} />

      {/* Flash toast */}
      <FlashToast message={flash} onDismiss={() => setFlash(null)} />
    </div>
  );
}

/* ===========================================================================
   Ambient Status — one line showing what Doppel last noticed
   =========================================================================== */

interface AmbientProps {
  lastSeen: { at: number; app: string | null; text: string; salience: number } | undefined;
  now: number;
  paused: boolean;
}

function AmbientStatus({ lastSeen, now, paused }: AmbientProps) {
  if (paused) {
    return (
      <div className="mt-6 hidden md:block" style={{ minHeight: 40 }}>
        <p
          className="agent-voice"
          style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", opacity: 0.6 }}
        >
          Paused
        </p>
      </div>
    );
  }

  if (!lastSeen) {
    return (
      <div className="mt-6 hidden md:block" style={{ minHeight: 40 }}>
        <p
          className="agent-voice"
          style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", opacity: 0.5 }}
        >
          Watching
        </p>
      </div>
    );
  }

  const truncated =
    lastSeen.text.length > 60 ? lastSeen.text.slice(0, 60) + "\u2026" : lastSeen.text;

  return (
    <div className="mt-6 hidden md:block" style={{ minHeight: 40 }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={lastSeen.at}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <p
            className="agent-voice"
            style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", lineHeight: 1.4 }}
          >
            {truncated}
          </p>
          <p className="micro-label mt-1">
            {lastSeen.app ? `${appLabel(lastSeen.app)} · ` : ""}
            {ago(lastSeen.at, now)}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ===========================================================================
   Focus Timer — how long you've been in one app without switching
   =========================================================================== */

function FocusTimer({
  narration,
  now,
  paused,
}: {
  narration: NarrationLine[];
  now: number;
  paused: boolean;
}) {
  /* Find the current app and when the user first started using it
     continuously (no app change in narration). */
  const focus = useMemo(() => {
    if (paused || narration.length === 0) return null;
    const currentApp = narration[0]?.app;
    if (!currentApp) return null;

    /* Walk backwards through narration to find when this app streak started. */
    let streakStart = narration[0].at;
    for (let i = 1; i < narration.length; i++) {
      if (narration[i].app !== currentApp) break;
      streakStart = narration[i].at;
    }
    const mins = Math.floor((now - streakStart) / 60_000);
    if (mins < 2) return null; /* Don't show for <2 min */
    return { app: currentApp, mins };
  }, [narration, now, paused]);

  if (!focus) return null;

  const label =
    focus.mins >= 60
      ? `${Math.floor(focus.mins / 60)}h ${focus.mins % 60}m`
      : `${focus.mins}m`;

  return (
    <div className="mt-4 hidden md:block">
      <p
        style={{
          fontSize: "var(--text-xs, 11px)",
          color: "var(--primary)",
          opacity: 0.8,
          letterSpacing: "0.02em",
        }}
      >
        Focused · {label}
      </p>
      <p className="micro-label" style={{ marginTop: 2 }}>
        {appLabel(focus.app)}
      </p>
    </div>
  );
}

/* ===========================================================================
   Memory Depth — how much Doppel knows about this person
   =========================================================================== */

function MemoryDepth() {
  const [stats, setStats] = useState<BrainStats | null>(null);

  useEffect(() => {
    window.doppel?.brainStats?.().then(setStats);
    /* Refresh every 2 minutes — episodes accumulate slowly. */
    const t = setInterval(() => {
      window.doppel?.brainStats?.().then(setStats);
    }, 120_000);
    return () => clearInterval(t);
  }, []);

  if (!stats || (stats.episodes === 0 && stats.entities === 0)) return null;

  const total = stats.episodes + stats.entities;
  const days = stats.oldest
    ? Math.max(1, Math.floor((Date.now() - stats.oldest) / 86_400_000))
    : 0;

  return (
    <div className="mt-4 hidden md:block">
      <p
        style={{
          fontSize: "var(--text-xs, 11px)",
          color: "var(--slate)",
          opacity: 0.7,
        }}
      >
        {total.toLocaleString()} things remembered
      </p>
      {days > 0 && (
        <p className="micro-label" style={{ marginTop: 2 }}>
          watching for {days} {days === 1 ? "day" : "days"}
        </p>
      )}
    </div>
  );
}

/* ===========================================================================
   Quick Recall — tiny search box in the sidebar
   =========================================================================== */

function QuickRecall() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setResult(null);
    const r = await window.doppel?.askBrainFast?.(q);
    setBusy(false);
    setResult(r?.ok && r.text ? r.text : "Nothing comes to mind.");
  };

  return (
    <div className="mt-5 hidden md:block">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
            if (e.key === "Escape") { setQuery(""); setResult(null); }
          }}
          placeholder="Ask memory..."
          spellCheck={false}
          className="min-w-0 flex-1"
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius-control)",
            background: "var(--bg-base)",
            boxShadow: "var(--elev-pressed-sm)",
            fontSize: "var(--text-xs, 11px)",
            color: "var(--ink)",
            border: "none",
            outline: "none",
          }}
        />
      </div>
      {busy && (
        <p
          className="agent-voice mt-2"
          style={{ fontSize: "var(--text-xs, 11px)", color: "var(--primary)" }}
        >
          Thinking...
        </p>
      )}
      {result && !busy && (
        <motion.div
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="mt-2"
        >
          <p
            className="agent-voice"
            style={{
              fontSize: "var(--text-xs, 11px)",
              color: "var(--slate)",
              lineHeight: 1.5,
              maxHeight: 120,
              overflowY: "auto",
            }}
          >
            {result}
          </p>
          <button
            onClick={() => { setQuery(""); setResult(null); }}
            className="micro-label mt-1 cursor-pointer"
            style={{ color: "var(--primary)", background: "none", border: "none" }}
          >
            Clear
          </button>
        </motion.div>
      )}
    </div>
  );
}

/* ===========================================================================
   Flash Toast — shows errors and transient messages, auto-dismisses
   =========================================================================== */

function FlashToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            maxWidth: 480,
            width: "calc(100% - 48px)",
            padding: "14px 20px",
            borderRadius: "var(--radius-card-sm)",
            background: "var(--surface)",
            boxShadow: "var(--elev-raised), 0 4px 24px rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <p style={{ fontSize: "var(--text-sm)", color: "var(--ink)", flex: 1 }}>
            {message}
          </p>
          <button
            onClick={onDismiss}
            className="cursor-pointer shrink-0"
            style={{
              background: "none",
              border: "none",
              fontSize: "var(--text-sm)",
              color: "var(--slate)",
              padding: "2px 6px",
            }}
          >
            &times;
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ===========================================================================
   Update Banner — shows when an update is downloaded and ready to install
   =========================================================================== */

function UpdateBanner({
  status,
}: {
  status: { state: string; version?: string | null };
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || status.state !== "downloaded") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "fixed",
        top: 52,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        maxWidth: 420,
        width: "calc(100% - 48px)",
        padding: "12px 20px",
        borderRadius: "var(--radius-card-sm)",
        background: "var(--primary)",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      <p style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
        Update ready{status.version ? ` (v${status.version})` : ""} — restart to apply
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => doppel.installUpdate()}
          className="cursor-pointer"
          style={{
            background: "rgba(255,255,255,0.2)",
            border: "none",
            borderRadius: "var(--radius-control)",
            padding: "6px 14px",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "white",
          }}
        >
          Restart
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="cursor-pointer"
          style={{
            background: "none",
            border: "none",
            fontSize: "var(--text-sm)",
            color: "rgba(255,255,255,0.7)",
            padding: "2px 6px",
          }}
        >
          &times;
        </button>
      </div>
    </motion.div>
  );
}