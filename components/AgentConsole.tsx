"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { formatDuration } from "@/lib/time";
import { Pulse } from "./Pulse";
import { Mascot } from "./Mascot";
import { Button } from "./ui";

/**
 * Ask Doppel to do something, and watch it do it.
 *
 * Multiple background tasks can run concurrently. The console shows all of
 * them, with approval controls for any that are parked.
 */
export function AgentConsole() {
  const agents = useDoppel((s) => s.agents);
  const ai = useDoppel((s) => s.ai);
  const canDrive = useDoppel((s) => s.permissions.actGui);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);

  const anyBusy = agents.some((t) => ["running", "parked", "stopping"].includes(t.status));

  const go = async () => {
    if (!instruction.trim()) return;
    setError(null);
    const text = instruction;
    setInstruction("");
    const result = await doppel.runAgent({ instruction: text });
    if (!result?.ok) {
      setError(
        result?.reason === "no-key"
          ? voice.agent.needsKey
          : (result?.detail ?? "I couldn't start."),
      );
      setInstruction(text);
    }
  };

  return (
    <div className="raised" style={{ padding: 28 }}>
      <div className="flex items-start gap-4">
        <Mascot mood={anyBusy ? "working" : "idle"} size="md" />
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>{voice.agent.title}</p>
          <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
            {voice.agent.intro}
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder={voice.agent.placeholder}
          className="min-w-0 flex-1"
          style={{
            padding: "13px 16px",
            borderRadius: "var(--radius-control)",
            background: "var(--bg-base)",
            boxShadow: "var(--elev-pressed-sm)",
            fontSize: "var(--text-sm)",
            color: "var(--ink)",
          }}
        />
        <Button variant="primary" onClick={go} disabled={!instruction.trim() || !ai.configured}>
          {voice.agent.go}
        </Button>
        {anyBusy && (
          <Button onClick={() => doppel.abortAgent()}>
            Stop all
          </Button>
        )}
      </div>

      {!canDrive && (
        <p className="agent-voice mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          Background mode — I'll use the file system and command line. For tasks that need the screen, switch on GUI in Permissions.
        </p>
      )}
      {error && (
        <p className="agent-voice mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}>
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------ live */}
      <AnimatePresence>
        {agents.map((task) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-8 pt-8" style={{ boxShadow: "inset 0 1px 0 var(--ink-soft)" }}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p style={{ fontWeight: 600, letterSpacing: "var(--tracking-tight)" }}>
                  {task.title}
                </p>
                <span className="flex items-center gap-3">
                  {task.status === "running" && <Pulse size={28} className="-m-1" />}
                  <span className="micro-label">
                    {task.mode === "background" ? "background · " : "screen · "}
                    {task.status === "running"
                      ? voice.agent.running(task.step)
                      : task.status === "parked"
                        ? "waiting on you"
                        : task.status}
                  </span>
                  {task.status === "running" && (
                    <button
                      onClick={() => doppel.abortAgent(task.id)}
                      className="cursor-pointer micro-label"
                      style={{ color: "var(--slate)" }}
                    >
                      stop
                    </button>
                  )}
                </span>
              </div>

              {task.recalled > 0 && (
                <p className="micro-label mt-3">{voice.agent.recalled(task.recalled)}</p>
              )}

              {task.narration.length > 0 && (
                <ul className="mt-6 flex flex-col gap-3">
                  {task.narration.slice(-8).map((line, i) => (
                    <li key={`${line.at}-${i}`} className="agent-voice" style={{ fontSize: "var(--text-sm)" }}>
                      {line.text}
                    </li>
                  ))}
                </ul>
              )}

              {task.parked && (
                <div
                  className="agent-voice mt-6"
                  style={{
                    background: "var(--primary-soft)",
                    borderRadius: "var(--radius-card-sm)",
                    padding: "18px 22px",
                  }}
                >
                  <p style={{ fontWeight: 600, color: "var(--primary)" }}>
                    {voice.agent.parkedTitle}
                  </p>
                  <p className="mt-2">{task.parked.rule}</p>
                  <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                    {task.parked.detail}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button variant="primary" size="sm" onClick={() => doppel.answerAgent(task.id, "approve")}>
                      {voice.agent.approve}
                    </Button>
                    <Button size="sm" onClick={() => doppel.answerAgent(task.id, "skip")}>
                      {voice.agent.skip}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => doppel.answerAgent(task.id, "stop")}>
                      {voice.agent.abandon}
                    </Button>
                  </div>
                </div>
              )}

              {task.summary && (
                <div className="pressed mt-7" style={{ padding: 24 }}>
                  <p style={{ fontWeight: 600 }}>
                    {task.summary.outcome === "done"
                      ? voice.agent.doneTitle
                      : voice.agent.stoppedTitle}
                  </p>
                  <p className="agent-voice mt-2">{task.summary.text}</p>

                  <p className="micro-label mt-5">{voice.agent.changedLabel}</p>
                  {task.summary.changed.length === 0 ? (
                    <p className="mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                      {voice.agent.nothingChanged}
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1">
                      {task.summary.changed.slice(0, 12).map((c, i) => (
                        <li
                          key={`${c}-${i}`}
                          style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                        >
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}

                  {task.summary.incomplete.length > 0 && (
                    <>
                      <p className="micro-label mt-5">{voice.agent.incompleteLabel}</p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {task.summary.incomplete.map((c, i) => (
                          <li
                            key={`${c}-${i}`}
                            style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                          >
                            {c}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <p className="micro-label mt-6">
                    {formatDuration(task.summary.durationSec)} &middot; {task.summary.steps} steps
                  </p>

                  {task.irreversible && (
                    <p
                      className="agent-voice mt-4"
                      style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                    >
                      {voice.agent.irreversible}
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
