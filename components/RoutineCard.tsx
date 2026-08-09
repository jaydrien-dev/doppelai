"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { Routine } from "@/lib/types";
import { voice } from "@/lib/voice";
import { ago } from "@/lib/time";
import { mimic, useMimic } from "@/lib/store";
import { guessCount, planFor, unattendedEligible } from "@/lib/plan";
import { routineHref, runHref } from "@/lib/nav";
import { ProgressBar, RunPips } from "./ProgressBar";
import { Button, ButtonLink } from "./ui";
import { StepList } from "./StepList";
import { Pulse } from "./Pulse";

/**
 * Stage is read from elevation and treatment, never from a coloured badge:
 *
 *   learning     inset, as though still forming
 *   ready        raised, one blue accent
 *   supervised   raised, carrying the pulse
 *   trusted      flattest and calmest, one small blue mark
 *   unattended   the same calm, plus one quiet extra marker
 */
export function RoutineCard({ routine }: { routine: Routine }) {
  switch (routine.stage) {
    case "learning":
      return <LearningCard routine={routine} />;
    case "ready":
      return <ReadyCard routine={routine} />;
    case "supervised":
      return <SupervisedCard routine={routine} />;
    default:
      return <SettledCard routine={routine} />;
  }
}

/* --------------------------------------------------------------------------- */

function CardTitle({ routine }: { routine: Routine }) {
  return (
    <Link
      href={routineHref(routine.id)}
      className="transition-opacity hover:opacity-70"
      style={{
        fontSize: "var(--text-title)",
        fontWeight: 600,
        letterSpacing: "var(--tracking-tight)",
        color: "var(--ink)",
      }}
    >
      {routine.title}
    </Link>
  );
}

function Hunch({ children }: { children: React.ReactNode }) {
  return (
    <p className="agent-voice mt-2" style={{ fontSize: "var(--text-body)", color: "var(--slate)" }}>
      {children}
    </p>
  );
}

/** The one place a card raises its hand. Primary on primary-soft, never red. */
function NeedsYou({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="agent-voice mt-5"
      style={{
        background: "var(--primary-soft)",
        borderRadius: "var(--radius-card-sm)",
        padding: "16px 20px",
      }}
    >
      <p style={{ fontWeight: 600, color: "var(--primary)" }}>{title}</p>
      {body && (
        <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>
          {body}
        </p>
      )}
      {children && <div className="mt-4 flex flex-wrap gap-3">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ learning */

function LearningCard({ routine }: { routine: Routine }) {
  return (
    <motion.article
      layout
      className="pressed"
      style={{ padding: 26 }}
      transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <CardTitle routine={routine} />
      <Hunch>{routine.hunch}</Hunch>

      <div className="mt-6">
        <ProgressBar value={routine.confidence} label={voice.common.confidence} />
      </div>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.learning.seen(routine.observations)}
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.learning.waysSeen(routine.observedPaths.length)}
        </span>
      </div>

      {routine.unsure && (
        <p
          className="agent-voice mt-3"
          style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
        >
          {voice.learning.stillUnsure(routine.unsure)}
        </p>
      )}

      {routine.relearning && (
        <p className="micro-label mt-4" style={{ color: "var(--primary)" }}>
          {voice.drift.relearning}
        </p>
      )}
    </motion.article>
  );
}

/* --------------------------------------------------------------------- ready */

function ReadyCard({ routine }: { routine: Routine }) {
  const [open, setOpen] = useState(false);
  const guesses = guessCount(routine);

  return (
    <motion.article
      layout
      className="raised relative overflow-hidden"
      style={{ padding: 26 }}
      transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full"
        style={{ width: 3, background: "var(--primary)", opacity: 0.85 }}
      />

      <CardTitle routine={routine} />
      <p className="agent-voice mt-2" style={{ color: "var(--ink)" }}>
        {voice.ready.prompt}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <ButtonLink href={runHref(routine.id)} variant="primary">
          {voice.ready.cta}
        </ButtonLink>
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide the plan" : `Show me the plan (${planFor(routine).length})`}
        </Button>
      </div>

      <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
        {voice.ready.guessCount(guesses)} {voice.ready.consent}
      </p>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="playback"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-6 pt-6" style={{ boxShadow: "inset 0 1px 0 var(--ink-soft)" }}>
              <p className="micro-label">{voice.ready.intentLabel}</p>
              <p className="agent-voice mt-2">{routine.intent}</p>

              <p className="micro-label mt-6">{voice.ready.criteriaLabel}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {routine.successCriteria.map((c) => (
                  <li key={c} style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                    {c}
                  </li>
                ))}
              </ul>

              <p className="micro-label mb-4 mt-6">{voice.ready.pathsLabel}</p>
              <StepList routine={routine} />

              <p
                className="agent-voice mt-6"
                style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
              >
                {voice.ready.realWarning}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

/* ---------------------------------------------------------------- supervised */

function SupervisedCard({ routine }: { routine: Routine }) {
  const paused = useMimic((s) => s.observation.paused);
  const setGraduating = useMimic((s) => s.setGraduating);
  const earned = routine.provingRunsPassed >= routine.provingRunsRequired;

  return (
    <motion.article
      layout
      className="raised"
      style={{ padding: 26 }}
      transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle routine={routine} />
          <Hunch>{routine.hunch}</Hunch>
        </div>
        <Pulse size={54} paused={paused} className="-m-2 shrink-0" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <RunPips passed={routine.provingRunsPassed} required={routine.provingRunsRequired} active />
        <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.run.tracker(
            Math.min(routine.provingRunsPassed + 1, routine.provingRunsRequired),
            routine.provingRunsRequired,
          )}
        </span>
      </div>

      <p className="agent-voice mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
        {voice.run.trackerRule}
      </p>

      {earned ? (
        <NeedsYou title={voice.graduation.ask} body={voice.graduation.body}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setGraduating({ routineId: routine.id, kind: "trusted" })}
          >
            Hear it out
          </Button>
        </NeedsYou>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ButtonLink href={runHref(routine.id)} variant="primary">
            Watch the next run
          </ButtonLink>
          {routine.lessons.length > 0 && (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.lessons.count(routine.lessons.length)} taught
            </span>
          )}
        </div>
      )}
    </motion.article>
  );
}

