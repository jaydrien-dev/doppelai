"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The most-repeated component in the app.
 *
 * The track is an inset channel cut into the background; the fill is a solid
 * blue bar with a soft inner glow. No stripes, no gradients, no shimmer. The
 * numeral sits outside the bar, in slate, small.
 */
export function ProgressBar({
  value,
  label,
  showValue = true,
  height = 10,
  tone = "primary",
}: {
  value: number;
  label?: string;
  showValue?: boolean;
  height?: number;
  tone?: "primary" | "slate";
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, value));
  const fill = tone === "primary" ? "var(--primary)" : "var(--slate)";
  const glow = tone === "primary" ? "var(--primary-glow)" : "var(--slate-glow)";

  return (
    <div className="w-full">
      {(label || showValue) && (
        <div className="mb-2 flex items-baseline justify-between gap-4">
          {label && <span className="micro-label">{label}</span>}
          {showValue && (
            <span
              className="tabular-nums"
              style={{ color: "var(--slate)", fontSize: "var(--text-sm)" }}
            >
              {Math.round(clamped)}%
            </span>
          )}
        </div>
      )}
      <div
        className="w-full overflow-hidden"
        style={{
          height,
          borderRadius: "var(--radius-pill)",
          background: "var(--bg-base)",
          boxShadow: "var(--elev-pressed-sm)",
        }}
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Confidence"}
      >
        <motion.div
          className="h-full"
          style={{
            borderRadius: "var(--radius-pill)",
            background: fill,
            boxShadow: `inset 0 0 ${height}px ${glow}, 0 0 ${height * 0.8}px ${glow}`,
          }}
          initial={false}
          animate={{ width: `${clamped}%` }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: 0.85, ease: [0.22, 0.61, 0.36, 1] }
          }
        />
      </div>
    </div>
  );
}

/**
 * The proving-run tracker: one pip per required run, filled as they're earned.
 * Deliberately not a percentage — the ladder is countable.
 */
export function RunPips({
  passed,
  required,
  active = false,
}: {
  passed: number;
  required: number;
  active?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`${passed} of ${required} runs proven`}>
      {Array.from({ length: required }).map((_, i) => {
        const done = i < passed;
        const isNext = i === passed && active;
        return (
          <span
            key={i}
            className="block rounded-full"
            style={{
              width: done ? 18 : 8,
              height: 8,
              background: done ? "var(--primary)" : "var(--bg-base)",
              /* The next pip gets a soft halo, never an outline. */
              boxShadow: done
                ? "0 0 6px var(--primary-glow)"
                : isNext
                  ? "var(--elev-pressed-sm), 0 0 0 3px var(--primary-glow-soft)"
                  : "var(--elev-pressed-sm)",
              transition: "width var(--dur-fade) var(--ease-calm)",
            }}
          />
        );
      })}
    </div>
  );
}
