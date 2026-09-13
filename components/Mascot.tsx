"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

export type Mood = "idle" | "watching" | "working" | "unsure" | "paused" | "pleased";

const SIZES = {
  sm: 30,
  md: 44,
  lg: 76,
} as const;

export type MascotSize = keyof typeof SIZES;

/**
 * Doppel itself. A small soft creature pressed out of the same surface as
 * everything else — one blue visor, two nubs, a shadow it never quite lands on.
 *
 * Pass `layoutId` and render it inside whichever app tile it is working in;
 * Framer's layout animation then carries it across the screen from one app to
 * the next, which is the whole trick.
 */
export function Mascot({
  mood = "idle",
  size = "md",
  layoutId,
  className = "",
}: {
  mood?: Mood;
  size?: MascotSize;
  layoutId?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const px = SIZES[size];
  const blink = useBlink(mood !== "paused" && !reduced);

  const still = reduced || mood === "paused";
  const asleep = mood === "paused";

  /* How much it bobs, and how quickly. */
  const bob =
    mood === "working" ? 3.5 : mood === "unsure" ? 1.5 : mood === "pleased" ? 5 : 2.5;
  const period = mood === "working" ? 1.9 : mood === "pleased" ? 1.1 : 3.4;

  const tilt = mood === "unsure" ? -11 : mood === "working" ? 3 : 0;

  /* Where it's looking. */
  const gaze =
    mood === "watching" ? 1 : mood === "unsure" ? -1.6 : mood === "working" ? 0.9 : 0;

  const eyeOpen = asleep ? 0.12 : blink ? 0.1 : mood === "working" ? 0.62 : mood === "unsure" ? 0.5 : 1;

  return (
    <motion.div
      layoutId={layoutId}
      className={`relative shrink-0 ${className}`}
      style={{ width: px, height: px * 1.06 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, mass: 0.9 }}
    >
      {/* the ground shadow it hovers above */}
      <motion.div
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 rounded-[50%]"
        style={{
          bottom: -px * 0.1,
          width: px * 0.62,
          height: px * 0.13,
          background: asleep ? "var(--slate-glow)" : "var(--primary-glow-soft)",
          filter: "blur(3px)",
        }}
        animate={still ? {} : { scaleX: [1, 0.86, 1], opacity: [0.9, 0.6, 0.9] }}
        transition={{ duration: period, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* the body */}
      <motion.div
        className="relative h-full w-full"
        animate={still ? { y: 0, rotate: tilt } : { y: [0, -bob, 0], rotate: tilt }}
        transition={{
          y: { duration: period, repeat: Infinity, ease: "easeInOut" },
          rotate: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] },
        }}
      >
        {/* antenna */}
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: -px * 0.17, width: 1.5, height: px * 0.17, background: "var(--shadow-dark)" }}
        />
        <motion.div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{
            top: -px * 0.24,
            width: px * 0.13,
            height: px * 0.13,
            background: asleep ? "var(--slate)" : "var(--primary)",
          }}
          animate={
            still
              ? { opacity: 0.5, boxShadow: "0 0 0 0 var(--primary-glow)" }
              : {
                  opacity: [0.55, 1, 0.55],
                  boxShadow: [
                    "0 0 0 0 var(--primary-glow)",
                    `0 0 ${px * 0.22}px ${px * 0.05}px var(--primary-glow)`,
                    "0 0 0 0 var(--primary-glow)",
                  ],
                }
          }
          transition={{ duration: mood === "working" ? 1.4 : 4, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* the pebble */}
        <div
          className="absolute inset-0"
          style={{
            background: "var(--surface)",
            borderRadius: "46% 46% 40% 40% / 52% 52% 48% 48%",
            boxShadow: asleep
              ? "-2px -2px 6px var(--shadow-light), 2px 2px 6px var(--shadow-dark)"
              : "var(--elev-raised-sm)",
            filter: asleep ? "saturate(0)" : undefined,
            transition: "filter var(--dur-fade) var(--ease-calm)",
          }}
        />

        {/* the face */}
        <div className="absolute inset-0 grid place-items-center">
          <motion.div
            className="relative"
            style={{ width: px * 0.5, height: px * 0.2 }}
            animate={{ x: gaze * px * 0.045 }}
            transition={{ duration: 1.6, ease: "easeInOut" }}
          >
            {mood === "pleased" ? (
              /* pleased: the visor curves up */
              <svg viewBox="0 0 40 16" className="h-full w-full" aria-hidden>
                <path
                  d="M4 12 C 10 3, 30 3, 36 12"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <motion.div
                className="h-full w-full origin-center"
                style={{
                  background: asleep ? "var(--slate)" : "var(--primary)",
                  borderRadius: "var(--radius-pill)",
                  opacity: asleep ? 0.45 : 1,
                }}
                animate={{ scaleY: eyeOpen }}
                transition={{ duration: blink ? 0.09 : 0.35, ease: "easeInOut" }}
              />
            )}

            {/* the unsure routine gets a single questioning dot */}
            {mood === "unsure" && (
              <motion.div
                className="absolute rounded-full"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  right: -px * 0.16,
                  top: -px * 0.18,
                  width: px * 0.09,
                  height: px * 0.09,
                  background: "var(--primary)",
                }}
              />
            )}
          </motion.div>
        </div>
      </motion.div>

      {/* working ring — a soft outward breath while it's mid-step */}
      {mood === "working" && !reduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[50%]"
          style={{
            boxShadow: "0 0 0 1.5px var(--primary-glow)",
            animation: "doppel-ring 2.4s var(--ease-calm) infinite",
          }}
        />
      )}
    </motion.div>
  );
}

/** A blink every few seconds, off a fixed rhythm rather than randomness. */
function useBlink(active: boolean) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const cycle = (wait: number) => {
      timer = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        timer = setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          cycle(wait === 3800 ? 5200 : 3800);
        }, 130);
      }, wait);
    };
    cycle(3800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active]);
  return blink;
}
