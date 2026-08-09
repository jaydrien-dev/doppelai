"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { mimic, useMimic } from "@/lib/store";
import { voice, HARD_RULE_SENTENCE } from "@/lib/voice";
import { formatDuration } from "@/lib/time";
import { routineHref } from "@/lib/nav";
import { actionSummary, planFor } from "@/lib/plan";
import { HARD_RULE_LABEL, type RoutineStep, type StepState } from "@/lib/types";
import { AppTile } from "./AppTile";
import { Mascot, type Mood } from "./Mascot";
import { Pulse } from "./Pulse";
import { RunPips } from "./ProgressBar";
import { Button } from "./ui";

/**
 * Watching the work happen.
 *
 * Nothing is animated on faith: every step on this screen is a real action
 * against real files, driven by the main process. Pause, step back and correct
 * all apply to work that has genuinely been done — stepping back actually
 * undoes it.
 */
export function RunTheatre({ routineId }: { routineId: string }) {
  const router = useRouter();
  const routine = useMimic((s) => s.routines.find((r) => r.id === routineId));
  const run = useMimic((s) => s.activeRun);
  const ready = useMimic((s) => s.ready);
  const paused = useMimic((s) => s.observation.paused);

  const leaving = useRef(false);
  const started = useRef(false);

  /* One run per visit. */
  useEffect(() => {
    if (!ready || !routine || leaving.current || started.current) return;
    if (!run || run.routineId !== routineId) {
      started.current = true;
      mimic.startRun(routineId);
    }
  }, [ready, routine, run, routineId]);

  const plan = useMemo(() => (routine ? planFor(routine) : []), [routine]);

  if (!routine) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="text-center">
          <p className="agent-voice">I don&rsquo;t have that one any more.</p>
          <Link href="/routines" className="mt-4 inline-block" style={{ color: "var(--primary)" }}>
            Back to routines
          </Link>
        </div>
      </div>
    );
  }

  if (!run || run.routineId !== routineId) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Pulse size={120} />
      </div>
    );
  }

  const active = run.stepIndex >= 0 ? run.order[run.stepIndex] : null;
  const finished = run.status === "finished" || run.status === "stopped";
  const busy = run.status === "running";

  const leave = () => {
    leaving.current = true;
    mimic.abortRun();
    router.push(routineHref(routineId));
  };

  return (
    <div className="min-h-dvh pb-40">
      {/* ------------------------------------------------------------- header */}
      <header
        className="sticky top-0 z-30 px-6 pb-6 pt-12 md:px-12"
        style={{ background: "var(--bg-base)" }}
      >
        <div className="mx-auto flex max-w-[760px] flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="micro-label">
              {run.supervised ? "Supervised run" : "Running with you here"}
            </p>
            <h1 className="mt-2" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
              {routine.title}
            </h1>
            <p
              className="agent-voice mt-1"
              style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
            >
              {routine.intent}
            </p>
          </div>

          <div className="flex flex-col items-end gap-3">
            <Button variant="ghost" size="sm" onClick={leave}>
              {voice.run.close}
            </Button>
            {run.supervised && (
              <>
                <RunPips
                  passed={routine.provingRunsPassed}
                  required={routine.provingRunsRequired}
                  active
                />
                <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {voice.run.tracker(run.runIndex, routine.provingRunsRequired)}
                </span>
              </>
            )}
          </div>
        </div>

        {run.supervised && (
          <p
            className="agent-voice mx-auto mt-5 max-w-[760px]"
            style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
          >
            {voice.run.trackerRule}
          </p>
        )}
      </header>

      {/* --------------------------------------------------------- the timeline */}
      <div className="mx-auto max-w-[760px] px-6 md:px-12">
        <ol className="relative flex flex-col gap-3 pt-6">
          <span
            aria-hidden
            className="absolute bottom-8 top-8"
            style={{
              left: 25,
              width: 3,
              borderRadius: "var(--radius-pill)",
              background: "var(--bg-base)",
              boxShadow: "var(--elev-pressed-sm)",
            }}
          />

          {plan.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              index={i}
              state={run.stepStates[step.id] ?? "pending"}
              isActive={step.id === active}
              status={run.status}
              detail={run.stepDetails[step.id]}
              observationPaused={paused}
            />
          ))}
        </ol>

        <AnimatePresence mode="wait">
          {run.status === "parked" && <ParkPanel key="park" />}
          {run.status === "correcting" && <CorrectionPanel key="correct" />}
          {run.status === "yielded" && <YieldPanel key="yield" />}
          {finished && <SummaryPanel key="summary" onLeave={leave} />}
        </AnimatePresence>
      </div>

      {/* ------------------------------------------------------------ controls */}
      {!finished && (
        <div className="fixed bottom-0 left-0 right-0 z-30 px-6 pb-8 pt-10">
          <div
            className="mx-auto flex max-w-[560px] flex-wrap items-center justify-center gap-3"
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--elev-raised-lg)",
              padding: "16px 22px",
            }}
          >
            <Button
              variant={busy ? "quiet" : "primary"}
              onClick={() => (busy ? mimic.pauseRun() : mimic.resumeRun())}
              disabled={run.status === "parked" || run.status === "yielded"}
            >
              {busy ? "Pause" : "Carry on"}
            </Button>
            <Button onClick={() => mimic.stepBack()} disabled={run.stepIndex <= 0}>
              Step back
            </Button>
            <Button
              onClick={() => mimic.openCorrection()}
              disabled={run.stepIndex < 0 || run.status === "correcting"}
            >
              Correct this step
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================================================================
   A step in the timeline
   =========================================================================== */

