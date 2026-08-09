"use client";

import { MotionConfig } from "framer-motion";

/**
 * One place to honour `prefers-reduced-motion`. With it set, Framer stops
 * animating transforms and opacity across the whole app, the CSS in
 * globals.css freezes the keyframe animations, and the pulse holds steady —
 * everything stays usable, nothing moves.
 */
export function Motion({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ ease: [0.22, 0.61, 0.36, 1] }}>
      {children}
    </MotionConfig>
  );
}
