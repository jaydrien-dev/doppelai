"use client";

import Link from "next/link";

/**
 * Shown inline when a feature is gated behind the Pro plan.
 * Compact enough to drop into any section without disrupting the layout.
 */
export function UpgradePrompt({
  feature,
  compact = false,
}: {
  feature: string;
  compact?: boolean;
}) {
  const labels: Record<string, string> = {
    "brain:export": "Brain export",
    "brain:import": "Brain import",
    "brain:ingest": "Document ingestion",
    "profile:generate": "User profile",
    "profile:get": "User profile",
    "workflow:create": "Workflows",
    "nudge:evaluate": "Nudges",
    "guide:walkthrough": "Walkthroughs",
    "mcp:serve": "MCP server",
  };

  const name = labels[feature] ?? feature;

  if (compact) {
    return (
      <Link
        href="/billing"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 8,
          background: "rgba(99, 102, 241, 0.08)",
          color: "var(--primary)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        Upgrade to unlock {name}
      </Link>
    );
  }

  return (
    <div
      style={{
        padding: "20px 24px",
        borderRadius: 12,
        background: "var(--surface)",
        boxShadow: "var(--elev-raised-sm)",
        borderLeft: "3px solid var(--primary)",
      }}
    >
      <p style={{ fontWeight: 600, fontSize: "var(--text-body)" }}>
        {name} is a Pro feature
      </p>
      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--slate)",
          marginTop: 4,
        }}
      >
        Upgrade to Pro for unlimited access to all of Doppel&apos;s capabilities.
      </p>
      <Link
        href="/billing"
        className="pressable"
        style={{
          display: "inline-block",
          marginTop: 12,
          padding: "10px 20px",
          borderRadius: 8,
          background: "var(--primary)",
          color: "var(--surface)",
          fontWeight: 600,
          fontSize: "var(--text-sm)",
          textDecoration: "none",
          boxShadow: "-4px -4px 10px var(--shadow-light), 5px 5px 12px var(--primary-glow)",
        }}
      >
        Upgrade to Pro — $20/mo
      </Link>
    </div>
  );
}