const MOOD_FOR: Record<string, Mood> = {
  running: "working",
  paused: "idle",
  parked: "unsure",
  correcting: "unsure",
  yielded: "idle",
  stopped: "idle",
  finished: "pleased",
};

function StepRow({
  step,
  index,
  state,
  isActive,
  status,
  detail,
  observationPaused,
}: {
  step: RoutineStep;
  index: number;
  state: StepState;
  isActive: boolean;
  status: string;
  detail?: string;
  observationPaused: boolean;
}) {
  const done = state === "done" || state === "corrected";
  const skipped = state === "skipped";
  const unreached = state === "unreached";

  return (
    <motion.li
      layout
      className="relative flex gap-5"
      style={{
        padding: isActive ? "22px 24px" : "16px 24px",
        borderRadius: "var(--radius-card)",
        background: isActive ? "var(--surface)" : "transparent",
        boxShadow: isActive ? "var(--elev-raised)" : "none",
        opacity: skipped || unreached ? 0.38 : done ? 0.62 : 1,
      }}
      transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <span className="relative z-10 mt-1 grid shrink-0 place-items-center" style={{ width: 26 }}>
        {isActive ? (
          <Pulse size={34} paused={observationPaused} className="-m-1" />
        ) : (
          <span
            className="block rounded-full"
            style={{
              width: done ? 9 : 7,
              height: done ? 9 : 7,
              background: done ? "var(--primary)" : "var(--bg-base)",
              boxShadow: done ? "0 0 6px var(--primary-glow)" : "var(--elev-pressed-sm)",
            }}
          />
        )}
      </span>

      <div className="shrink-0 pt-1">
        <AppTile
          app={step.app}
          state={isActive ? "active" : done || skipped || unreached ? "done" : "idle"}
          perch={isActive}
          perchMood={MOOD_FOR[status] ?? "working"}
          size={44}
          showLabel={false}
        />
      </div>

      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            style={{
              fontSize: isActive ? "var(--text-title)" : "var(--text-body)",
              fontWeight: isActive ? 600 : 400,
              letterSpacing: isActive ? "var(--tracking-tight)" : undefined,
              textDecoration: skipped ? "line-through" : undefined,
            }}
          >
            {step.label}
          </span>
          {state === "corrected" && <span className="micro-label">corrected</span>}
          {skipped && <span className="micro-label">left alone</span>}
          {unreached && <span className="micro-label">not reached</span>}
          {state === "parked" && (
            <span className="micro-label" style={{ color: "var(--primary)" }}>
              waiting on you
            </span>
          )}
        </div>

        {isActive && (
          <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {step.detail}
          </p>
        )}

        {/* What it really did, in its own words. */}
        {detail && (
          <p
            className="mt-1.5"
            style={{ fontSize: "var(--text-sm)", color: done ? "var(--slate)" : "var(--primary)" }}
          >
            {detail}
          </p>
        )}

        {isActive && !detail && (
          <p
            className="mt-1 font-mono"
            style={{ fontSize: "var(--text-micro)", color: "var(--slate)", opacity: 0.8 }}
          >
            {actionSummary(step)}
          </p>
        )}

        {step.hardRule && isActive && (
          <p className="micro-label mt-2" style={{ color: "var(--primary)" }}>
            always asks &middot; {HARD_RULE_LABEL[step.hardRule]}
          </p>
        )}
      </div>
    </motion.li>
  );
}

