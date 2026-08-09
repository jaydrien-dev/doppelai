"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago, formatDuration } from "@/lib/time";
import { runHref } from "@/lib/nav";
import { alternatePaths, dominantPath, hardRuleSteps, unattendedEligible } from "@/lib/plan";
import { HARD_RULE_LABEL, type Routine } from "@/lib/types";
import { StepList } from "@/components/StepList";
import { ProgressBar, RunPips } from "@/components/ProgressBar";
import { Button, ButtonLink, SectionHeading } from "@/components/ui";
import { ConfidenceChart } from "@/components/ConfidenceChart";
import { Pulse } from "@/components/Pulse";

function Detail({ id }: { id: string }) {
  const router = useRouter();
  const routine = useMimic((s) => s.routines.find((r) => r.id === id));
  const runs = useMimic((s) => s.runs.filter((r) => r.routineId === id));
  const now = useMimic((s) => s.now);
  const setGraduating = useMimic((s) => s.setGraduating);
  const setTeaching = useMimic((s) => s.setTeaching);
  const ready = useMimic((s) => s.ready);

  if (!routine) {
    return (
      <div>
        <p className="agent-voice">
          {ready ? "I don't have that one." : "One moment."}
        </p>
        <Link href="/routines" className="mt-4 inline-block" style={{ color: "var(--primary)" }}>
          Back to routines
        </Link>
      </div>
    );
  }

  const lessons = [...routine.lessons].sort((a, b) => b.at - a.at);
  const dominant = dominantPath(routine);
  const others = alternatePaths(routine);
  const rules = hardRuleSteps(routine);

  return (
    <div className="max-w-[720px]">
      <Link
        href="/routines"
        className="micro-label transition-opacity hover:opacity-60"
        style={{ color: "var(--slate)" }}
      >
        &larr; Routines
      </Link>

      <header className="mb-12 mt-6">
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>{routine.title}</h1>
        <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
          {routine.hunch}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {(routine.stage === "ready" || routine.stage === "supervised") && (
            <ButtonLink href={runHref(routine.id)} variant="primary">
              {routine.stage === "ready" ? voice.ready.cta : "Watch the next run"}
            </ButtonLink>
          )}
          {routine.stage === "learning" && (
            <Button variant="primary" onClick={() => setTeaching(true)}>
              {voice.teach.cta}
            </Button>
          )}
          {(routine.stage === "trusted" || routine.stage === "unattended") && (
            <>
              <ButtonLink href={runHref(routine.id)} variant="primary">
                {voice.trusted.runNow}
              </ButtonLink>
              <Button onClick={() => mimic.demote(routine.id)}>{voice.trusted.demote}</Button>
            </>
          )}
          {routine.stage === "unattended" && (
            <Button variant="ghost" onClick={() => mimic.revokeUnattended(routine.id)}>
              {voice.trusted.revokeUnattended}
            </Button>
          )}
        </div>
      </header>

      {/* -------------------------------------------------------------- intent */}
      <section className="mb-12">
        <SectionHeading>{voice.detail.intentTitle}</SectionHeading>
        <div className="raised" style={{ padding: 26 }}>
          <p className="agent-voice" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {routine.intent}
          </p>
          <p className="micro-label mt-7">{voice.detail.criteriaTitle}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {routine.successCriteria.map((c) => (
              <li key={c} className="flex gap-3" style={{ color: "var(--slate)" }}>
                <span
                  aria-hidden
                  className="mt-2 block shrink-0 rounded-full"
                  style={{ width: 5, height: 5, background: "var(--primary)" }}
                />
                <span style={{ fontSize: "var(--text-sm)" }}>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------- where from */}
      <section className="mb-12">
        <SectionHeading>{voice.detail.sourceLabel}</SectionHeading>
        <p className="agent-voice">{routine.source}</p>
        <p className="mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.learning.seen(routine.observations)} First noticed {ago(routine.discoveredAt, now)}.
        </p>
      </section>

      {/* ------------------------------------------------------- drift, if any */}
      {routine.drifting && (
        <section className="mb-12">
          <div
            className="agent-voice"
            style={{
              background: "var(--primary-soft)",
              borderRadius: "var(--radius-card)",
              padding: 26,
            }}
          >
            <p style={{ fontSize: "var(--text-title)", fontWeight: 600, color: "var(--primary)" }}>
              {voice.drift.flag}
            </p>
            <p className="mt-2">{voice.drift.ask}</p>
            <p className="mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.drift.body}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => mimic.relearn(routine.id)}>
                {voice.drift.accept}
              </Button>
              <Button variant="ghost" onClick={() => mimic.dismissDrift(routine.id)}>
                {voice.drift.dismiss}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------------- stage */}
      <section className="mb-12">
        <SectionHeading>{voice.detail.stageTitle}</SectionHeading>
        <StagePanel
          routine={routine}
          now={now}
          onAskUnattended={() => setGraduating({ routineId: routine.id, kind: "unattended" })}
        />
      </section>

      {/* ---------------------------------------------------------------- plan */}
      <section className="mb-12">
        <SectionHeading count={routine.stepLibrary.length}>
          {voice.detail.planTitle}
        </SectionHeading>
        <p className="mb-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.detail.planNote}
        </p>
        <div className="raised" style={{ padding: 26 }}>
          <StepList routine={routine} />
        </div>
      </section>

      {/* ------------------------------------------------------ observed paths */}
      <section className="mb-12">
        <SectionHeading count={routine.observedPaths.length}>
          {voice.detail.pathsTitle}
        </SectionHeading>
        <p className="mb-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.detail.pathsNote}
        </p>
        <div className="flex flex-col gap-3">
          {[dominant, ...others].filter(Boolean).map((path, i) => (
            <div
              key={path!.id}
              className={i === 0 ? "raised" : "flat"}
              style={{ padding: "20px 24px" }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span style={{ fontWeight: i === 0 ? 600 : 400 }}>{path!.label}</span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {voice.learning.pathLabel(path!.seenCount)} &middot; {ago(path!.lastSeen, now)}
                </span>
              </div>
              <p className="mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {path!.stepIds
                  .map((sid) => routine.stepLibrary.find((s) => s.id === sid)?.label)
                  .filter(Boolean)
                  .join(" → ")}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- hard rules */}
      <section className="mb-12">
        <SectionHeading>{voice.rules.title}</SectionHeading>
        <div className="pressed" style={{ padding: 26 }}>
          <p className="agent-voice" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {voice.rules.body}
          </p>
          <ul className="mt-5 flex flex-col gap-2">
            {voice.rules.list.map((r) => (
              <li key={r} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 block shrink-0 rounded-full"
                  style={{ width: 5, height: 5, background: "var(--primary)" }}
                />
                <span style={{ fontSize: "var(--text-sm)" }}>{r}</span>
              </li>
            ))}
          </ul>

          {rules.length > 0 && (
            <>
              <p className="micro-label mt-7">In this routine</p>
              <ul className="mt-3 flex flex-col gap-2">
                {rules.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-3">
                    <span style={{ fontSize: "var(--text-body)" }}>{s.label}</span>
                    <span className="micro-label" style={{ color: "var(--primary)" }}>
                      {HARD_RULE_LABEL[s.hardRule!]}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------- confidence */}
      <section className="mb-12">
        <SectionHeading>{voice.detail.historyTitle}</SectionHeading>
        <ConfidenceChart points={routine.confidenceHistory} now={now} />
      </section>

      {/* ------------------------------------------------------------- lessons */}
      <section className="mb-12">
        <SectionHeading count={lessons.length || undefined}>{voice.lessons.title}</SectionHeading>
        {lessons.length === 0 ? (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {voice.lessons.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lessons.map((l) => (
              <li
                key={l.id}
                className="agent-voice"
                style={{
                  background: "var(--primary-soft)",
                  borderRadius: "var(--radius-card-sm)",
                  padding: "16px 20px",
                }}
              >
                <p>{l.lesson}</p>
                <p className="mt-1" style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}>
                  {l.stepLabel} &middot;{" "}
                  {l.kind === "answer"
                    ? voice.lessons.viaAnswer
                    : l.kind === "rule"
                      ? voice.lessons.viaRule
                      : voice.lessons.viaCorrection}{" "}
                  &middot; {ago(l.at, now)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------------------- runs */}
      <section className="mb-12">
        <SectionHeading count={runs.length || undefined}>{voice.detail.runsTitle}</SectionHeading>
        {runs.length === 0 ? (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {voice.detail.noRuns}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {runs.map((r) => (
              <li
                className={r.outcome === "stopped" ? "pressed" : "raised"}
                key={r.id}
                style={{ padding: "20px 24px" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="micro-label">
                    {r.unattended ? "while you were out" : r.supervised ? "watched" : "on its own"}{" "}
                    &middot; {ago(r.at, now)}
                  </span>
                  <span
                    className="tabular-nums"
                    style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                  >
                    {formatDuration(r.durationSec)}
                  </span>
                </div>
                <p className="agent-voice mt-2">{r.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <Button
          variant="ghost"
          onClick={async () => {
            await mimic.forgetRoutine(routine.id);
            router.push("/routines");
          }}
        >
          {voice.detail.forget}
        </Button>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function StagePanel({
  routine,
  now,
  onAskUnattended,
}: {
  routine: Routine;
  now: number;
  onAskUnattended: () => void;
}) {
  const paused = useMimic((s) => s.observation.paused);

  if (routine.stage === "learning") {
    return (
      <div className="pressed" style={{ padding: 26 }}>
        <ProgressBar value={routine.confidence} label={voice.common.confidence} />
        {routine.unsure && (
          <p
            className="agent-voice mt-5"
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
      </div>
    );
  }

  if (routine.stage === "trusted" || routine.stage === "unattended") {
    const eligible = unattendedEligible(routine);
    return (
      <div className="pressed" style={{ padding: 26 }}>
        <div className="flex items-center gap-4">
          <Pulse size={48} paused={paused} className="-m-2" />
          <div>
            <p style={{ fontWeight: 600 }}>
              {routine.stage === "unattended" ? voice.unattended.marker : voice.trusted.marker}
            </p>
            <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {routine.lastRunAt
                ? voice.trusted.lastRun(ago(routine.lastRunAt, now))
                : voice.trusted.never}
            </p>
          </div>
        </div>

        {routine.stage === "trusted" && (
          <div className="mt-7">
            <ProgressBar
              value={(routine.presentRunsPassed / routine.presentRunsRequired) * 100}
              label="Toward running while you're out"
              showValue={false}
            />
            <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.unattended.progress(routine.presentRunsPassed, routine.presentRunsRequired)}
            </p>
            {eligible && (
              <Button variant="primary" className="mt-6" onClick={onAskUnattended}>
                Hear the second ask
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pressed" style={{ padding: 26 }}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <RunPips
          passed={routine.provingRunsPassed}
          required={routine.provingRunsRequired}
          active={routine.stage === "supervised"}
        />
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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="micro-label">Runs before I&rsquo;m trusted</span>
        <div className="flex gap-2">
          {[3, 4, 5].map((n) => {
            const on = routine.provingRunsRequired === n;
            return (
              <button
                key={n}
                onClick={() => mimic.setProvingRuns(routine.id, n)}
                className="pressable cursor-pointer tabular-nums"
                style={{
                  width: 38,
                  height: 34,
                  borderRadius: "var(--radius-control)",
                  background: on ? "var(--primary-soft)" : "var(--surface)",
                  color: on ? "var(--primary)" : "var(--slate)",
                  fontWeight: on ? 600 : 400,
                  boxShadow: on ? "none" : "var(--elev-raised-sm)",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <Detail id={id} />;
}

export default function RoutineDetailPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
