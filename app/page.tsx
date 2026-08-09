"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { awaiting, awayMinutesLeft, mimic, stageCounts, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { minutesSince } from "@/lib/time";
import { unattendedEligible } from "@/lib/plan";
import { appGlyph, appLabel, currentApp, describeEvent } from "@/lib/events";
import { routineHref, runHref } from "@/lib/nav";
import { Pulse } from "@/components/Pulse";
import { AppTile } from "@/components/AppTile";
import { AgentLine, Button, ButtonLink, SectionHeading } from "@/components/ui";

/**
 * The Den. Mostly empty on purpose — the pulse, one line about what Mimic is
 * actually seeing right now, and anything waiting on you.
 */
export default function DenPage() {
  const ready = useMimic((s) => s.ready);
  const connected = useMimic((s) => s.connected);
  const routines = useMimic((s) => s.routines);
  const paused = useMimic((s) => s.observation.paused);
  const roots = useMimic((s) => s.observation.roots);
  const away = useMimic((s) => s.away);
  const events = useMimic((s) => s.recentEvents);
  const narration = useMimic((s) => s.narration);
  const ai = useMimic((s) => s.ai);
  const stats = useMimic((s) => s.stats);
  const now = useMimic((s) => s.now);
  const setGraduating = useMimic((s) => s.setGraduating);
  const setTeaching = useMimic((s) => s.setTeaching);

  const counts = stageCounts(routines);
  const waiting = awaiting(routines);
  const app = currentApp(events);
  const lastEvent = events[0];

  /* When it can actually read the screen it has something far better to say
     than "a window changed" — lead with that. */
  const seen = narration[0];

  const headline = !connected
    ? voice.first.browser
    : paused
      ? voice.den.paused
      : away.active
        ? voice.den.away
        : seen
          ? seen.text
          : lastEvent
            ? voice.den.watchingNow(describeEvent(lastEvent).toLowerCase())
            : voice.den.watchingNothing;

  const subline = !connected
    ? ""
    : paused
      ? voice.den.pausedSub
      : away.active
        ? voice.den.awaySub(awayMinutesLeft(away, now), away.routineIds.length)
        : seen?.intent
          ? seen.intent
          : lastEvent
            ? voice.den.lastTick(minutesSince(lastEvent.at, now))
            : voice.first.watching(roots.length);

  const empty = ready && connected && routines.length === 0;

  return (
    <div className="max-w-[720px]">
      {/* ------------------------------------------------------------ presence */}
      <section className="flex flex-col items-center pb-16 pt-6 text-center md:pt-16">
        <Pulse size={168} paused={paused || !connected} />

        <div className="mt-10 max-w-[480px]">
          <AgentLine size="title">{headline}</AgentLine>
          {subline && (
            <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {subline}
            </p>
          )}
        </div>

        {/* the window it's in right now */}
        {connected && !paused && app && (
          <>
            <div className="mt-12">
              <AppTile app={appGlyph(app)} state="active" perch perchMood="watching" size={52} showLabel={false} />
            </div>
            <p className="mt-6" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {appLabel(app)}
            </p>
          </>
        )}
      </section>

      {/* -------------------------------------------------------- first run --- */}
      {empty && (
        <section className="mb-16">
          <div className="pressed" style={{ padding: 30 }}>
            <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>{voice.first.title}</p>
            <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
              {voice.first.body}
            </p>
            <p className="mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.den.seen(stats.eventsSeen, stats.sessionsSeen)}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => setTeaching(true)}>
                {voice.teach.cta}
              </Button>
              <Link href="/permissions" style={{ color: "var(--primary)", fontSize: "var(--text-sm)" }}>
                Choose what I watch
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Without a key it can watch, but it can't understand. Say so once. */}
      {connected && !ai.configured && (
        <section className="mb-12">
          <Link href="/mind" className="block">
            <div className="pressed" style={{ padding: 26 }}>
              <p style={{ fontWeight: 600 }}>{voice.mind.keyTitle}</p>
              <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {voice.mind.keyMissing}
              </p>
            </div>
          </Link>
        </section>
      )}

      {/* ---------------------------------------------------------- away strip */}
      {away.active && (
        <section className="mb-12">
          <Link href="/away" className="block">
            <div
              className="raised flex flex-wrap items-center justify-between gap-4"
              style={{ padding: "22px 26px" }}
            >
              <div>
                <p style={{ fontWeight: 600 }}>{voice.away.active}</p>
                <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {voice.away.used(away.actionsUsed, away.actionCap)}
                </p>
              </div>
              <span className="micro-label" style={{ color: "var(--primary)" }}>
                {voice.away.remaining(awayMinutesLeft(away, now))}
              </span>
            </div>
          </Link>
        </section>
      )}

      {/* -------------------------------------------------------------- waiting */}
      {!empty && (
        <section className="mb-16">
          <SectionHeading count={waiting.length || undefined}>
            {waiting.length ? voice.den.somethingWaiting(waiting.length) : "Nothing waiting"}
          </SectionHeading>

          {waiting.length === 0 ? (
            <p className="agent-voice" style={{ color: "var(--slate)" }}>
              {voice.den.nothingWaiting}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {waiting.map((r) => {
                  const graduating =
                    r.stage === "supervised" && r.provingRunsPassed >= r.provingRunsRequired;
                  const second = unattendedEligible(r);
                  const line = r.drifting
                    ? voice.drift.ask
                    : second
                      ? voice.unattended.ask
                      : graduating
                        ? voice.graduation.ask
                        : voice.ready.prompt;

                  return (
                    <motion.div
                      key={r.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="raised flex flex-wrap items-center justify-between gap-4"
                      style={{ padding: "20px 24px" }}
                    >
                      <div className="min-w-0">
                        <Link
                          href={routineHref(r.id)}
                          className="block transition-opacity hover:opacity-70"
                          style={{ fontWeight: 600, letterSpacing: "var(--tracking-tight)" }}
                        >
                          {r.title}
                        </Link>
                        <p
                          className="agent-voice mt-1"
                          style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                        >
                          {line}
                        </p>
                      </div>

                      {r.drifting ? (
                        <Button variant="primary" size="sm" onClick={() => mimic.relearn(r.id)}>
                          {voice.drift.accept}
                        </Button>
                      ) : second || graduating ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            setGraduating({
                              routineId: r.id,
                              kind: second ? "unattended" : "trusted",
                            })
                          }
                        >
                          Hear it out
                        </Button>
                      ) : (
                        <ButtonLink href={runHref(r.id)} variant="primary" size="sm">
                          {voice.ready.cta}
                        </ButtonLink>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- shape */}
      {!empty && (
        <section>
          <SectionHeading>What I know</SectionHeading>
          <Link href="/routines" className="block">
            <div className="pressed grid grid-cols-2 gap-y-8 md:grid-cols-5" style={{ padding: 28 }}>
              <Count n={counts.learning} label="Learning" />
              <Count n={counts.ready} label="Ready" />
              <Count n={counts.supervised} label="Proving" />
              <Count n={counts.trusted} label="On their own" accent />
              <Count n={counts.unattended} label="While you're out" accent />
            </div>
          </Link>
          <p className="mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {voice.den.seen(stats.eventsSeen, stats.sessionsSeen)}
          </p>
        </section>
      )}
    </div>
  );
}

function Count({ n, label, accent = false }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="tabular-nums"
        style={{
          fontSize: "var(--text-display)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-tight)",
          color: accent && n > 0 ? "var(--primary)" : "var(--ink)",
        }}
      >
        {n}
      </span>
      <span className="micro-label">{label}</span>
    </div>
  );
}
