"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { RunRecord } from "@/lib/types";
import { useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { formatDuration } from "@/lib/time";
import { planFor } from "@/lib/plan";
import { Modal } from "./Modal";
import { AppTile } from "./AppTile";
import { Button } from "./ui";

/**
 * A clean replay of a run that really happened — the thing you send to a
 * colleague who doesn't believe you.
 */
export function RunRecording({
  record,
  open,
  onClose,
}: {
  record: RunRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  const routine = useMimic((s) => s.routines.find((r) => r.id === record?.routineId));
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);

  const steps = routine ? planFor(routine) : [];
  const count = record?.steps.length ?? 0;

  useEffect(() => {
    if (!open || count === 0) return;
    setFrame(0);
    if (reduced) {
      setFrame(count - 1);
      return;
    }
    const t = setInterval(() => setFrame((f) => (f + 1 >= count ? f : f + 1)), 1100);
    return () => clearInterval(t);
  }, [open, count, reduced]);

  if (!record) return null;

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <p className="micro-label">Recording</p>
      <h2 className="mt-2" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
        {record.routineTitle}
      </h2>

      <div className="pressed mt-8" style={{ padding: 28 }}>
        <div className="flex flex-wrap items-end justify-center gap-3">
          {record.steps.map((s, i) => (
            <AppTile
              key={`${s.label}-${i}`}
              app={steps[i]?.app ?? "files"}
              state={i === frame ? "active" : i < frame ? "done" : "idle"}
              perch={i === frame}
              perchMood="working"
              size={46}
              showLabel={false}
            />
          ))}
        </div>

        <p className="agent-voice mt-8 text-center" style={{ fontWeight: 600 }}>
          {record.steps[frame]?.label}
        </p>
        <p
          className="mt-1 text-center tabular-nums"
          style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
        >
          {frame + 1} of {record.steps.length} &middot; {formatDuration(record.durationSec)}
        </p>
      </div>

      {record.changes.length > 0 && (
        <div className="mt-6">
          <p className="micro-label">{voice.run.changesLabel}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {record.changes.map((c, i) => (
              <li key={`${c}-${i}`} style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="primary" className="mt-7" onClick={onClose}>
        {voice.run.close}
      </Button>
    </Modal>
  );
}
