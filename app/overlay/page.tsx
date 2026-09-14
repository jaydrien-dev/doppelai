"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { Mascot } from "@/components/Mascot";

/**
 * Doppel's presence on the desktop.
 *
 * A small window that sits above everything in the corner. It does one thing —
 * start and stop watching — because that is the only control that has to be
 * reachable without opening anything. Everything else is a right-click away.
 *
 * It has no card, no panel and no chrome: on a transparent window the mascot
 * and its glow are the whole interface, and the surrounding pixels must stay
 * genuinely invisible.
 */
export default function OverlayPage() {
  const connect = useDoppel((s) => s.connect);
  const connected = useDoppel((s) => s.connected);
  const paused = useDoppel((s) => s.observation.paused);
  const screenOn = useDoppel((s) => s.permissions.screen);
  const configured = useDoppel((s) => s.ai.configured);
  const narration = useDoppel((s) => s.narration);
  const nudges = useDoppel((s) => s.nudges);
  const agents = useDoppel((s) => s.agents);
  const agent = agents.find((t) => t.status === "parked") ?? agents.find((t) => t.status === "running") ?? null;

  const [hovered, setHovered] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [bubbleText, setBubbleText] = useState<string | null>(null);

  useEffect(() => {
    connect();
    document.documentElement.classList.add("overlay");
    return () => document.documentElement.classList.remove("overlay");
  }, [connect]);

  const realWatching = connected && screenOn && !paused && configured;
  const watching = optimistic !== null ? optimistic : realWatching;
  const busy = agents.some((t) => ["running", "parked"].includes(t.status));

  /* Clear the optimistic override once real state catches up. */
  useEffect(() => {
    if (optimistic !== null && realWatching === optimistic) setOptimistic(null);
  }, [realWatching, optimistic]);

  /* Flash the status label briefly on new narration. The bubble text is
     only set for high-salience observations — routine low-value looks
     don't hijack the icon click. */
  useEffect(() => {
    const latest = narration[0];
    if (!latest) return;
    setFlash(latest.sensitive ? voice.overlay.lookedAway : voice.overlay.saw);
    if (!latest.sensitive && latest.text && (latest.salience ?? 0) >= 0.6) {
      setBubbleText(latest.text);
      setBubbleOpen(false);
    }
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [narration]);

  /* Nudges always show — they're inherently worth interrupting for. */
  useEffect(() => {
    if (nudges.length > 0) {
      setBubbleText(nudges[0].text);
      setBubbleOpen(false);
    }
  }, [nudges]);

  const toggle = () => {
    if (!configured) {
      window.doppel?.overlayOpen("/mind/");
      return;
    }
    /* Clicking the icon toggles the whisper/chat panel. */
    window.doppel?.overlayToggleWhisper();
  };

  const hasSomething = Boolean(bubbleText && !bubbleOpen);

  const label = !configured
    ? voice.overlay.needsKey
    : busy
      ? agent?.status === "parked"
        ? voice.overlay.needsYou
        : voice.overlay.working
      : (flash ?? (watching ? voice.overlay.watching : voice.overlay.notWatching));

  return (
    <div
      className="flex h-dvh w-full flex-col items-center justify-end pb-2 select-none"
      style={{ background: "transparent", WebkitAppRegion: "drag" } as React.CSSProperties}
      onContextMenu={(e) => {
        e.preventDefault();
        window.doppel?.overlayMenu();
      }}
    >
      {/* Speech bubble — slides in above the icon when clicked */}
      <AnimatePresence>
        {bubbleOpen && bubbleText && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.92 }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
            onClick={() => { setBubbleOpen(false); setBubbleText(null); }}
            style={{
              maxWidth: 220,
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(240, 243, 248, 0.92)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.15) inset",
              fontSize: 11,
              lineHeight: 1.35,
              color: "var(--ink)",
              cursor: "pointer",
              marginBottom: 6,
              WebkitAppRegion: "no-drag",
              wordBreak: "break-word" as const,
            } as React.CSSProperties}
          >
            {bubbleText}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={toggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={watching ? "Stop watching" : "Start watching"}
        aria-label={watching ? "Stop watching" : "Start watching"}
        className="relative grid cursor-pointer place-items-center rounded-full"
        style={
          {
            width: 68,
            height: 68,
            background: "transparent",
            WebkitAppRegion: "no-drag",
            transition: "transform var(--dur-press) var(--ease-calm)",
            transform: hovered ? "scale(1.06)" : "scale(1)",
          } as React.CSSProperties
        }
      >
        {/* the glow behind it — pulses when Doppel has something to say */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: hasSomething
              ? "radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)"
              : watching
                ? "radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)"
                : "radial-gradient(circle, var(--slate-glow) 0%, transparent 70%)",
            animation: watching || hasSomething ? "doppel-breathe var(--pulse-cycle) var(--ease-calm) infinite" : "none",
            opacity: hasSomething ? 1 : watching ? undefined : 0.4,
          }}
        />
        <Mascot
          mood={
            !configured || !watching
              ? "paused"
              : agent?.status === "parked"
                ? "unsure"
                : busy
                  ? "working"
                  : "watching"
          }
          size="md"
        />
      </button>

      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: hovered || flash || busy ? 1 : 0.55, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          className="micro-label mt-1 whitespace-nowrap"
          style={{
            color: watching || busy || hasSomething ? "var(--primary)" : "var(--slate)",
            fontSize: 9,
            letterSpacing: "0.06em",
            textShadow: "0 1px 3px var(--shadow-light)",
          }}
        >
          {hasSomething && (
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--primary)",
                marginRight: 4,
                animation: "doppel-breathe var(--pulse-cycle) var(--ease-calm) infinite",
              }}
            />
          )}
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
