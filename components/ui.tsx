"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "quiet" | "ghost";

const base =
  "pressable inline-flex items-center justify-center gap-2 font-medium select-none cursor-pointer disabled:cursor-default";

function variantStyle(variant: Variant): React.CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: "var(--primary)",
        color: "var(--surface)",
        boxShadow: "-4px -4px 10px var(--shadow-light), 5px 5px 12px var(--primary-glow)",
      };
    case "quiet":
      return {
        background: "var(--surface)",
        color: "var(--ink)",
        boxShadow: "var(--elev-raised-sm)",
      };
    case "ghost":
      return { background: "transparent", color: "var(--slate)", boxShadow: "none" };
  }
}

const sizeStyle = {
  sm: { padding: "8px 14px", fontSize: "var(--text-sm)", borderRadius: "var(--radius-control)" },
  md: { padding: "12px 22px", fontSize: "var(--text-body)", borderRadius: "var(--radius-control)" },
  lg: { padding: "16px 30px", fontSize: "var(--text-body)", borderRadius: "var(--radius-card-sm)" },
} as const;

export function Button({
  variant = "quiet",
  size = "md",
  style,
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizeStyle }) {
  return (
    <button
      {...props}
      className={`${base} ${className}`}
      style={{ ...variantStyle(variant), ...sizeStyle[size], ...style }}
    />
  );
}

export function ButtonLink({
  variant = "quiet",
  size = "md",
  style,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizeStyle }) {
  return (
    <Link
      {...props}
      className={`${base} ${className}`}
      style={{ ...variantStyle(variant), ...sizeStyle[size], ...style }}
    />
  );
}

/** A pill of metadata. Never coloured by status — that job belongs to elevation. */
export function Chip({
  children,
  tone = "quiet",
}: {
  children: ReactNode;
  tone?: "quiet" | "agent";
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      style={{
        padding: "5px 12px",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-micro)",
        fontWeight: 500,
        letterSpacing: "var(--tracking-wide)",
        textTransform: "uppercase",
        color: tone === "agent" ? "var(--primary)" : "var(--slate)",
        background: tone === "agent" ? "var(--primary-soft)" : "var(--bg-base)",
        boxShadow: tone === "agent" ? "none" : "var(--elev-pressed-sm)",
      }}
    >
      {children}
    </span>
  );
}

/** A block of Mimic's own speech. Always on the soft blue wash. */
export function AgentLine({
  children,
  size = "body",
  className = "",
}: {
  children: ReactNode;
  size?: "body" | "title" | "display";
  className?: string;
}) {
  return (
    <p
      className={`agent-voice ${className}`}
      style={{
        fontSize:
          size === "display"
            ? "var(--text-display)"
            : size === "title"
              ? "var(--text-title)"
              : "var(--text-body)",
        fontWeight: size === "body" ? 400 : 600,
        letterSpacing: size === "body" ? undefined : "var(--tracking-tight)",
      }}
    >
      {children}
    </p>
  );
}

export function AgentNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="agent-voice"
      style={{
        background: "var(--primary-soft)",
        borderRadius: "var(--radius-card-sm)",
        padding: "14px 18px",
        fontSize: "var(--text-sm)",
        color: "var(--ink)",
      }}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <div className="mb-5 flex items-baseline gap-3">
      <h2 className="micro-label">{children}</h2>
      {count !== undefined && (
        <span
          className="tabular-nums"
          style={{ color: "var(--slate)", fontSize: "var(--text-micro)", opacity: 0.7 }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

/** A soft toggle. Pressed when off, raised knob, blue when on. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="pressable relative shrink-0 cursor-pointer"
      style={{
        width: 52,
        height: 30,
        borderRadius: "var(--radius-pill)",
        background: checked ? "var(--primary)" : "var(--bg-base)",
        boxShadow: checked
          ? `inset 0 0 8px var(--primary-glow)`
          : "var(--elev-pressed-sm)",
        transition: "background var(--dur-fade) var(--ease-calm)",
      }}
    >
      <span
        className="absolute top-1/2 block -translate-y-1/2 rounded-full"
        style={{
          width: 22,
          height: 22,
          left: checked ? 26 : 4,
          background: "var(--surface)",
          boxShadow: "-2px -2px 4px var(--shadow-light), 2px 2px 5px var(--shadow-dark)",
          transition: "left var(--dur-fade) var(--ease-calm)",
        }}
      />
    </button>
  );
}
