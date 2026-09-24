"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel } from "@/lib/store";
import type { Bot, BotDetail, BotStep } from "@/lib/types";

const smooth = { type: "spring", stiffness: 400, damping: 30, mass: 0.6 } as const;
const fade = { duration: 0.18, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * Task popup — a small floating panel in the top-right corner.
 * Auto-shown when a bot starts, auto-hidden when all finish.
 * Shows active tasks, step logs, and clarification questions.
 */
export default function TasksPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<BotStep[]>([]);

  useEffect(() => {
    document.documentElement.classList.add("tasks-popup");
    return () => document.documentElement.classList.remove("tasks-popup");
  }, []);

  /* Load initial bot list + subscribe to updates */
  useEffect(() => {
    const api = window.doppel;
    if (!api) return;

    api.computerList?.().then((list: Bot[]) => setBots(list));

    const unsub = api.onBotUpdate?.((bot: Bot) => {
      setBots((prev) => {
        const idx = prev.findIndex((b) => b.id === bot.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = bot; return next; }
        return [...prev, bot];
      });
    });

    return () => unsub?.();
  }, []);

  /* Auto-expand the latest active bot */
  useEffect(() => {
    const active = bots.find((b) => b.status === "running" || b.status === "clarifying");
    if (active && expandedId !== active.id) {
      setExpandedId(active.id);
      doppel.computerStatus(active.id).then((d: BotDetail | null) => {
        setExpandedSteps(d?.steps ?? []);
      });
    }
  }, [bots, expandedId]);

  /* Refresh steps for expanded bot on every update */
  useEffect(() => {
    if (!expandedId) return;
    doppel.computerStatus(expandedId).then((d: BotDetail | null) => {
      setExpandedSteps(d?.steps ?? []);
    });
  }, [expandedId, bots]);

  /* Visible bots: active + recently finished (within 30s) */
  const visible = bots.filter((b) =>
    b.status === "running" || b.status === "clarifying" ||
    ((b.status === "done" || b.status === "failed" || b.status === "stopped") &&
      b.completedAt && Date.now() - b.completedAt < 30000),
  );

  const clarifying = bots.filter((b) => b.status === "clarifying" && b.question);

  /* Tell main process to hide when nothing to show */
  useEffect(() => {
    if (visible.length === 0) {
      window.doppel?.taskPopupEmpty?.();
    }
  }, [visible.length]);

  if (visible.length === 0) {
    return <div className="h-dvh w-full" style={{ background: "transparent" }} />;
  }

  return (
    <div
      className="flex h-dvh w-full flex-col select-none"
      style={{
        background: "transparent",
        padding: 8,
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={smooth}
        style={{
          background: "rgba(15, 23, 42, 0.92)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.25), 0 1px 4px rgba(0, 0, 0, 0.15)",
          padding: "10px 14px",
          maxHeight: "100%",
          overflowY: "auto",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "rgba(226, 232, 240, 0.6)",
          }}>
            Tasks
          </span>
          <span style={{
            fontSize: 10, color: "rgba(226, 232, 240, 0.4)",
          }}>
            {visible.filter((b) => b.status === "running").length} active
          </span>
        </div>

        {/* Clarification questions */}
        <AnimatePresence>
          {clarifying.map((bot) => (
            <motion.div
              key={`q-${bot.id}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={fade}
              style={{
                marginBottom: 8,
                borderRadius: 8,
                background: "rgba(37, 99, 235, 0.15)",
                borderLeft: "3px solid rgba(96, 165, 250, 0.7)",
                padding: "8px 10px",
                overflow: "hidden",
              }}
            >
              <p style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "rgba(96, 165, 250, 0.8)",
                marginBottom: 4,
              }}>
                Needs your input
              </p>
              <p style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 6, lineHeight: 1.4 }}>
                {bot.question}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyInputs[bot.id] ?? ""}
                  onChange={(e) => setReplyInputs((p) => ({ ...p, [bot.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const ans = replyInputs[bot.id]?.trim();
                      if (ans) {
                        doppel.computerRespond(bot.id, ans);
                        setReplyInputs((p) => { const n = { ...p }; delete n[bot.id]; return n; });
                      }
                    }
                  }}
                  placeholder="Your answer..."
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.08)",
                    fontSize: 12,
                    color: "#e2e8f0",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => {
                    const ans = replyInputs[bot.id]?.trim();
                    if (ans) {
                      doppel.computerRespond(bot.id, ans);
                      setReplyInputs((p) => { const n = { ...p }; delete n[bot.id]; return n; });
                    }
                  }}
                  className="cursor-pointer"
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    background: "rgba(96, 165, 250, 0.9)",
                    color: "white",
                    fontSize: 11,
                    fontWeight: 600,
                    border: "none",
                  }}
                >
                  Reply
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Task list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {visible.map((bot) => {
            const isDone = bot.status === "done";
            const isFailed = bot.status === "failed" || bot.status === "stopped";
            const isActive = bot.status === "running" || bot.status === "clarifying";
            const isExpanded = expandedId === bot.id;

            return (
              <div key={bot.id}>
                <div
                  onClick={async () => {
                    if (isExpanded) {
                      setExpandedId(null);
                      setExpandedSteps([]);
                    } else {
                      const detail: BotDetail | null = await doppel.computerStatus(bot.id);
                      setExpandedId(bot.id);
                      setExpandedSteps(detail?.steps ?? []);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    padding: "4px 0",
                  }}
                >
                  {/* Status dot */}
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: isDone ? "#22c55e" : isFailed ? "#ef4444"
                      : bot.status === "clarifying" ? "#60a5fa" : "#f59e0b",
                    animation: isActive ? "task-pulse 2s ease-in-out infinite" : "none",
                  }} />

                  {/* Goal text */}
                  <span style={{
                    flex: 1, fontSize: 12, lineHeight: 1.3,
                    color: isDone ? "#4ade80" : isFailed ? "#f87171" : "#e2e8f0",
                    fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {(isDone || isFailed) && bot.result
                      ? bot.result.split("\n")[0]
                      : bot.goal.length > 45 ? bot.goal.slice(0, 42) + "..." : bot.goal}
                  </span>

                  {/* Step count */}
                  <span style={{ fontSize: 10, color: "rgba(226, 232, 240, 0.5)", flexShrink: 0 }}>
                    {bot.stepCount} {bot.stepCount === 1 ? "step" : "steps"}
                    {" "}{isExpanded ? "\u25B2" : "\u25BC"}
                  </span>
                </div>

                {/* Current action label */}
                {isActive && bot.currentAction && (
                  <p style={{
                    fontSize: 11, color: "rgba(226, 232, 240, 0.5)",
                    marginLeft: 14, marginTop: -2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {bot.currentAction}
                  </p>
                )}

                {/* Expanded step log */}
                <AnimatePresence>
                  {isExpanded && expandedSteps.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={fade}
                      style={{
                        marginTop: 4, marginLeft: 14,
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: "rgba(255, 255, 255, 0.04)",
                        maxHeight: 200,
                        overflowY: "auto",
                        overflow: "hidden",
                      }}
                    >
                      {expandedSteps.map((step, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "baseline", gap: 6,
                          padding: "2px 0", fontSize: 11,
                        }}>
                          <span style={{
                            color: "rgba(226, 232, 240, 0.3)", fontSize: 9,
                            minWidth: 14, textAlign: "right", flexShrink: 0,
                          }}>
                            {i + 1}
                          </span>
                          <span style={{
                            fontWeight: 600, flexShrink: 0,
                            color: step.action === "done" ? "#4ade80"
                              : step.action === "failed" || step.action === "aborted" ? "#f87171"
                              : step.action === "skipped" ? "#fbbf24"
                              : "#60a5fa",
                          }}>
                            {step.action}
                          </span>
                          {step.target && (
                            <span style={{
                              color: "rgba(226, 232, 240, 0.4)", flexShrink: 0,
                              maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {step.target}
                            </span>
                          )}
                          {step.detail && (
                            <span style={{
                              color: "rgba(226, 232, 240, 0.3)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {step.detail}
                            </span>
                          )}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </motion.div>

      <style>{`
        @keyframes task-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
