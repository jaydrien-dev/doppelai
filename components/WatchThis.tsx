"use client";

import { useState } from "react";
import { mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { Modal } from "./Modal";
import { Pulse } from "./Pulse";
import { Mascot } from "./Mascot";
import { Button } from "./ui";

type Phase = "offer" | "watching" | "learned" | "nothing";

/**
 * Teaching mode, for real.
 *
 * Arming marks a point in the event journal. Everything observed between that
 * point and "I'm finished" is treated as one deliberate demonstration and
 * weighted heavily — which is what makes Mimic useful on the first day rather
 * than the sixth week.
 */
export function WatchThis({ open, onClose }: { open: boolean; onClose: () => void }) {
  const paused = useMimic((s) => s.observation.paused);
  const routines = useMimic((s) => s.routines);
  const connected = useMimic((s) => s.connected);

  const [phase, setPhase] = useState<Phase>("offer");
  const [result, setResult] = useState<{ title: string; confidence: number } | null>(null);

  const close = () => {
    if (phase === "watching") mimic.cancelTeaching();
    setPhase("offer");
    setResult(null);
    onClose();
  };

  const start = async () => {
    await mimic.armTeaching();
    setPhase("watching");
  };

  const finish = async () => {
    const outcome = await mimic.finishTeaching();
    if (!outcome?.ok) {
      setPhase("nothing");
      return;
    }
    const routine = useMimic.getState().routines.find((r) => r.id === outcome.routineId);
    setResult({
      title: routine?.title ?? "that",
      confidence: outcome.confidence ?? routine?.confidence ?? 0,
    });
    setPhase("learned");
  };

  /* --- it worked out what it saw --- */
  if (phase === "learned" && result) {
    return (
      <Modal open={open} onClose={close}>
        <div className="flex flex-col items-center text-center">
          <Mascot mood="pleased" size="lg" />
          <p className="agent-voice mt-8" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {voice.teach.learned(result.title)}
          </p>
          <p className="mt-3" style={{ color: "var(--slate)" }}>
            {voice.teach.jump(Math.round(result.confidence))}
          </p>
          <p
            className="agent-voice mt-4"
            style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
          >
            {voice.teach.learnedSub}
          </p>
          <Button variant="primary" className="mt-8" onClick={close}>
            Right
          </Button>
        </div>
      </Modal>
    );
  }

  /* --- it genuinely didn't see enough --- */
  if (phase === "nothing") {
    return (
      <Modal open={open} onClose={close}>
        <div className="flex flex-col items-center text-center">
          <Mascot mood="unsure" size="lg" />
          <p className="agent-voice mt-8" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {voice.teach.nothing}
          </p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.teach.nothingSub}
          </p>
          <div className="mt-8 flex gap-3">
            <Button variant="primary" onClick={start}>
              {voice.teach.arm}
            </Button>
            <Button variant="ghost" onClick={close}>
              {voice.teach.cancel}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  /* --- it is watching now --- */
  if (phase === "watching") {
    return (
      <Modal open={open} onClose={close} dismissable={false}>
        <div className="flex flex-col items-center text-center">
          <Pulse size={140} />
          <p className="agent-voice mt-6" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {voice.teach.armed}
          </p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.teach.armedSub}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={finish}>
              {voice.teach.done}
            </Button>
            <Button variant="ghost" onClick={close}>
              {voice.teach.cancel}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  /* --- the offer --- */
  const learning = routines.filter((r) => r.stage === "learning");

  return (
    <Modal open={open} onClose={close}>
      <div className="flex items-start gap-5">
        <Mascot mood="watching" size="lg" />
        <div className="min-w-0">
          <h2 style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>{voice.teach.title}</h2>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.teach.body}
          </p>
        </div>
      </div>

      {learning.length > 0 && (
        <div className="pressed mt-8" style={{ padding: 22 }}>
          <p className="micro-label">Things I&rsquo;m part-way through</p>
          <ul className="mt-3 flex flex-col gap-2">
            {learning.slice(0, 3).map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-4">
                <span style={{ fontSize: "var(--text-sm)" }}>{r.title}</span>
                <span
                  className="tabular-nums"
                  style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                >
                  {r.confidence}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {paused && (
        <p
          className="agent-voice mt-6"
          style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
        >
          {voice.teach.pausedWarning}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="primary" onClick={start} disabled={paused || !connected}>
          {voice.teach.arm}
        </Button>
        <Button variant="ghost" onClick={close}>
          {voice.teach.cancel}
        </Button>
      </div>
    </Modal>
  );
}
