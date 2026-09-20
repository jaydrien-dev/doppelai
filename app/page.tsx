"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import type { InboxTask, Nudge } from "@/lib/store";
import { voice } from "@/lib/voice";
import { minutesSince, ago } from "@/lib/time";
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
  const inbox = useDoppel((s) => s.inbox);
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

      {/* ------------------------------------------------- morning briefing */}
      {connected && ai.configured && !paused && stats.eventsSeen > 5 && (
        <MorningBriefing />
      )}

      {/* ------------------------------------------------ pick up where I left off */}
      {connected && !paused && seen && (
        <ResumeButton lastApp={seen.app} lastText={seen.text} />
      )}

      {/* ----------------------------------------------------------- nudges */}
      {nudges.length > 0 && <NudgeCards nudges={nudges} />}

      {/* ----------------------------------------------------------- inbox */}
      {connected && ai.configured && <InboxSection tasks={inbox} />}

      {/* ----------------------------------------------- setup prompts -------- */}
      {needsSetup && <SetupPrompts />}
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
   Inbox — task queue for external AI agents
   =========================================================================== */

function InboxSection({ tasks }: { tasks: InboxTask[] }) {
  const now = useDoppel((s) => s.now);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);

  const active = tasks.filter((t) => t.status !== "done" && t.status !== "rejected");
  const completed = tasks.filter((t) => t.status === "done");
  const visible = expanded ? tasks : active;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await doppel.inboxCreate(text, true);
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "pending": return "var(--slate)";
      case "approved": return "var(--primary)";
      case "claimed": return "#e89b00";
      case "done": return "#3a3";
      case "failed": return "#e55";
      case "rejected": return "var(--slate)";
      default: return "var(--slate)";
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "pending": return "Waiting for approval";
      case "approved": return "Queued for agent";
      case "claimed": return "Agent working...";
      case "done": return "Done";
      case "failed": return "Failed";
      case "rejected": return "Rejected";
      default: return s;
    }
  };

  return (
    <section className="mb-12">
      <SectionHeading>
        <span className="flex items-center gap-3">
          Inbox
          {active.length > 0 && (
            <span
              style={{
                fontSize: "var(--text-xs, 11px)",
                background: "var(--primary)",
                color: "white",
                borderRadius: 10,
                padding: "2px 8px",
                fontWeight: 600,
              }}
            >
              {active.length}
            </span>
          )}
        </span>
      </SectionHeading>
      <p
        className="mb-5 -mt-2"
        style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}
      >
        Send tasks to your connected AI agents. They&apos;ll pick them up via MCP.
      </p>

      {/* Compose */}
      <div className="mb-5 flex items-center gap-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft.trim() && send()}
          placeholder="What should the agent do?"
          className="min-w-0 flex-1"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-control)",
            background: "var(--bg-base)",
            boxShadow: "var(--elev-pressed-sm)",
            fontSize: "var(--text-sm)",
            color: "var(--ink)",
          }}
        />
        <Button variant="primary" onClick={send} disabled={!draft.trim()}>
          Send
        </Button>
      </div>

      {/* Task list */}
      <AnimatePresence initial={false}>
        {visible.map((task) => (
          <motion.div
            key={task.id}
            layout
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="raised mb-3"
              style={{
                padding: "16px 20px",
                borderLeft: `3px solid ${statusColor(task.status)}`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                    {task.instruction}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <span
                      style={{
                        fontSize: "var(--text-xs, 11px)",
                        color: statusColor(task.status),
                        fontWeight: 600,
                      }}
                    >
                      {statusLabel(task.status)}
                    </span>
                    {task.agent && (
                      <span className="micro-label">{task.agent}</span>
                    )}
                    <span className="micro-label">
                      {ago(task.createdAt, now)}
                    </span>
                  </div>
                  {task.result && (
                    <div
                      className="mt-3"
                      style={{
                        padding: "10px 14px",
                        borderRadius: "var(--radius-control)",
                        background: "var(--surface-alt)",
                        fontSize: "var(--text-sm)",
                        color: "var(--ink)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {task.result}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {task.status === "pending" && (
                    <>
                      <Button variant="primary" size="sm" onClick={() => doppel.inboxApprove(task.id)}>
                        Approve
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => doppel.inboxReject(task.id)}>
                        Reject
                      </Button>
                    </>
                  )}
                  {(task.status === "failed" || task.status === "rejected") && (
                    <Button variant="ghost" size="sm" onClick={() => doppel.inboxRetry(task.id)}>
                      Retry
                    </Button>
                  )}
                  {(task.status === "approved" || task.status === "pending") && (
                    <Button variant="ghost" size="sm" onClick={() => doppel.inboxReject(task.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Show/hide completed */}
      {completed.length > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="cursor-pointer"
          style={{
            fontSize: "var(--text-xs, 11px)",
            color: "var(--slate)",
            background: "none",
            border: "none",
            marginTop: 4,
          }}
        >
          Show {completed.length} completed
        </button>
      )}
      {expanded && tasks.length > active.length && (
        <div className="flex items-center gap-4" style={{ marginTop: 4 }}>
          <button
            onClick={() => setExpanded(false)}
            className="cursor-pointer"
            style={{
              fontSize: "var(--text-xs, 11px)",
              color: "var(--slate)",
              background: "none",
              border: "none",
            }}
          >
            Hide completed
          </button>
          <button
            onClick={() => doppel.inboxClear()}
            className="cursor-pointer"
            style={{
              fontSize: "var(--text-xs, 11px)",
              color: "var(--slate)",
              background: "none",
              border: "none",
            }}
          >
            Clear finished
          </button>
        </div>
      )}
    </section>
  );
}

/* ===========================================================================
   Nudge Cards
   =========================================================================== */

function NudgeCards({ nudges }: { nudges: Nudge[] }) {
  const handleAct = async (nudge: Nudge) => {
    await doppel.actOnNudge(nudge.id);
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
