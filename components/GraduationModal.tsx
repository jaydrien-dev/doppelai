"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { Modal } from "./Modal";
import { Mascot } from "./Mascot";
import { Pulse } from "./Pulse";
import { Button } from "./ui";

/**
 * The two graduations. Deliberately the same shape and deliberately separate
 * events — being trusted at the machine is not the same as being trusted while
 * the user is out, and the UI must never let them blur.
 */
export function GraduationModal() {
  const graduating = useMimic((s) => s.graduating);
  const setGraduating = useMimic((s) => s.setGraduating);
  const routines = useMimic((s) => s.routines);
  const router = useRouter();

  const [granted, setGranted] = useState<null | "trusted" | "unattended">(null);

  const routine = routines.find((r) => r.id === graduating?.routineId);
  const open = Boolean(graduating && routine);
  const second = graduating?.kind === "unattended";

  const close = () => {
    setGranted(null);
    setGraduating(null);
  };

  const grant = async () => {
    if (!routine) return;
    if (second) {
      await mimic.grantUnattended(routine.id);
      setGranted("unattended");
    } else {
      await mimic.graduate(routine.id);
      setGranted("trusted");
    }
  };

  if (!routine) return null;

  if (granted) {
    return (
      <Modal open={open} onClose={close} dismissable={false}>
        <div className="flex flex-col items-center text-center">
          <Mascot mood="pleased" size="lg" />
          <p className="agent-voice mt-8" style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {granted === "unattended"
              ? voice.unattended.granted(routine.title)
              : voice.graduation.granted(routine.title)}
          </p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {granted === "unattended" ? voice.unattended.grantedSub : voice.graduation.grantedSub}
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {granted === "unattended" ? (
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  router.push("/away");
                }}
              >
                Set up a session
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  router.push("/ledger");
                }}
              >
                See the ledger
              </Button>
            )}
            <Button variant="ghost" onClick={close}>
              {voice.run.close}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} dismissable={false} width={560}>
      <div className="flex flex-col items-center text-center">
        <Pulse size={132} />
        <p className="micro-label mt-2">
          {second ? voice.unattended.eyebrow : voice.graduation.eyebrow}
        </p>

        <h2 className="agent-voice mt-5" style={{ fontSize: "var(--text-display)", fontWeight: 600 }}>
          {second ? voice.unattended.ask : voice.graduation.ask}
        </h2>

        <p className="agent-voice mt-5 max-w-[420px]" style={{ color: "var(--slate)" }}>
          {second ? voice.unattended.body(routine.presentRunsPassed) : voice.graduation.body}
        </p>

        <div
          className="mt-8 w-full text-left"
          style={{
            background: "var(--primary-soft)",
            borderRadius: "var(--radius-card-sm)",
            padding: "18px 22px",
          }}
        >
          <p className="agent-voice" style={{ fontSize: "var(--text-sm)" }}>
            {second ? voice.unattended.caveats : voice.graduation.scope}
          </p>
        </div>

        <p className="mt-6" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.graduation.reassure}
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Button variant="primary" size="lg" onClick={grant}>
            {second ? voice.unattended.grant : voice.graduation.grant}
          </Button>
          <Button variant="ghost" size="lg" onClick={close}>
            {second ? voice.unattended.notYet : voice.graduation.notYet}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
