"use client";

/**
 * The interface's heartbeat. A soft blue radial glow breathing on a four
 * second cycle — never spinning, never bouncing. When observation is paused
 * it drains to slate and holds perfectly still, and that stillness is meant
 * to be the most noticeable thing on the screen.
 */
export function Pulse({
  size = 120,
  paused = false,
  className = "",
}: {
  size?: number;
  paused?: boolean;
  className?: string;
}) {
  const colour = paused ? "var(--slate-glow)" : "var(--primary-glow)";
  const core = paused ? "var(--slate)" : "var(--primary)";

  return (
    <div
      className={`relative grid place-items-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* outer breath */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${colour} 0%, transparent 68%)`,
          animation: paused ? "none" : `doppel-breathe var(--pulse-cycle) var(--ease-calm) infinite`,
          opacity: paused ? 0.32 : undefined,
        }}
      />
      {/* inner breath, half a beat behind */}
      <div
        className="absolute rounded-full"
        style={{
          width: size * 0.55,
          height: size * 0.55,
          background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
          animation: paused
            ? "none"
            : `doppel-breathe calc(var(--pulse-cycle) * 1.35) var(--ease-calm) -1.2s infinite`,
          opacity: paused ? 0.24 : undefined,
        }}
      />
      {/* the core */}
      <div
        className="relative rounded-full"
        style={{
          width: Math.max(6, size * 0.075),
          height: Math.max(6, size * 0.075),
          background: core,
          opacity: paused ? 0.45 : 0.9,
          transition: "background var(--dur-fade) var(--ease-calm), opacity var(--dur-fade)",
        }}
      />
    </div>
  );
}
