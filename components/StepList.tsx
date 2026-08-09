"use client";

import { AppGlyph } from "./AppGlyph";
import { HARD_RULE_LABEL, type Routine } from "@/lib/types";
import { actionSummary, planFor } from "@/lib/plan";

/**
 * The plan for the next run, in plain language — derived from the intent and
 * everything the user has taught it. Each line also states, quietly, the real
 * thing it would do, because nothing here is illustrative.
 */
export function StepList({
  routine,
  compact = false,
}: {
  routine: Routine;
  compact?: boolean;
}) {
  const steps = planFor(routine);

  if (steps.length === 0) {
    return (
      <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
        I haven&rsquo;t worked out any steps for this yet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col" style={{ gap: compact ? 14 : 20 }}>
      {steps.map((step, i) => {
        const skipped = routine.skipped?.includes(step.id);
        return (
          <li key={step.id} className="flex gap-4" style={{ opacity: skipped ? 0.4 : 1 }}>
            <span
              className="shrink-0 pt-0.5 tabular-nums"
              style={{ fontSize: "var(--text-sm)", color: "var(--slate)", minWidth: 18 }}
            >
              {i + 1}
            </span>

            <span
              className="grid shrink-0 place-items-center"
              style={{
                width: 34,
                height: 34,
                borderRadius: "var(--radius-control)",
                background: "var(--bg-base)",
                boxShadow: "var(--elev-pressed-sm)",
                color: "var(--slate)",
              }}
            >
              <AppGlyph app={step.app} size={18} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  style={{
                    fontSize: "var(--text-body)",
                    color: "var(--ink)",
                    textDecoration: skipped ? "line-through" : undefined,
                  }}
                >
                  {step.label}
                </span>
                {skipped ? (
                  <span className="micro-label">left alone</span>
                ) : step.certainty === "guessing" ? (
                  <span className="micro-label">a guess</span>
                ) : null}
              </span>

              {!compact && (
                <>
                  <span
                    className="mt-0.5 block"
                    style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                  >
                    {step.detail}
                  </span>
                  <span
                    className="mt-1 block font-mono"
                    style={{ fontSize: "var(--text-micro)", color: "var(--slate)", opacity: 0.8 }}
                  >
                    {actionSummary(step)}
                  </span>
                </>
              )}

              {step.hardRule && !compact && (
                <span
                  className="mt-2 inline-flex items-center"
                  style={{
                    padding: "4px 12px",
                    borderRadius: "var(--radius-pill)",
                    background: "var(--primary-soft)",
                    color: "var(--primary)",
                    fontSize: "var(--text-micro)",
                    fontWeight: 500,
                    letterSpacing: "var(--tracking-wide)",
                    textTransform: "uppercase",
                  }}
                >
                  always asks &middot; {HARD_RULE_LABEL[step.hardRule]}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
