"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago } from "@/lib/time";
import { describeEvent } from "@/lib/events";
import { Button } from "./ui";

/**
 * A window onto what Mimic is actually seeing.
 *
 * There is nothing to fake any more — no clock to advance, no observation to
 * force — so this shows the raw event stream instead, plus the few levers that
 * are genuinely useful while working on it.
 */
export function DiagnosticsPanel() {
  const open = useMimic((s) => s.panelOpen);
  const setOpen = useMimic((s) => s.setPanelOpen);
  const events = useMimic((s) => s.recentEvents);
  const stats = useMimic((s) => s.stats);
  const now = useMimic((s) => s.now);
  const connected = useMimic((s) => s.connected);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      setOpen(!useMimic.getState().panelOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
            className="fixed bottom-6 right-6 z-[70] w-[320px]"
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--elev-raised-lg)",
              padding: 22,
              maxHeight: "84dvh",
              overflowY: "auto",
            }}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <span className="micro-label">{voice.panel.title}</span>
              <button
                onClick={() => setOpen(false)}
                className="cursor-pointer"
                style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
              >
                hide
              </button>
            </div>
            <p style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}>
              {voice.panel.note}
            </p>

            <div className="pressed mt-5" style={{ padding: 16 }}>
              <p className="micro-label">Seen so far</p>
              <p className="mt-2 tabular-nums" style={{ fontSize: "var(--text-sm)" }}>
                {stats.eventsSeen.toLocaleString()} events &middot; {stats.sessionsSeen} sessions
              </p>
            </div>

            <p className="micro-label mt-6 mb-3">Live</p>
            <ul className="flex flex-col gap-2">
              {events.length === 0 ? (
                <li style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {connected ? voice.permissions.feedEmpty : "Not connected."}
                </li>
              ) : (
                events.slice(0, 9).map((e) => (
                  <li key={e.id} style={{ fontSize: "var(--text-sm)" }}>
                    <span style={{ color: "var(--ink)" }}>{describeEvent(e)}</span>
                    <span className="ml-2" style={{ color: "var(--slate)" }}>
                      {ago(e.at, now)}
                    </span>
                  </li>
                ))
              )}
            </ul>

            <div className="mt-6 flex flex-col gap-2">
              <Button size="sm" onClick={() => mimic.mineNow()}>
                {voice.panel.mine}
              </Button>
              <Button size="sm" onClick={() => mimic.revealTrash()}>
                {voice.panel.trash}
              </Button>
              <Button
                size="sm"
                variant={confirming ? "primary" : "quiet"}
                onClick={() => {
                  if (!confirming) return setConfirming(true);
                  mimic.reset();
                  setConfirming(false);
                }}
              >
                {confirming ? voice.panel.resetConfirm : voice.panel.reset}
              </Button>
            </div>

            <p
              className="mt-4"
              style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}
            >
              {voice.panel.hide}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="pressable fixed bottom-6 right-6 z-[70] cursor-pointer"
          style={{
            padding: "10px 16px",
            borderRadius: "var(--radius-pill)",
            background: "var(--surface)",
            boxShadow: "var(--elev-raised-sm)",
            fontSize: "var(--text-micro)",
            fontWeight: 500,
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            color: "var(--slate)",
          }}
        >
          Seeing
        </button>
      )}
    </>
  );
}
