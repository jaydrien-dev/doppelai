"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { awayMinutesLeft, mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago, formatDuration } from "@/lib/time";
import type { PocketJob } from "@/lib/types";
import { PhoneFrame } from "@/components/PhoneFrame";
import { Pulse } from "@/components/Pulse";
import { Mascot } from "@/components/Mascot";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";

/* ===========================================================================
   Pocket — a queue, not a chat. You dispatch; you don't converse.
   Everything here drives the same engine the Desk does.
   =========================================================================== */

function Pocket({ bare }: { bare: boolean }) {
  const connect = useMimic((s) => s.connect);
  const tick = useMimic((s) => s.tick);
  const routines = useMimic((s) => s.routines);
  const jobs = useMimic((s) => s.jobs);
  const away = useMimic((s) => s.away);
  const paused = useMimic((s) => s.observation.paused);
  const now = useMimic((s) => s.now);
  const runs = useMimic((s) => s.runs);

  const [confirming, setConfirming] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tick]);

  const authorised = routines.filter(
    (r) => r.stage === "unattended" && (!away.active || away.routineIds.includes(r.id)),
  );

  const live = jobs.filter((j) => j.state !== "done" && j.state !== "stopped");
  const finished = jobs.filter((j) => j.state === "done" || j.state === "stopped");

  return (
    <PhoneFrame bare={bare}>
      <div className="px-6 pb-16 pt-8">
        {/* ---------------------------------------------------------- presence */}
        <header className="flex items-center gap-4">
          <Pulse size={56} paused={paused} className="-m-2" />
          <div className="min-w-0">
            <p style={{ fontWeight: 600, letterSpacing: "var(--tracking-tight)" }}>
              {paused
                ? voice.pocket.presencePaused
                : away.active
                  ? voice.pocket.presenceAway
                  : voice.pocket.presenceOnline}
            </p>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {paused
                ? voice.pocket.presencePausedSub
                : away.active
                  ? voice.away.remaining(awayMinutesLeft(away, now))
                  : voice.pocket.presenceOnlineSub}
            </p>
          </div>
        </header>

        {/* ---------------------------------------------------------- dispatch */}
        <section className="mt-10">
          <p className="micro-label">{voice.pocket.dispatchTitle}</p>
          {authorised.length === 0 ? (
            <p
              className="agent-voice mt-3"
              style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
            >
              {voice.pocket.dispatchEmpty}
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {authorised.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setConfirming(r.id)}
                  className="pressable w-full cursor-pointer text-left"
                  style={{
                    padding: "18px 22px",
                    borderRadius: "var(--radius-card-sm)",
                    background: "var(--surface)",
                    boxShadow: "var(--elev-raised-sm)",
                  }}
                >
                  <p style={{ fontWeight: 600 }}>{r.title}</p>
                  <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                    {voice.common.steps(r.stepLibrary.length)} &middot; about {r.minutesPerRun} min
                    of yours
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------ queue */}
        <section className="mt-12">
          <p className="micro-label">The queue</p>
          {live.length === 0 ? (
            <div className="mt-4">
              <p className="agent-voice" style={{ color: "var(--slate)" }}>
                {voice.pocket.empty}
              </p>
              <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {voice.pocket.emptySub}
              </p>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {live.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onAnswer={(choice) => mimic.answerJob(job.id, choice)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- results */}
        {finished.length > 0 && (
          <section className="mt-12">
            <div className="flex items-baseline justify-between">
              <p className="micro-label">{voice.pocket.resultTitle}</p>
              <button
                onClick={() => mimic.clearJobs()}
                className="cursor-pointer"
                style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
              >
                {voice.pocket.clear}
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {finished.map((job) => (
                <ResultCard
                  key={job.id}
                  job={job}
                  record={runs.find((r) => r.id === job.runId)}
                  now={now}
                />
              ))}
            </div>
          </section>
        )}

        {/* --------------------------------------------------- emergency stop */}
        <section className="mt-14">
          <button
            onClick={() => setStopping(true)}
            className="pressable w-full cursor-pointer"
            style={{
              padding: "18px 22px",
              borderRadius: "var(--radius-card-sm)",
              background: "var(--primary-soft)",
              color: "var(--primary)",
              fontWeight: 600,
              boxShadow: "var(--elev-pressed-sm)",
            }}
          >
            {voice.pocket.stopAll}
          </button>
          <p className="mt-4" style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}>
            {voice.pocket.custodyNote}
          </p>
        </section>
      </div>

      <ConfirmDispatch
        routineTitle={routines.find((r) => r.id === confirming)?.title ?? ""}
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) mimic.dispatch(confirming);
          setConfirming(null);
        }}
      />

      <Modal open={stopping} onClose={() => setStopping(false)}>
        <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
          {voice.pocket.stopAllConfirm}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button
            variant="primary"
            onClick={() => {
              mimic.stopAll();
              setStopping(false);
            }}
          >
            {voice.pocket.stopAll}
          </Button>
          <Button variant="ghost" onClick={() => setStopping(false)}>
            Never mind
          </Button>
        </div>
      </Modal>
    </PhoneFrame>
  );
}

/* --------------------------------------------------------------------------- */

const STATE_LABEL: Record<PocketJob["state"], string> = {
  queued: voice.pocket.queued,
  running: voice.pocket.running,
  "needs-you": voice.pocket.needsYou,
  held: voice.pocket.held,
  done: voice.pocket.done,
  stopped: voice.pocket.stopped,
};

