"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { Mascot } from "@/components/Mascot";
import type { Bot } from "@/lib/types";

const smooth = { type: "spring", stiffness: 400, damping: 30, mass: 0.6 } as const;
const fade = { duration: 0.15, ease: [0.16, 1, 0.3, 1] } as const;

export default function OverlayPage() {
  const connect = useDoppel((s) => s.connect);
  const connected = useDoppel((s) => s.connected);
  const paused = useDoppel((s) => s.observation.paused);
  const screenOn = useDoppel((s) => s.permissions.screen);
  const configured = useDoppel((s) => s.ai.configured);
  const narration = useDoppel((s) => s.narration);
  const updateStatus = useDoppel((s) => s.updateStatus);

  const [hovered, setHovered] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  /* Bot state — just for mascot mood, no bar */
  const [bots, setBots] = useState<Bot[]>([]);

  useEffect(() => {
    connect();
    document.documentElement.classList.add("overlay");
    return () => document.documentElement.classList.remove("overlay");
  }, [connect]);

  /* Listen for bot updates (for mascot mood only) */
  useEffect(() => {
    const api = window.doppel;
    if (!api) return;

    const unsubBot = api.onBotUpdate?.((bot: Bot) => {
      setBots((prev) => {
        const idx = prev.findIndex((b) => b.id === bot.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = bot;
          return next;
        }
        return [...prev, bot];
      });
    });

    api.computerList?.().then((list: Bot[]) => setBots(list));

    return () => { unsubBot?.(); };
  }, []);

  const realWatching = connected && screenOn && !paused && configured;
  const watching = optimistic !== null ? optimistic : realWatching;

  useEffect(() => {
    if (optimistic !== null && realWatching === optimistic) setOptimistic(null);
  }, [realWatching, optimistic]);

  useEffect(() => {
    const latest = narration[0];
    if (!latest) return;
    setFlash(latest.sensitive ? voice.overlay.lookedAway : voice.overlay.saw);
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [narration]);

  const toggle = () => {
    if (!configured) {
      window.doppel?.overlayOpen("/mind/");
      return;
    }
    setOptimistic(!watching);
    window.doppel?.overlayToggleWatch();
  };

  const activeBots = bots.filter(
    (b) => b.status === "running" || b.status === "clarifying",
  );

  const label = !configured
    ? voice.overlay.needsKey
    : (flash ?? (watching ? voice.overlay.watching : voice.overlay.notWatching));

  return (
    <div
      className="flex h-dvh w-full flex-col items-center justify-end select-none"
      style={{ background: "transparent", WebkitAppRegion: "drag" } as React.CSSProperties}
      onContextMenu={(e) => {
        e.preventDefault();
        window.doppel?.overlayMenu();
      }}
    >
      {/* Bot activity badge — shows above mascot when bots are running */}
      <AnimatePresence>
        {activeBots.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.8 }}
            transition={smooth}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              background: "rgba(15, 23, 42, 0.88)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              fontSize: 10,
              color: "#e2e8f0",
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              maxWidth: 180,
              WebkitAppRegion: "no-drag",
              cursor: "pointer",
            } as React.CSSProperties}
            onClick={() => window.doppel?.overlayShowTasks()}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#22c55e",
                flexShrink: 0,
                animation: "corner-pulse 2s ease-in-out infinite",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeBots.length === 1
                ? activeBots[0].goal.slice(0, 24) + (activeBots[0].goal.length > 24 ? "..." : "")
                : `${activeBots.length} bots running`}
            </span>
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
            width: 60,
            height: 60,
            background: "transparent",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          animate={{
            opacity: activeBots.length > 0 ? 1 : watching ? 0.7 : 0.3,
          }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          style={{
            background: activeBots.length > 0 || watching
              ? "radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)"
              : "radial-gradient(circle, var(--slate-glow) 0%, transparent 70%)",
            animation: watching || activeBots.length > 0 ? "doppel-breathe var(--pulse-cycle) var(--ease-calm) infinite" : "none",
          }}
        />
        <Mascot
          mood={activeBots.length > 0 ? "working" : !configured || !watching ? "paused" : "watching"}
          size="md"
        />
      </motion.button>

      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: hovered || flash ? 1 : 0.55, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={fade}
          className="micro-label whitespace-nowrap"
          style={{
            color: activeBots.length > 0 || watching ? "var(--primary)" : "var(--slate)",
            fontSize: 9,
            letterSpacing: "0.06em",
            textShadow: "0 1px 3px var(--shadow-light)",
            marginTop: 2,
            marginBottom: 1,
          }}
        >
          {label}
        </motion.span>
      </AnimatePresence>

      {/* Update progress */}
      <AnimatePresence>
        {(updateStatus.state === "downloading" || updateStatus.state === "ready" || updateStatus.state === "error") && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={fade}
            onClick={() => {
              if (updateStatus.state === "ready") window.doppel?.installUpdate();
            }}
            style={{
              marginTop: 2,
              marginBottom: 1,
              width: 48,
              cursor: updateStatus.state === "ready" ? "pointer" : "default",
              WebkitAppRegion: "no-drag",
            } as React.CSSProperties}
          >
            {updateStatus.state === "downloading" && (
              <>
                <div
                  style={{
                    height: 2,
                    borderRadius: 1,
                    background: "rgba(100, 116, 139, 0.25)",
                    overflow: "hidden",
                  }}
                >
                  <motion.div
                    animate={{ width: `${updateStatus.progress ?? 0}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    style={{
                      height: "100%",
                      borderRadius: 1,
                      background: "var(--primary)",
                    }}
                  />
                </div>
                <span
                  style={{
                    display: "block",
                    textAlign: "center",
                    fontSize: 7,
                    color: "var(--slate)",
                    marginTop: 1,
                    letterSpacing: "0.04em",
                  }}
                >
                  {updateStatus.progress ?? 0}%
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
                  fontSize: 7,
                  color: "var(--primary)",
                  letterSpacing: "0.04em",
                }}
              >
                restart
              </motion.span>
            )}
            {updateStatus.state === "error" && (
              <span
                style={{
                  display: "block",
                  textAlign: "center",
                  fontSize: 7,
                  color: "#ef4444",
                  letterSpacing: "0.03em",
                }}
                title={updateStatus.detail ?? ""}
              >
                failed
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes corner-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
