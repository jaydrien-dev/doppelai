"use client";

import Link from "next/link";
import { useState } from "react";
import { awayMinutesLeft, byStage, mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago } from "@/lib/time";
import { routineHref } from "@/lib/nav";
import { Pulse } from "@/components/Pulse";
import { Mascot } from "@/components/Mascot";
import { ProgressBar } from "@/components/ProgressBar";
import { Button, SectionHeading, Toggle } from "@/components/ui";

const ACTION_OPTIONS = [5, 12, 25, 50];
const HOUR_OPTIONS = [1, 3, 6, 12];

/**
 * Handing over the keys. One screen, one decision, and a plain sentence at the
 * bottom saying exactly what is being permitted. Not a settings page.
 */
export default function AwayPage() {
  const routines = useMimic((s) => s.routines);
  const away = useMimic((s) => s.away);
  const now = useMimic((s) => s.now);
  const runs = useMimic((s) => s.runs);
  const jobs = useMimic((s) => s.jobs);

  const eligible = byStage(routines, "unattended");

  const [selected, setSelected] = useState<string[] | null>(null);
  const [actionCap, setActionCap] = useState(12);
  const [hours, setHours] = useState(3);
  const [keepAlive, setKeepAlive] = useState(true);

  const chosen = selected ?? eligible.map((r) => r.id);
  const toggle = (id: string) =>
    setSelected(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  /* --------------------------------------------------------- live session -- */
  if (away.active) {
    const minutes = awayMinutesLeft(away, now);
    const total = Math.max(1, Math.round((away.expiresAt - away.grantedAt) / 60_000));
    const during = runs.filter((r) => r.at >= away.grantedAt);

    return (
      <div className="max-w-[720px]">
        <header className="mb-12 flex items-center gap-6">
          <Pulse size={92} />
          <div>
            <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>{voice.away.active}</h1>
            <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
              {voice.away.remaining(minutes)}
            </p>
          </div>
        </header>

        <section className="mb-12">
          <div className="raised" style={{ padding: 30 }}>
            <ProgressBar value={(minutes / total) * 100} label="Authority left" showValue={false} />

            <div className="mt-9 grid grid-cols-2 gap-y-8 md:grid-cols-3">
              <Figure value={`${away.actionsUsed} / ${away.actionCap}`} label="Things done" />
              <Figure value={String(away.routineIds.length)} label="Routines allowed" />
              <Figure value={away.keepAlive ? "Held awake" : "May sleep"} label="This machine" />
            </div>

            <p className="agent-voice mt-9" style={{ fontSize: "var(--text-sm)" }}>
              {voice.away.hardRules}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => mimic.endAway()}>
                {voice.away.end}
              </Button>
              <Button onClick={() => mimic.openPocket()}>Open Pocket</Button>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <SectionHeading count={jobs.length || undefined}>Sent from Pocket</SectionHeading>
          {jobs.length === 0 ? (
            <p className="agent-voice" style={{ color: "var(--slate)" }}>
              {voice.pocket.empty}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {jobs.map((j) => (
                <li
                  key={j.id}
                  className="flat"
                  style={{ padding: "18px 22px", boxShadow: "var(--elev-pressed-sm)" }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span style={{ fontWeight: 600 }}>{j.routineTitle}</span>
                    <span className="micro-label">{j.state.replace("-", " ")}</span>
                  </div>
                  {j.stepLabel && j.state === "running" && (
                    <p
                      className="mt-1"
                      style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                    >
                      {j.stepLabel}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeading count={during.length || undefined}>{voice.away.sinceTitle}</SectionHeading>
          {during.length === 0 ? (
            <p className="agent-voice" style={{ color: "var(--slate)" }}>
              {voice.away.sinceEmpty}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {during.map((r) => (
                <li key={r.id} className="raised" style={{ padding: "20px 24px" }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Link href={routineHref(r.routineId)} style={{ fontWeight: 600 }}>
                      {r.routineTitle}
                    </Link>
                    <span className="micro-label">{ago(r.at, now)}</span>
                  </div>
                  <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)" }}>
                    {r.note}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  /* ------------------------------------------------------- the authorization */
  return (
    <div className="max-w-[720px]">
      <header className="mb-12 flex items-start gap-6">
        <Mascot mood="watching" size="lg" />
        <div>
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>{voice.away.title}</h1>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.away.intro}
          </p>
        </div>
      </header>

      <section className="mb-12">
        <SectionHeading>{voice.away.routinesLabel}</SectionHeading>
        <p className="mb-5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.away.routinesNote}
        </p>

        {eligible.length === 0 ? (
          <div className="pressed" style={{ padding: 26 }}>
            <p className="agent-voice" style={{ color: "var(--slate)" }}>
              {voice.away.routinesEmpty}
            </p>
            <Link
              href="/routines"
              className="mt-4 inline-block"
              style={{ color: "var(--primary)", fontSize: "var(--text-sm)" }}
            >
              See what&rsquo;s close
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {eligible.map((r) => {
              const on = chosen.includes(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => toggle(r.id)}
                  className="pressable w-full cursor-pointer text-left"
                  style={{
                    padding: "22px 26px",
                    borderRadius: "var(--radius-card)",
                    background: on ? "var(--surface)" : "var(--bg-base)",
                    boxShadow: on ? "var(--elev-raised)" : "var(--elev-pressed-sm)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p style={{ fontWeight: 600, letterSpacing: "var(--tracking-tight)" }}>
                        {r.title}
                      </p>
                      <p
                        className="agent-voice mt-1"
                        style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                      >
                        {r.intent}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="block shrink-0 rounded-full"
                      style={{
                        width: 12,
                        height: 12,
                        background: on ? "var(--primary)" : "var(--bg-base)",
                        boxShadow: on ? "0 0 8px var(--primary-glow)" : "var(--elev-pressed-sm)",
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-12">
        <SectionHeading>How far I may go</SectionHeading>
        <div className="raised flex flex-col gap-9" style={{ padding: 30 }}>
          <Choice
            label={voice.away.actionsLabel}
            options={ACTION_OPTIONS}
            value={actionCap}
            onChange={setActionCap}
            format={(n) => String(n)}
          />
          <Choice
            label={voice.away.durationLabel}
            options={HOUR_OPTIONS}
            value={hours}
            onChange={setHours}
            format={(n) => `${n}h`}
          />

          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p className="micro-label">{voice.away.keepAliveLabel}</p>
              <p
                className="agent-voice mt-2"
                style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
              >
                {voice.away.keepAliveNote}
              </p>
            </div>
            <Toggle checked={keepAlive} onChange={setKeepAlive} label="Keep awake" />
          </div>
        </div>
      </section>

      <section>
        <div
          className="agent-voice"
          style={{
            background: "var(--primary-soft)",
            borderRadius: "var(--radius-card)",
            padding: 30,
          }}
        >
          <p className="micro-label" style={{ color: "var(--primary)" }}>
            {voice.away.summaryTitle}
          </p>
          <p className="mt-4" style={{ fontSize: "var(--text-title)", lineHeight: 1.5 }}>
            {voice.away.summary(chosen.length, actionCap, hours)}
          </p>
          <p className="mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {voice.away.hardRules}
          </p>

          <Button
            variant="primary"
            size="lg"
            className="mt-8"
            disabled={chosen.length === 0}
            onClick={() =>
              mimic.grantAway({ routineIds: chosen, actionCap, hours, keepAlive })
            }
          >
            {voice.away.grant}
          </Button>
        </div>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function Choice({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: number[];
  value: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
}) {
  return (
    <div>
      <p className="micro-label">{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              className="pressable cursor-pointer tabular-nums"
              style={{
                padding: "10px 20px",
                borderRadius: "var(--radius-control)",
                background: on ? "var(--primary-soft)" : "var(--bg-base)",
                color: on ? "var(--primary)" : "var(--ink)",
                fontWeight: on ? 600 : 400,
                fontSize: "var(--text-sm)",
                boxShadow: on ? "none" : "var(--elev-pressed-sm)",
              }}
            >
              {format(n)}
            </button>
          );
        })}
      </div>
    </div>
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
