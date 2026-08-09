"use client";

import { ago } from "@/lib/time";

/**
 * How sure Mimic became, over time. A single line in an inset channel — the
 * steps are visible because confidence arrives in jumps, never in a slope.
 */
export function ConfidenceChart({
  points,
  now,
}: {
  points: { at: number; value: number }[];
  now: number;
}) {
  if (points.length < 2) {
    return (
      <div className="pressed" style={{ padding: 26 }}>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          Not much history yet.
        </p>
      </div>
    );
  }

  const W = 100;
  const H = 40;
  const first = points[0].at;
  const last = points[points.length - 1].at;
  const span = Math.max(1, last - first);

  const coords = points.map((p) => ({
    x: ((p.at - first) / span) * W,
    y: H - (p.value / 100) * H,
    ...p,
  }));

  // Stepped, because that is honestly how it moves.
  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    d += ` L ${coords[i].x} ${coords[i - 1].y} L ${coords[i].x} ${coords[i].y}`;
  }

  return (
    <div className="pressed" style={{ padding: 26 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: 96 }}
        aria-label="Confidence over time"
      >
        <path
          d={d}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={1.2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-4 flex items-baseline justify-between">
        <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {points[0].value}% &middot; {ago(first, now)}
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {points[points.length - 1].value}% &middot; {ago(last, now)}
        </span>
      </div>
    </div>
  );
}
