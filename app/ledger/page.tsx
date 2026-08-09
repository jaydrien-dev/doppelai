"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago, DAY, formatDuration, formatMinutes, WEEK, weekStart } from "@/lib/time";
import { routineHref } from "@/lib/nav";
import type { RunRecord } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { Button, SectionHeading } from "@/components/ui";
import { RunRecording } from "@/components/RunRecording";

/**
 * The receipt. Everything here happened: real durations, real changes on disk,
 * and a "put it back" that genuinely puts it back.
 */
export default function LedgerPage() {
  const runs = useMimic((s) => s.runs);
  const now = useMimic((s) => s.now);
  const ready = useMimic((s) => s.ready);
  const [recording, setRecording] = useState<RunRecord | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const thisWeekStart = weekStart(now);
  const thisWeek = runs.filter((r) => r.at >= thisWeekStart);
  const lastWeek = runs.filter((r) => r.at >= thisWeekStart - WEEK && r.at < thisWeekStart);

  const sum = (rs: RunRecord[]) => ({
    count: rs.length,
    minutes: rs.reduce((n, r) => n + (r.rolledBack ? 0 : r.minutesSaved), 0),
    corrections: rs.reduce((n, r) => n + r.corrections, 0),
    unattended: rs.filter((r) => r.unattended).length,
    changes: rs.reduce((n, r) => n + r.changes.length, 0),
  });

  const a = sum(thisWeek);
  const b = sum(lastWeek);
  const delta = a.minutes - b.minutes;

  const trend =
    b.minutes === 0
      ? voice.ledger.trendFlat
      : delta > 0
        ? voice.ledger.trendUp(delta)
        : delta < 0
          ? voice.ledger.trendDown(-delta)
          : voice.ledger.trendFlat;

  const peak = Math.max(a.minutes, b.minutes, 1);
  const recent = runs.filter((r) => now - r.at <= DAY);

  return (
    <div className="max-w-[720px]">
      <header className="mb-12">
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>{voice.ledger.title}</h1>
        <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
          {voice.ledger.intro(a.count, a.minutes)}
        </p>
      </header>

      {ready && runs.length === 0 ? (
        <div className="pressed" style={{ padding: 30 }}>
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>{voice.ledger.empty}</p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.ledger.emptySub}
          </p>
        </div>
      ) : (
        <>
          {/* ------------------------------------------------------- headline */}
          <section className="mb-12">
            <div className="raised" style={{ padding: 32 }}>
              <div className="grid grid-cols-2 gap-y-10 md:grid-cols-4">
                <Figure value={formatMinutes(a.minutes)} label="Time returned" accent />
                <Figure value={String(a.count)} label="Routines run" />
                <Figure value={String(a.changes)} label="Things changed" />
                <Figure value={String(a.corrections)} label="Corrections" />
              </div>

              <div className="mt-10 flex flex-col gap-5">
                <WeekBar label="This week" minutes={a.minutes} peak={peak} accent />
                <WeekBar label="Last week" minutes={b.minutes} peak={peak} />
              </div>

              <p className="agent-voice mt-8" style={{ fontSize: "var(--text-sm)" }}>
                {trend} {voice.ledger.correctionsNote(a.corrections)}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={async () => {
                    const out = await mimic.exportWeek();
                    if (out?.ok && out.file) setExported(out.file);
                  }}
                >
                  {voice.ledger.exportCta}
                </Button>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {exported ? voice.ledger.exported(exported) : voice.ledger.exportBody}
                </span>
              </div>
            </div>
          </section>

          {/* ----------------------------------------------------------- undo */}
          <section className="mb-12">
            <SectionHeading count={recent.length || undefined}>
              {voice.ledger.undoWindow}
            </SectionHeading>
            <div className="pressed" style={{ padding: 24 }}>
              {recent.length === 0 ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {voice.ledger.undoEmpty}
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {recent.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3">
                      <span style={{ fontSize: "var(--text-sm)" }}>
                        {r.routineTitle}{" "}
                        <span style={{ color: "var(--slate)" }}>&middot; {ago(r.at, now)}</span>
                      </span>
                      <RollbackControl record={r} />
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => mimic.revealTrash()}
                className="mt-5 cursor-pointer"
                style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
              >
                {voice.ledger.trash}
              </button>
            </div>
          </section>

          {/* ------------------------------------------------------------ list */}
          <section>
            <SectionHeading count={thisWeek.length || undefined}>
              Every run this week
            </SectionHeading>
            {thisWeek.length === 0 ? (
              <p className="agent-voice" style={{ color: "var(--slate)" }}>
                {voice.ledger.empty}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {[...thisWeek]
                  .sort((x, y) => y.at - x.at)
                  .map((r) => (
                    <LedgerRow key={r.id} record={r} now={now} onPlay={() => setRecording(r)} />
                  ))}
              </ul>
            )}
          </section>
        </>
      )}

      <RunRecording
        record={recording}
        open={Boolean(recording)}
        onClose={() => setRecording(null)}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function LedgerRow({
  record,
  now,
  onPlay,
}: {
  record: RunRecord;
  now: number;
  onPlay: () => void;
}) {
  const [open, setOpen] = useState(false);
  const stopped = record.outcome === "stopped";

  return (
    <li
      className={stopped ? "pressed" : record.supervised ? "raised" : "flat"}
      style={{ padding: "20px 24px", opacity: record.rolledBack ? 0.55 : 1 }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Link
          href={routineHref(record.routineId)}
          className="transition-opacity hover:opacity-70"
          style={{ fontWeight: 600, letterSpacing: "var(--tracking-tight)" }}
        >
          {record.routineTitle}
        </Link>
        <span className="tabular-nums" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {formatDuration(record.durationSec)}
          {record.minutesSaved > 0 && ` · saved ${record.minutesSaved} min`}
        </span>
      </div>

      <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)" }}>
        {record.note}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="micro-label">
          {record.unattended ? "while you were out" : record.supervised ? "you watched" : "on its own"}{" "}
          &middot; {ago(record.at, now)}
          {record.rolledBack && " · put back"}
        </span>
        <button
          onClick={() => setOpen(!open)}
          className="cursor-pointer"
          style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
        >
          {open ? "Close" : voice.ledger.why}
        </button>
        {record.recording && record.steps.length > 0 && (
          <button
            onClick={onPlay}
            className="cursor-pointer"
            style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
          >
            {voice.ledger.recording}
          </button>
        )}
        <RollbackControl record={record} />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="agent-voice mt-5"
              style={{
                background: "var(--primary-soft)",
                borderRadius: "var(--radius-card-sm)",
                padding: "18px 22px",
              }}
            >
              <Reason label={voice.ledger.whySaw} text={record.reasoning.saw} />
              <Reason label={voice.ledger.whyInferred} text={record.reasoning.inferred} />
              {record.reasoning.applied && (
                <Reason label={voice.ledger.whyApplied} text={record.reasoning.applied} />
              )}

              <p className="micro-label mt-6">{voice.run.changesLabel}</p>
              {record.changes.length === 0 ? (
                <p className="mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {voice.run.noChanges}
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {record.changes.map((c, i) => (
                    <li
                      key={`${c}-${i}`}
                      style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              )}

              {record.rollbackNote && (
                <p className="mt-4" style={{ fontSize: "var(--text-sm)" }}>
                  {record.rollbackNote}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function Reason({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="micro-label">{label}</p>
      <p className="mt-1" style={{ fontSize: "var(--text-sm)" }}>
        {text}
      </p>
    </div>
  );
}

function RollbackControl({ record }: { record: RunRecord }) {
  const [busy, setBusy] = useState(false);

  if (record.rolledBack) return <span className="micro-label">put back</span>;
  if (!record.reversible) return <span className="micro-label">{voice.ledger.notReversible}</span>;

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await mimic.rollback(record.id);
        setBusy(false);
      }}
      className="cursor-pointer"
      style={{ fontSize: "var(--text-sm)", color: "var(--primary)", opacity: busy ? 0.5 : 1 }}
    >
      {voice.ledger.rollback}
    </button>
  );
}

function Figure({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="tabular-nums"
        style={{
          fontSize: "var(--text-display)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-tight)",
          color: accent ? "var(--primary)" : "var(--ink)",
        }}
      >
        {value}
      </span>
      <span className="micro-label">{label}</span>
    </div>
  );
}

function WeekBar({
  label,
  minutes,
  peak,
  accent = false,
}: {
  label: string;
  minutes: number;
  peak: number;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-5">
      <span className="micro-label" style={{ minWidth: 84 }}>
        {label}
      </span>
      <div className="flex-1">
        <ProgressBar
          value={(minutes / peak) * 100}
          showValue={false}
          height={12}
          tone={accent ? "primary" : "slate"}
        />
      </div>
      <span
        className="tabular-nums"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--slate)",
          minWidth: 56,
          textAlign: "right",
        }}
      >
        {formatMinutes(minutes)}
      </span>
    </div>
  );
}