/* ===========================================================================
   Inline panels
   =========================================================================== */

function Panel({
  children,
  tone = "agent",
}: {
  children: React.ReactNode;
  tone?: "agent" | "surface";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
      className="mt-8"
      style={{
        background: tone === "agent" ? "var(--primary-soft)" : "var(--surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: tone === "surface" ? "var(--elev-raised)" : "none",
        padding: 28,
      }}
    >
      {children}
    </motion.div>
  );
}

/** A hard rule. Parks at every trust level, including unattended. */
function ParkPanel() {
  const run = useMimic((s) => s.activeRun)!;

  return (
    <Panel>
      <div className="flex items-start gap-4">
        <Mascot mood="unsure" size="md" />
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600, color: "var(--primary)" }}>
            {voice.run.parkedTitle}
          </p>
          <p className="agent-voice mt-2">
            {run.parkedRule ? HARD_RULE_SENTENCE[run.parkedRule] : ""}
          </p>
          {run.parkedReason && (
            <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)" }}>
              {run.parkedReason}
            </p>
          )}
          <p
            className="agent-voice mt-3"
            style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
          >
            {voice.rules.body}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => mimic.resolvePark("approve")}>
              {voice.run.parkedApprove}
            </Button>
            <Button onClick={() => mimic.resolvePark("skip")}>{voice.run.parkedSkip}</Button>
            <Button variant="ghost" onClick={() => mimic.resolvePark("stop")}>
              {voice.run.parkedStop}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** The user walked back in. Mimic yields on any human input. */
