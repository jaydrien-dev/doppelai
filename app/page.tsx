"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import type { AgentRun, Nudge, BrainPattern } from "@/lib/store";
import { voice } from "@/lib/voice";
import { minutesSince, ago, formatDuration } from "@/lib/time";
import { appLabel, currentApp, describeEvent } from "@/lib/events";
import { Pulse } from "@/components/Pulse";
import { Mascot } from "@/components/Mascot";
import { AgentLine, Button, SectionHeading } from "@/components/ui";

/**
 * The Den. The brain's primary surface — what Doppel is noticing, the ability
 * to ask or instruct, and anything waiting on you.
 */
export default function DenPage() {
  const ready = useDoppel((s) => s.ready);
  const connected = useDoppel((s) => s.connected);
  const paused = useDoppel((s) => s.observation.paused);
  const roots = useDoppel((s) => s.observation.roots);
  const events = useDoppel((s) => s.recentEvents);
  const narration = useDoppel((s) => s.narration);
  const ai = useDoppel((s) => s.ai);
  const permissions = useDoppel((s) => s.permissions);
  const nudges = useDoppel((s) => s.nudges);
  const stats = useDoppel((s) => s.stats);
  const now = useDoppel((s) => s.now);

  const isFirstRun = ready && connected && stats.eventsSeen === 0 && !ai.configured;
  const needsSetup = ready && connected && (!ai.configured || roots.length === 0);

  const app = currentApp(events);
  const lastEvent = events[0];
  const seen = narration[0];

  const headline = !connected
    ? voice.first.browser
    : paused
      ? voice.den.paused
      : seen
        ? seen.text
        : lastEvent
          ? voice.den.watchingNow(describeEvent(lastEvent).toLowerCase())
          : voice.den.watchingNothing;

  const subline = !connected
    ? ""
    : paused
      ? voice.den.pausedSub
      : seen?.intent
        ? seen.intent
        : lastEvent
          ? voice.den.lastTick(minutesSince(lastEvent.at, now))
          : voice.first.watching(roots.length);

  /* Show onboarding wizard for brand new users */
  if (isFirstRun) {
    return <OnboardingWizard />;
  }

  return (
    <div className="max-w-[720px]">
      {/* ------------------------------------------------------------ presence */}
      <section className="flex flex-col items-center pb-10 pt-6 text-center md:pt-16">
        <Pulse size={168} paused={paused || !connected} />

        <div className="mt-10 max-w-[480px]">
          <AgentLine size="title">{headline}</AgentLine>
          {subline && (
            <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {subline}
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ quiet status */}
      {connected && ai.configured && !paused && !seen && !lastEvent && stats.eventsSeen === 0 && (
        <p
          className="agent-voice -mt-4 mb-10 text-center"
          style={{ fontSize: "var(--text-sm)", color: "var(--slate)", opacity: 0.6 }}
        >
          Watching quietly. Use your computer normally — I&apos;ll start learning.
        </p>
      )}

      {/* ------------------------------------------------- morning briefing */}
      {connected && ai.configured && !paused && stats.eventsSeen > 5 && (
        <MorningBriefing />
      )}

      {/* ------------------------------------------------ pick up where I left off */}
      {connected && !paused && seen && (
        <ResumeButton lastApp={seen.app} lastText={seen.text} />
      )}

      {/* --------------------------------------------------------- agent task */}
      <AgentTask />

      {/* ----------------------------------------------------------- nudges */}
      {nudges.length > 0 && <NudgeCards nudges={nudges} />}

      {/* ----------------------------------------------- setup prompts -------- */}
      {needsSetup && <SetupPrompts />}

      {/* --------------------------------------------- suggested actions ------ */}
      {connected && ai.configured && stats.eventsSeen < 20 && (
        <SuggestedActions />
      )}

      {/* ------------------------------------------------------------ patterns */}
      {connected && ai.configured && stats.eventsSeen > 10 && (
        <PatternCards />
      )}

      {/* ---------------------------------------------------------- history */}
      <AgentHistory />

      {/* ---------------------------------------------------------- daily recap */}
      {connected && ai.configured && stats.eventsSeen > 10 && (
        <DailyRecap />
      )}

      {/* ---------------------------------------------------------------- stats */}
      {stats.eventsSeen > 0 && (
        <section>
          <SectionHeading>What I know</SectionHeading>
          <div className="pressed" style={{ padding: 28 }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.den.seen(stats.eventsSeen, stats.sessionsSeen)}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

/* ===========================================================================
   Morning Briefing — what happened yesterday, shown at start of day
   =========================================================================== */

function MorningBriefing() {
  const [briefing, setBriefing] = useState<{
    text: string;
    apps: string[];
    count: number;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    /* Only show if this is the first visit today. */
    const key = `doppel-briefing-${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(key)) {
      setLoaded(true);
      return;
    }
    sessionStorage.setItem(key, "1");

    /* Ask the brain for yesterday's summary. */
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    doppel.brainEpisodes(100).then((episodes) => {
      const yEps = episodes.filter(
        (e) => new Date(e.at).toISOString().slice(0, 10) === yesterday,
      );
      if (yEps.length < 3) {
        setLoaded(true);
        return;
      }
      const apps = [...new Set(yEps.map((e) => e.app).filter(Boolean))] as string[];
      const lastActivity = yEps[0]?.activity ?? "";
      setBriefing({
        text: lastActivity
          ? `Yesterday you left off: ${lastActivity.charAt(0).toLowerCase()}${lastActivity.slice(1)}`
          : `Yesterday you worked across ${apps.length} apps.`,
        apps,
        count: yEps.length,
      });
      setLoaded(true);
    });
  }, []);

  if (!loaded || !briefing || dismissed) return null;

  return (
    <section className="mb-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        className="raised"
        style={{
          padding: "22px 26px",
          borderLeft: "3px solid var(--primary)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
              Good {new Date().getHours() < 12 ? "morning" : "afternoon"}
            </p>
            <p
              className="agent-voice mt-2"
              style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
            >
              {briefing.text}
            </p>
            {briefing.apps.length > 0 && (
              <p className="micro-label mt-2">
                {briefing.count} observations across {briefing.apps.map(appLabel).join(", ")}
              </p>
            )}
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="cursor-pointer shrink-0"
            style={{
              fontSize: "var(--text-xs, 11px)",
              color: "var(--slate)",
              background: "none",
              border: "none",
            }}
          >
            Dismiss
          </button>
        </div>
      </motion.div>
    </section>
  );
}

/* ===========================================================================
   Resume Button — pick up where you left off
   =========================================================================== */

function ResumeButton({
  lastApp,
  lastText,
}: {
  lastApp: string | null;
  lastText: string;
}) {
  const [busy, setBusy] = useState(false);

  if (!lastApp) return null;

  const resume = async () => {
    setBusy(true);
    await window.doppel?.resumeLast?.();
    setBusy(false);
  };

  const truncated =
    lastText.length > 50 ? lastText.slice(0, 50) + "\u2026" : lastText;

  return (
    <section className="mb-10">
      <button
        onClick={resume}
        disabled={busy}
        className="pressable w-full cursor-pointer text-left"
        style={{
          padding: "16px 22px",
          borderRadius: "var(--radius-card-sm)",
          background: "var(--surface)",
          boxShadow: "var(--elev-raised-sm)",
          border: "none",
          transition: "all 0.15s ease",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              color: "var(--primary)",
            }}
          >
            Pick up where I left off
          </span>
        </div>
        <p
          className="agent-voice mt-1"
          style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}
        >
          {appLabel(lastApp)} — {truncated}
        </p>
      </button>
    </section>
  );
}

/* ===========================================================================
   Daily Recap — summary of today's work so far
   =========================================================================== */

function DailyRecap() {
  const narration = useDoppel((s) => s.narration);
  const now = useDoppel((s) => s.now);

  /* Only compute from today's narration. */
  const today = new Date().toISOString().slice(0, 10);
  const todayNarration = narration.filter(
    (n) => new Date(n.at).toISOString().slice(0, 10) === today,
  );

  if (todayNarration.length < 5) return null;

  /* App time breakdown — rough estimate from observation timestamps. */
  const appTime: Record<string, number> = {};
  for (let i = 0; i < todayNarration.length; i++) {
    const app = todayNarration[i].app;
    if (!app) continue;
    const next = todayNarration[i + 1];
    const duration = next ? todayNarration[i].at - next.at : 60_000; /* assume 1min for last */
    appTime[app] = (appTime[app] || 0) + Math.min(duration, 600_000); /* cap at 10min gaps */
  }

  const sorted = Object.entries(appTime)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const totalMs = sorted.reduce((s, [, t]) => s + t, 0);
  const totalMins = Math.round(totalMs / 60_000);

  if (totalMins < 5) return null;

  const fmtTime = (ms: number) => {
    const m = Math.round(ms / 60_000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };

  return (
    <section className="mb-14">
      <SectionHeading>Today so far</SectionHeading>
      <div className="pressed mt-5" style={{ padding: 24 }}>
        <p
          className="agent-voice"
          style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
        >
          {todayNarration.length} observations · {totalMins >= 60
            ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m tracked`
            : `${totalMins}m tracked`}
        </p>

        {sorted.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {sorted.map(([app, time]) => {
              const pct = Math.round((time / totalMs) * 100);
              return (
                <div key={app} className="flex items-center gap-3">
                  <span
                    style={{
                      fontSize: "var(--text-xs, 11px)",
                      color: "var(--ink)",
                      width: 80,
                      flexShrink: 0,
                    }}
                  >
                    {appLabel(app)}
                  </span>
                  <div
                    className="flex-1"
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: "var(--surface-alt)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        borderRadius: 3,
                        background: "var(--primary)",
                        opacity: 0.7,
                        transition: "width 0.6s ease",
                      }}
                    />
                  </div>
                  <span className="micro-label" style={{ width: 40, textAlign: "right" }}>
                    {fmtTime(time)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* ===========================================================================
   Onboarding Wizard — shown on first launch, replaces entire Den
   =========================================================================== */

function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const ai = useDoppel((s) => s.ai);
  const permissions = useDoppel((s) => s.permissions);
  const roots = useDoppel((s) => s.observation.roots);

  const steps = [
    { id: "welcome" },
    { id: "key" },
    { id: "screen" },
    { id: "folder" },
    { id: "done" },
  ];

  const canAdvance =
    step === 0 ||
    (step === 1 && ai.configured) ||
    step === 2 ||
    (step === 3 && roots.length > 0) ||
    step === 4;

  const advance = () => {
    if (step < steps.length - 1) setStep(step + 1);
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <div className="w-full max-w-[480px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {step === 0 && <StepWelcome onNext={advance} />}
            {step === 1 && <StepApiKey onNext={advance} onSkip={advance} />}
            {step === 2 && <StepScreen onNext={advance} />}
            {step === 3 && <StepFolder onNext={advance} />}
            {step === 4 && <StepDone />}
          </motion.div>
        </AnimatePresence>

        {/* Progress dots */}
        <div className="mt-10 flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <div
              key={s.id}
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                borderRadius: 4,
                background: i <= step ? "var(--primary)" : "var(--surface-alt)",
                transition: "all 0.2s ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <Mascot mood="idle" size="lg" />
      <p className="mt-8" style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
        {voice.onboarding.welcome}
      </p>
      <p className="agent-voice mx-auto mt-5" style={{ color: "var(--slate)", maxWidth: 380 }}>
        {voice.onboarding.welcomeBody}
      </p>
      <Button variant="primary" size="lg" className="mt-10" onClick={onNext}>
        {voice.onboarding.getStarted}
      </Button>
    </div>
  );
}

function StepApiKey({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const ai = useDoppel((s) => s.ai);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    const result = await doppel.setApiKey(draft.trim());
    setBusy(false);
    if (result?.ok) {
      setDraft("");
      setTimeout(onNext, 400);
    } else {
      setError(result?.detail ?? "That key didn't work. Check it and try again.");
    }
  };

  if (ai.configured) {
    return (
      <div className="text-center">
        <div
          style={{
            width: 64, height: 64, borderRadius: 32,
            background: "var(--primary-soft)", margin: "0 auto",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28,
          }}
        >
          &#10003;
        </div>
        <p className="mt-6" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
          Connected
        </p>
        <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
          {voice.mind.keyGood(ai.hint)}
        </p>
        <Button variant="primary" size="lg" className="mt-8" onClick={onNext}>
          {voice.onboarding.next}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
        {voice.onboarding.stepKey}
      </p>
      <p className="agent-voice mt-4" style={{ color: "var(--slate)" }}>
        {voice.onboarding.stepKeyBody}
      </p>
      <a
        href="https://console.anthropic.com/settings/keys"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block"
        style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
      >
        {voice.onboarding.stepKeyLink} &rarr;
      </a>

      <div className="mt-6 flex items-center gap-3">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft && save()}
          placeholder={voice.mind.keyPlaceholder}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1"
          style={{
            padding: "14px 18px",
            borderRadius: "var(--radius-control)",
            background: "var(--bg-base)",
            boxShadow: "var(--elev-pressed-sm)",
            fontSize: "var(--text-sm)",
            color: "var(--ink)",
            fontFamily: "var(--font-mono, monospace)",
          }}
        />
        <Button variant="primary" onClick={save} disabled={!draft || busy}>
          {busy ? voice.mind.keyChecking : voice.mind.keySave}
        </Button>
      </div>
      {error && (
        <p className="agent-voice mt-3" style={{ fontSize: "var(--text-sm)", color: "#e55" }}>
          {error}
        </p>
      )}
      <button
        onClick={onSkip}
        className="mt-6 cursor-pointer"
        style={{ fontSize: "var(--text-sm)", color: "var(--slate)", background: "none", border: "none" }}
      >
        {voice.onboarding.skip}
      </button>
    </div>
  );
}

function StepScreen({ onNext }: { onNext: () => void }) {
  const screen = useDoppel((s) => s.permissions.screen);

  return (
    <div>
      <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
        {voice.onboarding.stepScreen}
      </p>
      <p className="agent-voice mt-4" style={{ color: "var(--slate)" }}>
        {voice.onboarding.stepScreenBody}
      </p>
      <p className="agent-voice mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
        {voice.onboarding.stepScreenNote}
      </p>

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={() => doppel.setPermissions({ screen: !screen })}
          className="cursor-pointer"
          style={{
            padding: "14px 28px",
            borderRadius: "var(--radius-control)",
            background: screen ? "var(--primary)" : "var(--surface)",
            color: screen ? "white" : "var(--ink)",
            fontWeight: 600,
            border: "none",
            boxShadow: screen ? "0 2px 8px var(--primary-glow)" : "var(--elev-raised-sm)",
            transition: "all 0.15s ease",
          }}
        >
          {screen ? "Screen reading is on" : "Turn on screen reading"}
        </button>
      </div>

      <Button variant="primary" size="lg" className="mt-8" onClick={onNext}>
        {voice.onboarding.next}
      </Button>
    </div>
  );
}

function StepFolder({ onNext }: { onNext: () => void }) {
  const roots = useDoppel((s) => s.observation.roots);

  return (
    <div>
      <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
        {voice.onboarding.stepFolder}
      </p>
      <p className="agent-voice mt-4" style={{ color: "var(--slate)" }}>
        {voice.onboarding.stepFolderBody}
      </p>

      {roots.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          {roots.map((root) => (
            <div
              key={root}
              className="raised flex items-center justify-between gap-3"
              style={{ padding: "12px 16px" }}
            >
              <span style={{ fontSize: "var(--text-sm)", wordBreak: "break-all" }}>{root}</span>
              <Button variant="ghost" size="sm" onClick={() => doppel.removeRoot(root)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button className="mt-5" onClick={() => doppel.addRoot()}>
        {roots.length === 0 ? "Choose a folder" : "Add another folder"}
      </Button>

      <div className="mt-8">
        <Button variant="primary" size="lg" onClick={onNext}>
          {voice.onboarding.next}
        </Button>
      </div>
    </div>
  );
}

function StepDone() {
  return (
    <div className="text-center">
      <Mascot mood="watching" size="lg" />
      <p className="mt-8" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
        {voice.onboarding.stepDone}
      </p>
      <p className="agent-voice mx-auto mt-4" style={{ color: "var(--slate)", maxWidth: 380 }}>
        {voice.onboarding.stepDoneBody}
      </p>
      <Button
        variant="primary"
        size="lg"
        className="mt-8"
        onClick={() => doppel.setPaused(false)}
      >
        {voice.onboarding.done}
      </Button>
    </div>
  );
}

/* ===========================================================================
   Setup Prompts — shown when key or folders still need configuring
   =========================================================================== */

function SetupPrompts() {
  const ai = useDoppel((s) => s.ai);
  const roots = useDoppel((s) => s.observation.roots);

  return (
    <section className="mb-12 flex flex-col gap-3">
      {!ai.configured && (
        <Link href="/mind" className="block">
          <div className="pressed" style={{ padding: 26 }}>
            <p style={{ fontWeight: 600 }}>{voice.mind.keyTitle}</p>
            <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.mind.keyMissing}
            </p>
          </div>
        </Link>
      )}
      {roots.length === 0 && (
        <Link href="/permissions" className="block">
          <div className="pressed" style={{ padding: 26 }}>
            <p style={{ fontWeight: 600 }}>No folders selected</p>
            <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              Pick a folder so I know where your work lives.
            </p>
          </div>
        </Link>
      )}
    </section>
  );
}

/* ===========================================================================
   Suggested Actions — one-click prompts for non-technical users
   =========================================================================== */

function SuggestedActions() {
  const handleSuggestion = (instruction: string) => {
    doppel.runAgent({ instruction });
  };

  return (
    <section className="mb-14">
      <SectionHeading>{voice.suggestions.title}</SectionHeading>
      <div className="mt-5 flex flex-wrap gap-3">
        {voice.suggestions.items.map((item) => (
          <button
            key={item.label}
            onClick={() => handleSuggestion(item.instruction)}
            className="pressable cursor-pointer"
            style={{
              padding: "12px 20px",
              borderRadius: "var(--radius-card-sm)",
              background: "var(--surface)",
              boxShadow: "var(--elev-raised-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              color: "var(--ink)",
              border: "none",
              transition: "all 0.15s ease",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ===========================================================================
   Agent Task — read-only view of current or most recent task
   =========================================================================== */

function AgentTask() {
  const agents = useDoppel((s) => s.agents);

  if (agents.length === 0) return null;

  return (
    <section className="mb-12">
      <AnimatePresence>
        {agents.map((task) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}
            className="mb-3 overflow-hidden"
          >
            <div className="raised" style={{ padding: 24 }}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Mascot mood="working" size="sm" />
                  <p style={{ fontWeight: 600, letterSpacing: "var(--tracking-tight)" }}>
                    {task.title}
                  </p>
                </div>
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

              {task.narration.length > 0 && (
                <ul className="mt-5 flex flex-col gap-2">
                  {task.narration.slice(-5).map((line, i) => (
                    <li
                      key={`${line.at}-${i}`}
                      className="agent-voice"
                      style={{ fontSize: "var(--text-sm)" }}
                    >
                      {line.text}
                    </li>
                  ))}
                </ul>
              )}

              {task.parked && (
                <div
                  className="agent-voice mt-5"
                  style={{
                    background: "var(--primary-soft)",
                    borderRadius: "var(--radius-card-sm)",
                    padding: "16px 20px",
                  }}
                >
                  <p style={{ fontWeight: 600, color: "var(--primary)" }}>
                    {voice.agent.parkedTitle}
                  </p>
                  <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                    {task.parked.detail}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
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
                <div className="pressed mt-5" style={{ padding: 20 }}>
                  <p style={{ fontWeight: 600 }}>
                    {task.summary.outcome === "done"
                      ? voice.agent.doneTitle
                      : voice.agent.stoppedTitle}
                  </p>
                  <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)" }}>
                    {task.summary.text}
                  </p>
                  {task.summary.changed.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1">
                      {task.summary.changed.slice(0, 6).map((c, i) => (
                        <li
                          key={`${c}-${i}`}
                          style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                        >
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="micro-label mt-4">
                    {formatDuration(task.summary.durationSec)} &middot; {task.summary.steps} steps
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}

/* ===========================================================================
   Agent History — past completed runs
   =========================================================================== */

function AgentHistory() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const now = useDoppel((s) => s.now);
  const agents = useDoppel((s) => s.agents);
  /* Refresh history when any task finishes. */
  const doneCount = agents.filter((t) => t.summary).length;

  useEffect(() => {
    doppel.agentHistory(50).then((r) => {
      setRuns(r);
      setLoaded(true);
    });
  }, [doneCount]);

  if (!loaded || runs.length === 0) return null;

  const visible = showAll ? runs : runs.slice(0, 3);

  return (
    <section className="mb-14">
      <SectionHeading>{voice.history.title}</SectionHeading>
      <ul className="mt-5 flex flex-col gap-3">
        {visible.map((run) => (
          <li key={run.id} className="flat" style={{ padding: "16px 20px" }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                  {run.title}
                </p>
                <p className="agent-voice mt-1" style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}>
                  {run.note}
                </p>
              </div>
              <span
                className="micro-label shrink-0"
                style={{ color: run.outcome === "clean" ? "var(--primary)" : "var(--slate)" }}
              >
                {run.outcome === "clean" ? "Done" : "Stopped"}
              </span>
            </div>
            {run.changes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {run.changes.slice(0, 3).map((c, i) => (
                  <span
                    key={`${c}-${i}`}
                    style={{
                      fontSize: "var(--text-xs, 11px)",
                      color: "var(--slate)",
                      background: "var(--surface-alt)",
                      padding: "2px 8px",
                      borderRadius: "var(--radius-control)",
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
            <p className="micro-label mt-2">
              {ago(run.at, now)}
              {run.durationSec > 0 && ` · ${formatDuration(run.durationSec)}`}
              {run.steps > 0 && ` · ${run.steps} steps`}
            </p>
          </li>
        ))}
      </ul>
      {!showAll && runs.length > 3 && (
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => setShowAll(true)}>
          {voice.history.showMore} ({runs.length - 3} more)
        </Button>
      )}
    </section>
  );
}

/* ===========================================================================
   Pattern Cards & Nudge Cards
   =========================================================================== */

function PatternCards() {
  const [patterns, setPatterns] = useState<BrainPattern[]>([]);
  const [loaded, setLoaded] = useState(false);
  const now = useDoppel((s) => s.now);
  const narrationLen = useDoppel((s) => s.narration.length);

  const refresh = useCallback(async () => {
    const result = await doppel.brainPatterns();
    setPatterns(result ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, narrationLen]);

  if (!loaded || patterns.length === 0) return null;

  return (
    <section className="mb-14">
      <SectionHeading>{voice.patterns.title}</SectionHeading>
      <ul className="mt-5 flex flex-col gap-3">
        {patterns.slice(0, 4).map((p) => (
          <li
            key={p.id}
            className="raised flex flex-wrap items-start justify-between gap-4"
            style={{ padding: "16px 20px" }}
          >
            <div className="min-w-0 flex-1">
              <p className="agent-voice" style={{ fontSize: "var(--text-sm)" }}>
                {p.label}
              </p>
              {p.intent && (
                <p
                  className="agent-voice mt-1"
                  style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}
                >
                  {p.intent}
                </p>
              )}
              <p className="micro-label mt-1.5">
                {appLabel(p.app)} &middot; {voice.patterns.count(p.count)} &middot; last {ago(p.lastSeen, now)}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                doppel.runAgent({
                  instruction: p.instruction,
                  title: p.label,
                })
              }
            >
              {voice.patterns.doIt}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NudgeCards({ nudges }: { nudges: Nudge[] }) {
  const handleAct = async (nudge: Nudge) => {
    const result = await doppel.actOnNudge(nudge.id);
    if (!result?.ok) return;

    if (nudge.kind === "offer") {
      doppel.runAgent({
        instruction: nudge.detail ?? nudge.text,
        title: nudge.text,
      });
    }
  };

  return (
    <section className="mb-10">
      <AnimatePresence initial={false}>
        {nudges.map((nudge) => (
          <motion.div
            key={nudge.id}
            layout
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="raised mb-3 flex flex-wrap items-start justify-between gap-4"
              style={{ padding: "18px 22px" }}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Mascot mood="watching" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="agent-voice" style={{ fontSize: "var(--text-sm)" }}>
                    {nudge.text}
                  </p>
                  {nudge.detail && (
                    <p
                      className="agent-voice mt-1"
                      style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}
                    >
                      {nudge.detail}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {nudge.action && (
                  <Button variant="primary" size="sm" onClick={() => handleAct(nudge)}>
                    {nudge.action}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => doppel.dismissNudge(nudge.id)}>
                  {voice.nudge.dismiss}
                </Button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}
