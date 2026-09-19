"use client";

import { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * The guide overlay — a fullscreen transparent layer that renders:
 *   - A pulsing ring at target coordinates (the "pointer")
 *   - An animated arrow pointing at the ring
 *   - An instruction bubble near the target
 *
 * This window is click-through (setIgnoreMouseEvents) so the user can
 * interact with the app underneath while the guide points at things.
 */

interface GuidePoint {
  x: number;
  y: number;
  instruction: string;
  step: number | null;
  total: number | null;
  action: string | null;
}

interface WalkthroughState {
  active: boolean;
  goal?: string;
  step?: number;
  total?: number;
  instruction?: string;
  reason?: string;
}

export default function GuidePage() {
  const [point, setPoint] = useState<GuidePoint | null>(null);
  const [walkthrough, setWalkthrough] = useState<WalkthroughState>({ active: false });
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("guide");

    const handlePoint = (data: unknown) => {
      const d = data as GuidePoint;
      setPoint(d);
      setShow(true);
      /* Auto-dismiss after 30s if no update. */
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setShow(false), 30000);
    };

    const handleClear = () => {
      setPoint(null);
      setShow(false);
    };

    const handleWalkthrough = (data: unknown) => {
      const d = data as WalkthroughState;
      setWalkthrough(d);
      if (!d.active) {
        setPoint(null);
        setShow(false);
      }
    };

    const handleInstruction = (data: unknown) => {
      const d = data as { instruction: string; step: number; total: number };
      /* Element not found — show floating instruction without pointer. */
      setPoint({ x: window.innerWidth / 2, y: 120, instruction: d.instruction, step: d.step, total: d.total, action: null });
      setShow(true);
    };

    const d = window.doppel;
    const cleanups: (() => void)[] = [];
    if (d?.onGuidePoint) cleanups.push(d.onGuidePoint(handlePoint));
    if (d?.onGuideClear) cleanups.push(d.onGuideClear(handleClear));
    if (d?.onGuideWalkthrough) cleanups.push(d.onGuideWalkthrough(handleWalkthrough));
    if (d?.onGuideInstruction) cleanups.push(d.onGuideInstruction(handleInstruction));

    return () => {
      cleanups.forEach((fn) => fn());
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      document.documentElement.classList.remove("guide");
    };
  }, []);

  if (!show || !point) return null;

  /* Position the instruction bubble.  If the target is in the top half,
     put the bubble below; otherwise above.  Horizontally, clamp to screen. */
  const bubbleAbove = point.y > window.innerHeight * 0.5;
  const bubbleY = bubbleAbove ? point.y - 80 : point.y + 80;
  const bubbleX = Math.max(140, Math.min(window.innerWidth - 140, point.x));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 99999,
      }}
    >
      <AnimatePresence>
        {show && (
          <>
            {/* Pulsing ring — the pointer */}
            <motion.div
              key="ring"
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.3 }}
              transition={{ duration: 0.35, ease: [0.22, 0.68, 0, 1] }}
              style={{
                position: "absolute",
                left: point.x - 24,
                top: point.y - 24,
                width: 48,
                height: 48,
                borderRadius: "50%",
                border: "3px solid rgba(99, 102, 241, 0.9)",
                boxShadow: "0 0 24px rgba(99, 102, 241, 0.4), 0 0 48px rgba(99, 102, 241, 0.15)",
              }}
            >
              {/* Pulsing animation */}
              <motion.div
                animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  position: "absolute",
                  inset: -4,
                  borderRadius: "50%",
                  border: "2px solid rgba(99, 102, 241, 0.5)",
                }}
              />
              {/* Center dot */}
              <motion.div
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "rgba(99, 102, 241, 0.9)",
                }}
              />
            </motion.div>

            {/* Arrow line from bubble to ring */}
            <motion.svg
              key="arrow"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.15, duration: 0.25 }}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
              }}
            >
              <line
                x1={bubbleX}
                y1={bubbleY + (bubbleAbove ? 16 : -16)}
                x2={point.x}
                y2={point.y + (bubbleAbove ? -28 : 28)}
                stroke="rgba(99, 102, 241, 0.5)"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            </motion.svg>

            {/* Instruction bubble */}
            <motion.div
              key="bubble"
              initial={{ opacity: 0, y: bubbleAbove ? 12 : -12, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: bubbleAbove ? 12 : -12, scale: 0.92 }}
              transition={{ delay: 0.1, duration: 0.3, ease: [0.22, 0.68, 0, 1] }}
              style={{
                position: "absolute",
                left: bubbleX - 140,
                top: bubbleY - 20,
                width: 280,
                padding: "12px 16px",
                borderRadius: 12,
                background: "rgba(15, 15, 25, 0.88)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(99, 102, 241, 0.2)",
                color: "white",
                textAlign: "center",
              }}
            >
              {point.step != null && point.total != null && (
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "rgba(99, 102, 241, 0.9)",
                  marginBottom: 4,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}>
                  Step {point.step} of {point.total}
                </div>
              )}
              <div style={{
                fontSize: 14,
                lineHeight: 1.4,
                fontWeight: 500,
              }}>
                {point.instruction}
              </div>
              {point.action && (
                <div style={{
                  fontSize: 11,
                  color: "rgba(255, 255, 255, 0.5)",
                  marginTop: 6,
                }}>
                  {point.action === "click" && "Click here"}
                  {point.action === "type" && "Type here"}
                  {point.action === "scroll" && "Scroll here"}
                  {point.action === "hover" && "Hover here"}
                  {point.action === "select" && "Select this"}
                  {point.action === "read" && "Look here"}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