function YieldPanel() {
  const run = useMimic((s) => s.activeRun)!;
  const routine = useMimic((s) => s.routines.find((r) => r.id === run.routineId));
  const step = routine?.stepLibrary.find((s) => s.id === run.order[run.stepIndex]);

  return (
    <Panel>
      <div className="flex items-start gap-4">
        <Mascot mood="idle" size="md" />
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>{voice.run.yieldedTitle}</p>
          <p className="agent-voice mt-2">{voice.run.yielded(step?.label.toLowerCase() ?? "it")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => mimic.resolveYield("resume")}>
              {voice.run.yieldedResume}
            </Button>
            <Button onClick={() => mimic.resolveYield("handover")}>
              {voice.run.yieldedHandOver}
            </Button>
            <Button variant="ghost" onClick={() => mimic.resolveYield("stop")}>
              {voice.run.yieldedStop}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Corrections are the product's learning signal, and they stick. */
function CorrectionPanel() {
  const run = useMimic((s) => s.activeRun)!;
  const routine = useMimic((s) => s.routines.find((r) => r.id === run.routineId));
  const stepId = run.order[run.stepIndex];
  const step = routine?.stepLibrary.find((s) => s.id === stepId);
  const [ack, setAck] = useState<string | null>(null);

  if (!step) return null;

  const apply = async (patch: Parameters<typeof mimic.correct>[0], lesson: string) => {
    await mimic.correct(patch);
    setAck(lesson);
  };

  if (ack) {
    return (
      <Panel>
        <div className="flex items-start gap-4">
          <Mascot mood="pleased" size="md" />
          <div className="min-w-0 flex-1">
            <p className="agent-voice" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
              {voice.run.correctionAck(ack)}
            </p>
            <p className="agent-voice mt-3" style={{ fontSize: "var(--text-sm)" }}>
              {voice.run.correctionResets}
            </p>
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => {
                setAck(null);
                mimic.resumeRun();
              }}
            >
              Carry on
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel tone="surface">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>{step.label}</p>
          <p
            className="mt-1 font-mono"
            style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}
          >
            {actionSummary(step)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => mimic.closeCorrection()}>
          Never mind
        </Button>
      </div>

      {step.param && (
        <div className="mt-7">
          <p className="micro-label">{step.param.label}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {step.param.options.map((option) => {
              const on = step.param!.value === option;
              const isPattern = step.action.kind === "rename";
              return (
                <button
                  key={option}
                  onClick={() =>
                    apply(
                      isPattern
                        ? { stepId: step.id, pattern: option }
                        : { stepId: step.id, value: option },
                      `${step.param!.label.toLowerCase()} is ${option}.`,
                    )
                  }
                  className="pressable cursor-pointer"
                  style={{
                    padding: "10px 16px",
                    borderRadius: "var(--radius-control)",
                    fontSize: "var(--text-sm)",
                    background: on ? "var(--primary-soft)" : "var(--bg-base)",
                    color: on ? "var(--primary)" : "var(--ink)",
                    fontWeight: on ? 600 : 400,
                    boxShadow: on ? "none" : "var(--elev-pressed-sm)",
                  }}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8">
        <p className="micro-label">Or change how it fits</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() =>
              apply(
                { stepId: step.id, skip: true },
                `I'll leave "${step.label.toLowerCase()}" alone.`,
              )
            }
          >
            Don&rsquo;t do this step
          </Button>
          <Button
            size="sm"
            disabled={run.stepIndex === 0}
            onClick={() =>
              apply(
                { stepId: step.id, move: "earlier" },
                `I'll do "${step.label.toLowerCase()}" earlier.`,
              )
            }
          >
            Do it earlier
          </Button>
          <Button
            size="sm"
            disabled={run.stepIndex >= run.order.length - 1}
            onClick={() =>
              apply(
                { stepId: step.id, move: "later" },
                `I'll do "${step.label.toLowerCase()}" later.`,
              )
            }
          >
            Do it later
          </Button>
        </div>
      </div>

      <p className="agent-voice mt-7" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
        {voice.run.correctionResets}
      </p>
    </Panel>
  );
}

/* ===========================================================================
   Run summary — including the clean stop, which is its own thing
   =========================================================================== */

function SummaryPanel({ onLeave }: { onLeave: () => void }) {
  const run = useMimic((s) => s.activeRun)!;
  const routine = useMimic((s) => s.routines.find((r) => r.id === run.routineId));
  const runs = useMimic((s) => s.runs);
  const [rolled, setRolled] = useState(false);

  const summary = run.summary;
  if (!summary || !routine) return null;

  const stopped = summary.outcome === "stopped";
  const record = runs.find((r) => r.id === summary.runId);
  const left = Math.max(0, routine.provingRunsRequired - routine.provingRunsPassed);

  return (
    <Panel tone="surface">
      <div className="flex items-start gap-5">
        <Mascot mood={stopped ? "idle" : "pleased"} size="lg" />
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {stopped ? voice.run.stoppedTitle : voice.run.summaryTitle}
          </p>
          <p className="agent-voice mt-2">{summary.note}</p>
          {stopped && (
            <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
              {voice.run.stoppedSub}
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-y-8 md:grid-cols-4">
        <Figure value={formatDuration(summary.durationSec)} label="Time taken" />
        <Figure value={String(summary.completed.length)} label="Steps finished" />
        <Figure value={String(summary.changes.length)} label="Things changed" />
        <Figure value={String(summary.corrections)} label="Corrections" />
      </div>

      <div className="mt-9">
        <p className="micro-label">{voice.run.changesLabel}</p>
        {summary.changes.length === 0 ? (
          <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {voice.run.noChanges}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {summary.changes.map((c, i) => (
              <li key={`${c}-${i}`} style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>

      {summary.notCompleted.length > 0 && (
        <div className="mt-8">
          <p className="micro-label">{voice.run.notCompletedLabel}</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {summary.notCompleted.map((c, i) => (
              <li key={`${c}-${i}`} style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.supervised && !stopped && (
        <p className="agent-voice mt-8" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.run.remaining(left)}
        </p>
      )}

      <div className="mt-9 flex flex-wrap gap-3">
        {stopped ? (
          <>
            <Button variant="primary" onClick={() => mimic.startRun(routine.id)}>
              {voice.run.stoppedRetry}
            </Button>
            <Button variant="ghost" onClick={onLeave}>
              {voice.run.stoppedHandBack}
            </Button>
          </>
        ) : (
          <>
            {left > 0 && (
              <Button variant="primary" onClick={() => mimic.startRun(routine.id)}>
                Run it again
              </Button>
            )}
            <Button variant="ghost" onClick={onLeave}>
              {voice.run.close}
            </Button>
          </>
        )}

        {record?.reversible && !record.rolledBack && !rolled && (
          <Button
            variant="ghost"
            onClick={async () => {
              await mimic.rollback(record.id);
              setRolled(true);
            }}
          >
            {voice.ledger.rollback}
          </Button>
        )}
        {(rolled || record?.rolledBack) && (
          <span className="micro-label self-center">{voice.ledger.rolledBack}</span>
        )}
      </div>
    </Panel>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="tabular-nums"
        style={{
          fontSize: "var(--text-title)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-tight)",
        }}
      >
        {value}
      </span>
      <span className="micro-label">{label}</span>
    </div>
  );
}
