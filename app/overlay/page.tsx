"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { Mascot } from "@/components/Mascot";

/**
 * Mimic's presence on the desktop.
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
  const connect = useMimic((s) => s.connect);
  const connected = useMimic((s) => s.connected);
  const paused = useMimic((s) => s.observation.paused);
  const screenOn = useMimic((s) => s.permissions.screen);
  const configured = useMimic((s) => s.ai.configured);
  const narration = useMimic((s) => s.narration);
  const agent = useMimic((s) => s.activeAgent);

  const [hovered, setHovered] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    connect();
    /* Make the window genuinely transparent rather than a grey square. */
    document.documentElement.classList.add("overlay");
    return () => document.documentElement.classList.remove("overlay");
  }, [connect]);

  const watching = connected && screenOn && !paused && configured;
  const busy = Boolean(agent && ["running", "parked"].includes(agent.status));

  /* A brief word when something happens, so the corner is informative
     without ever becoming a notification stream. */
  useEffect(() => {
    const latest = narration[0];
    if (!latest) return;
    setFlash(latest.sensitive ? voice.overlay.lookedAway : voice.overlay.saw);
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [narration]);

  const toggle = async () => {
    if (!configured) {
      await window.mimic?.overlayOpen("/mind/");
      return;
    }
    await window.mimic?.overlayToggleWatch();
  };

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
        window.mimic?.overlayMenu();
      }}
    >
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
        {/* the glow behind it — the only thing that says "on" from across the room */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: watching
              ? "radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)"
              : "radial-gradient(circle, var(--slate-glow) 0%, transparent 70%)",
            animation: watching ? "mimic-breathe var(--pulse-cycle) var(--ease-calm) infinite" : "none",
            opacity: watching ? undefined : 0.4,
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
            color: watching || busy ? "var(--primary)" : "var(--slate)",
            fontSize: 9,
            letterSpacing: "0.06em",
            textShadow: "0 1px 3px var(--shadow-light)",
          }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