function JobCard({
  job,
  onAnswer,
}: {
  job: PocketJob;
  onAnswer: (choice: "approve" | "skip" | "later") => void;
}) {
  const needs = job.state === "needs-you";
  const running = job.state === "running";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}
      style={{
        padding: "20px 22px",
        borderRadius: "var(--radius-card-sm)",
        background: needs ? "var(--primary-soft)" : running ? "var(--surface)" : "var(--bg-base)",
        boxShadow: needs ? "none" : running ? "var(--elev-raised)" : "var(--elev-pressed-sm)",
      }}
    >
      <div className="flex items-start gap-3">
        {running && <Pulse size={34} className="-m-1 shrink-0" />}
        {needs && <Mascot mood="unsure" size="sm" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span style={{ fontWeight: 600 }}>{job.routineTitle}</span>
            <span className="micro-label" style={{ color: needs ? "var(--primary)" : undefined }}>
              {STATE_LABEL[job.state]}
            </span>
          </div>

          {running && (
            <p className="mt-1.5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {job.stepLabel} &middot; {job.stepIndex + 1} of {job.stepCount}
            </p>
          )}

          {job.state === "held" && (
            <p
              className="agent-voice mt-1.5"
              style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
            >
              {job.heldReason ?? voice.pocket.heldBody}
            </p>
          )}

          {needs && job.question && (
            <>
              <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)" }}>
                {job.question.prompt}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onClick={() => onAnswer("approve")}>
                  {voice.pocket.approve}
                </Button>
                <Button size="sm" onClick={() => onAnswer("skip")}>
                  {voice.pocket.skip}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onAnswer("later")}>
                  {voice.pocket.later}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ResultCard({
  job,
  record,
  now,
}: {
  job: PocketJob;
  record?: { id: string; note: string; durationSec: number; changes: string[]; minutesSaved: number; reversible: boolean; rolledBack: boolean };
  now: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flat" style={{ padding: "20px 22px", boxShadow: "var(--elev-pressed-sm)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span style={{ fontWeight: 600 }}>{job.routineTitle}</span>
        <span className="micro-label">{STATE_LABEL[job.state]}</span>
      </div>

      {record && (
        <>
          <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)" }}>
            {record.note}
          </p>
          <p className="micro-label mt-3">
            {formatDuration(record.durationSec)} &middot; {record.changes.length} changed &middot;{" "}
            {ago(job.finishedAt ?? job.dispatchedAt, now)}
          </p>

          <div className="mt-4 flex flex-wrap gap-4">
            <button
              onClick={() => setOpen(!open)}
              className="cursor-pointer"
              style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
            >
              {open ? "Close" : voice.run.changesLabel}
            </button>
            {record.reversible && !record.rolledBack && (
              <button
                onClick={() => mimic.rollback(record.id)}
                className="cursor-pointer"
                style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
              >
                {voice.ledger.rollback}
              </button>
            )}
            {record.rolledBack && <span className="micro-label">put back</span>}
          </div>

          <AnimatePresence initial={false}>
            {open && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-4 flex flex-col gap-1 overflow-hidden"
              >
                {record.changes.length === 0 ? (
                  <li style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                    {voice.run.noChanges}
                  </li>
                ) : (
                  record.changes.map((c, i) => (
                    <li
                      key={`${c}-${i}`}
                      style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                    >
                      {c}
                    </li>
                  ))
                )}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/** Hold to send. Standing in for the biometric confirmation on a real phone. */
function ConfirmDispatch({
  routineTitle,
  open,
  onClose,
  onConfirm,
}: {
  routineTitle: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const holding = useRef(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) setProgress(0);
  }, [open]);

  useEffect(() => {
    if (progress >= 100) {
      const t = setTimeout(onConfirm, 180);
      return () => clearTimeout(t);
    }
  }, [progress, onConfirm]);

  const start = () => {
    holding.current = true;
    const step = () => {
      if (!holding.current) return;
      setProgress((p) => {
        const next = Math.min(100, p + (reduced ? 50 : 4));
        if (next < 100) requestAnimationFrame(step);
        return next;
      });
    };
    requestAnimationFrame(step);
  };

  const stop = () => {
    holding.current = false;
    setProgress(0);
  };

  return (
    <Modal open={open} onClose={onClose} width={360}>
      <div className="flex flex-col items-center text-center">
        <p className="micro-label">{voice.pocket.confirmBiometric}</p>
        <p className="mt-3" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
          {routineTitle}
        </p>

        <button
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          className="relative mt-9 grid cursor-pointer select-none place-items-center rounded-full"
          style={{
            width: 128,
            height: 128,
            background: "var(--bg-base)",
            boxShadow: "var(--elev-pressed)",
          }}
        >
          <span
            aria-hidden
            className="absolute rounded-full"
            style={{
              width: 128 * (progress / 100),
              height: 128 * (progress / 100),
              background: "var(--primary-soft)",
              transition: "width 60ms linear, height 60ms linear",
            }}
          />
          <span
            className="relative"
            style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--primary)" }}
          >
            {progress > 0 ? voice.pocket.holding : voice.pocket.confirmBody}
          </span>
        </button>

        <Button variant="ghost" className="mt-8" onClick={onClose}>
          Never mind
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------------------- */

function Inner() {
  const bare = useSearchParams().get("window") === "1";
  return <Pocket bare={bare} />;
}

export default function PocketPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
