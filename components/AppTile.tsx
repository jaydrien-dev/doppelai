"use client";

import { AppGlyph } from "./AppGlyph";
import { APPS } from "@/lib/apps";
import type { AppId } from "@/lib/types";
import { Mascot, type Mood } from "./Mascot";

/**
 * A window Doppel can be inside. The mascot perches on top of whichever one is
 * active — pass `perch` and Framer carries it here from wherever it was.
 */
export function AppTile({
  app,
  state = "idle",
  perch,
  perchMood = "working",
  size = 52,
  showLabel = true,
}: {
  app: AppId;
  state?: "idle" | "active" | "done";
  perch?: boolean;
  perchMood?: Mood;
  size?: number;
  showLabel?: boolean;
}) {
  const active = state === "active";

  return (
    <div className="relative flex flex-col items-center gap-2">
      {/* the mascot's perch — sits above the tile, never inside it */}
      <div
        className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2"
        style={{ bottom: size - 6 }}
      >
        {perch && <Mascot layoutId="doppel-mascot" mood={perchMood} size="sm" />}
      </div>

      <div
        className="grid place-items-center"
        style={{
          width: size,
          height: size,
          borderRadius: "var(--radius-control)",
          background: active ? "var(--primary-soft)" : "var(--bg-base)",
          boxShadow: active
            ? "var(--elev-raised-sm)"
            : state === "done"
              ? "none"
              : "var(--elev-pressed-sm)",
          color: active ? "var(--primary)" : "var(--slate)",
          opacity: state === "done" ? 0.45 : 1,
          transition:
            "background var(--dur-fade) var(--ease-calm), box-shadow var(--dur-fade) var(--ease-calm), color var(--dur-fade)",
        }}
      >
        <AppGlyph app={app} size={size * 0.42} />
      </div>

      {showLabel && (
        <span
          className="micro-label"
          style={{ color: active ? "var(--primary)" : "var(--slate)" }}
        >
          {APPS[app].short}
        </span>
      )}
    </div>
  );
}
