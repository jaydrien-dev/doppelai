"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { Mascot } from "@/components/Mascot";

const smooth = { type: "spring", stiffness: 300, damping: 28, mass: 0.8 } as const;
const fade = { duration: 0.35, ease: [0.22, 0.61, 0.36, 1] } as const;

export default function OverlayPage() {
  const connect = useDoppel((s) => s.connect);
  const connected = useDoppel((s) => s.connected);
  const paused = useDoppel((s) => s.observation.paused);
  const screenOn = useDoppel((s) => s.permissions.screen);
  const configured = useDoppel((s) => s.ai.configured);
  const narration = useDoppel((s) => s.narration);
  const nudges = useDoppel((s) => s.nudges);
  const updateStatus = useDoppel((s) => s.updateStatus);

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

  useEffect(() => {
    if (optimistic !== null && realWatching === optimistic) setOptimistic(null);
  }, [realWatching, optimistic]);

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
    setOptimistic(!watching);
    window.doppel?.overlayToggleWatch();
  };

  const hasSomething = Boolean(bubbleText && !bubbleOpen);

  const label = !configured
    ? voice.overlay.needsKey
    : (flash ?? (watching ? voice.overlay.watching : voice.overlay.notWatching));

  return (
    <div
      className="flex h-dvh w-full flex-col items-center justify-end pb-2 select-none"
      style={{ background: "transparent", WebkitAppRegion: "drag" } as React.CSSProperties}
      onContextMenu={(e) => {
        e.preventDefault();
        if (bubbleOpen) {
          setBubbleOpen(false);
          setBubbleText(null);
          return;
        }
        const latest = narration[0];
        if (latest?.text) {
          setBubbleText(latest.text);
          setBubbleOpen(true);
        } else {
          setBubbleText("Nothing on my mind yet.");
          setBubbleOpen(true);
        }
      }}
    >
      {/* Speech bubble */}
      <AnimatePresence>
        {bubbleOpen && bubbleText && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={smooth}
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

      <motion.button
        onClick={toggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={watching ? "Stop watching" : "Start watching"}
        aria-label={watching ? "Stop watching" : "Start watching"}
        animate={{ scale: hovered ? 1.08 : 1 }}
        transition={smooth}
        className="relative grid cursor-pointer place-items-center rounded-full"
        style={
          {
            width: 68,
            height: 68,
            background: "transparent",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          animate={{
            opacity: hasSomething ? 1 : watching ? 0.7 : 0.3,
          }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          style={{
            background: hasSomething || watching
              ? "radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)"
              : "radial-gradient(circle, var(--slate-glow) 0%, transparent 70%)",
            animation: watching || hasSomething ? "doppel-breathe var(--pulse-cycle) var(--ease-calm) infinite" : "none",
          }}
        />
        <Mascot
          mood={!configured || !watching ? "paused" : "watching"}
          size="md"
        />
      </motion.button>

      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: hovered || flash ? 1 : 0.55, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={fade}
          className="micro-label mt-1 whitespace-nowrap"
          style={{
            color: watching || hasSomething ? "var(--primary)" : "var(--slate)",
            fontSize: 9,
            letterSpacing: "0.06em",
            textShadow: "0 1px 3px var(--shadow-light)",
          }}
        >
          {hasSomething && (
            <motion.span
              aria-hidden
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--primary)",
                marginRight: 4,
              }}
            />
          )}
          {label}
        </motion.span>
      </AnimatePresence>

      {/* Update progress */}
      <AnimatePresence>
        {(updateStatus.state === "downloading" || updateStatus.state === "ready") && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={smooth}
            onClick={() => {
              if (updateStatus.state === "ready") window.doppel?.installUpdate();
            }}
            style={{
              marginTop: 4,
              width: 52,
              cursor: updateStatus.state === "ready" ? "pointer" : "default",
              WebkitAppRegion: "no-drag",
            } as React.CSSProperties}
          >
            {updateStatus.state === "downloading" && (
              <>
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    background: "rgba(100, 116, 139, 0.25)",
                    overflow: "hidden",
                  }}
                >
                  <motion.div
                    animate={{ width: `${updateStatus.progress ?? 0}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    style={{
                      height: "100%",
                      borderRadius: 2,
                      background: "var(--primary)",
                    }}
                  />
                </div>
                <span
                  style={{
                    display: "block",
                    textAlign: "center",
                    fontSize: 8,
                    color: "var(--slate)",
                    marginTop: 2,
                    letterSpacing: "0.04em",
                  }}
                >
                  updating {updateStatus.progress ?? 0}%
                </span>
              </>
            )}
            {updateStatus.state === "ready" && (
              <motion.span
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  display: "block",
                  textAlign: "center",
                  fontSize: 8,
                  color: "var(--primary)",
                  letterSpacing: "0.04em",
                }}
              >
                restart to update
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