/* --------------------------------------------------- trusted and unattended */

function SettledCard({ routine }: { routine: Routine }) {
  const now = useMimic((s) => s.now);
  const setGraduating = useMimic((s) => s.setGraduating);

  const unattended = routine.stage === "unattended";
  const eligible = unattendedEligible(routine);

  return (
    <motion.article
      layout
      className="flat"
      style={{ padding: 26 }}
      transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="block shrink-0 rounded-full"
            style={{ width: 7, height: 7, background: "var(--primary)" }}
          />
          <CardTitle routine={routine} />
          {unattended && (
            <span
              aria-hidden
              title={voice.unattended.marker}
              className="block shrink-0 rounded-full"
              style={{ width: 7, height: 7, boxShadow: "var(--elev-pressed-sm)" }}
            />
          )}
        </div>

        <div className="flex items-center gap-5">
          <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {routine.lastRunAt ? voice.trusted.lastRun(ago(routine.lastRunAt, now)) : voice.trusted.never}
          </span>
          <ButtonLink href={runHref(routine.id)} variant="ghost" size="sm">
            {voice.trusted.runNow}
          </ButtonLink>
          <Button variant="ghost" size="sm" onClick={() => mimic.demote(routine.id)}>
            {voice.trusted.demote}
          </Button>
        </div>
      </div>

      {unattended && (
        <p className="micro-label mt-3" style={{ marginLeft: 19 }}>
          {voice.unattended.marker}
        </p>
      )}

      {routine.drifting && (
        <NeedsYou title={voice.drift.flag} body={`${voice.drift.ask} ${voice.drift.body}`}>
          <Button variant="primary" size="sm" onClick={() => mimic.relearn(routine.id)}>
            {voice.drift.accept}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => mimic.dismissDrift(routine.id)}>
            {voice.drift.dismiss}
          </Button>
        </NeedsYou>
      )}

      {eligible && (
        <NeedsYou
          title={voice.unattended.ask}
          body={voice.unattended.progress(routine.presentRunsPassed, routine.presentRunsRequired)}
        >
          <Button
            variant="primary"
            size="sm"
            onClick={() => setGraduating({ routineId: routine.id, kind: "unattended" })}
          >
            Hear it out
          </Button>
        </NeedsYou>
      )}

      {!eligible && !routine.drifting && routine.stage === "trusted" && (
        <p
          className="mt-4"
          style={{ fontSize: "var(--text-sm)", color: "var(--slate)", marginLeft: 19 }}
        >
          {voice.unattended.progress(routine.presentRunsPassed, routine.presentRunsRequired)}
        </p>
      )}
    </motion.article>
  );
}
