"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { byStage, useMimic } from "@/lib/store";
import { STAGE_ORDER } from "@/lib/types";
import { voice } from "@/lib/voice";
import { RoutineCard } from "@/components/RoutineCard";
import { Button, SectionHeading } from "@/components/ui";

const SECTION_LABEL: Record<string, string> = {
  learning: "Still learning",
  ready: "Ready when you are",
  supervised: "Proving themselves",
  trusted: "Running on their own",
  unattended: "Allowed while you're out",
};

export default function RoutinesPage() {
  const routines = useMimic((s) => s.routines);
  const roots = useMimic((s) => s.observation.roots);
  const stats = useMimic((s) => s.stats);
  const ready = useMimic((s) => s.ready);
  const setTeaching = useMimic((s) => s.setTeaching);

  return (
    <div className="max-w-[720px]">
      <header className="mb-14 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>Routines</h1>
          <p className="mt-3" style={{ color: "var(--slate)" }}>
            Everything I&rsquo;ve picked up, and how far I&rsquo;ve got with each one.
          </p>
        </div>
        <Button variant="primary" onClick={() => setTeaching(true)}>
          {voice.teach.cta}
        </Button>
      </header>

      {ready && routines.length === 0 ? (
        <div className="pressed" style={{ padding: 30 }}>
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {voice.first.noRoutines}
          </p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.first.body}
          </p>
          <p className="mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {voice.first.watching(roots.length)}{" "}
            {voice.den.seen(stats.eventsSeen, stats.sessionsSeen)}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Button variant="primary" onClick={() => setTeaching(true)}>
              {voice.teach.cta}
            </Button>
            <Link
              href="/permissions"
              style={{ color: "var(--primary)", fontSize: "var(--text-sm)" }}
            >
              Choose what I watch
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-16">
          {STAGE_ORDER.map((stage) => {
            const items = byStage(routines, stage);
            if (items.length === 0) return null;
            return (
              <section key={stage}>
                <SectionHeading count={items.length}>{SECTION_LABEL[stage]}</SectionHeading>
                <motion.div layout className="flex flex-col gap-4">
                  <AnimatePresence initial={false}>
                    {items.map((routine) => (
                      <motion.div
                        key={routine.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                      >
                        <RoutineCard routine={routine} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
