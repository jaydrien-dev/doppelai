"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago } from "@/lib/time";
import { appLabel } from "@/lib/events";
import type { BrainEntity, BrainStats, ContextPack, MorningBrief } from "@/lib/types";
import { Pulse } from "@/components/Pulse";
import { Mascot } from "@/components/Mascot";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";
import { Button, SectionHeading } from "@/components/ui";

/**
 * The inside of Doppel's head: what it is seeing, what it has kept, and what it
 * would hand itself if you asked it to do something.
 */
export default function MindPage() {
  const ai = useDoppel((s) => s.ai);
  const narration = useDoppel((s) => s.narration);
  const stats = useDoppel((s) => s.stats);
  const now = useDoppel((s) => s.now);
  const screenAllowed = useDoppel((s) => s.permissions.screen);

  const [brain, setBrain] = useState<BrainStats | null>(null);
  const [entities, setEntities] = useState<BrainEntity[]>([]);
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setBrain(await doppel.brainStats());
    setEntities(await doppel.brainEntities());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, narration.length]);

  const look = async () => {
    setLooking(true);
    setLookError(null);
    const result = await doppel.lookNow();
    setLooking(false);
    if (!result?.ok) setLookError(explain(result?.reason, result?.detail));
    else refresh();
  };

  return (
    <div className="max-w-[720px]">
      <header className="mb-12 flex items-start gap-6">
        <Mascot mood={ai.configured && screenAllowed ? "watching" : "idle"} size="lg" />
        <div>
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>{voice.mind.title}</h1>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.mind.intro}
          </p>
        </div>
      </header>

      {/* --------------------------------------------------------------- key */}
      {!ai.configured && (
        <section className="mb-14">
          <ApiKeyPanel />
        </section>
      )}

      {/* -------------------------------------------------------- morning brief */}
      <section className="mb-14">
        <MorningBriefSection />
      </section>

      {/* ------------------------------------------------------------ seeing */}
      <section className="mb-14">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <SectionHeading count={narration.length || undefined}>
            {voice.mind.feedTitle}
          </SectionHeading>
          <div className="flex items-center gap-3">
            {looking && <Pulse size={30} className="-m-1" />}
            <Button size="sm" onClick={look} disabled={looking || !ai.configured}>
              {looking ? voice.mind.looking : voice.mind.lookNow}
            </Button>
          </div>
        </div>

        {lookError && (
          <p
            className="agent-voice mb-4"
            style={{
              background: "var(--primary-soft)",
              borderRadius: "var(--radius-card-sm)",
              padding: "14px 18px",
              fontSize: "var(--text-sm)",
            }}
          >
            {lookError}
          </p>
        )}

        {narration.length === 0 ? (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {voice.mind.feedEmpty}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {narration.slice(0, 20).map((line) => (
                <motion.li
                  key={line.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
                  className={line.recovery ? "flat" : line.salience >= 0.6 ? "raised" : "flat"}
                  style={{
                    padding: "18px 22px",
                    boxShadow: line.salience >= 0.6 && !line.recovery ? undefined : "var(--elev-pressed-sm)",
                    opacity: line.sensitive ? 0.6 : 1,
                    ...(line.recovery
                      ? {
                          borderLeft: "3px solid var(--primary)",
                          background: "var(--primary-soft)",
                        }
                      : {}),
                  }}
                >
                  <p className="agent-voice">{line.text}</p>
                  {line.intent && (
                    <p
                      className="agent-voice mt-1.5"
                      style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                    >
                      {line.intent}
                    </p>
                  )}
                  {line.adaptation && (
                    <p
                      className="agent-voice mt-1.5"
                      style={{ fontSize: "var(--text-sm)", color: "var(--primary)", fontStyle: "italic" }}
                    >
                      {line.adaptation}
                    </p>
                  )}
                  <p className="micro-label mt-3">
                    {line.app ? `${appLabel(line.app)} · ` : ""}
                    {ago(line.at, now)}
                    {line.reason ? ` · ${line.reason}` : ""}
                  </p>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {/* -------------------------------------------------------------- recall */}
      <section className="mb-14">
        <SectionHeading>{voice.mind.recallTitle}</SectionHeading>
        <RecallBox />
      </section>

      {/* --------------------------------------------------------------- brain */}
      <section>
        <SectionHeading>{voice.mind.brainTitle}</SectionHeading>
        <p className="mb-5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.mind.brainBody}
        </p>

        <div className="pressed" style={{ padding: 26 }}>
          <p className="agent-voice">
            {brain
              ? voice.mind.brainStats(brain.episodes, brain.entities, brain.digests)
              : voice.mind.brainEmpty}
          </p>
          <p className="micro-label mt-3">
            {stats.looks ?? 0} looks &middot; {(stats.visionTokens ?? 0).toLocaleString()} tokens spent
            seeing
          </p>

          {/* How the memories are actually kept. */}
          <p
            className="agent-voice mt-5"
            style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
          >
            {brain?.vectors?.available === false && brain.vectors.count === 0
              ? voice.mind.storageOffline
              : voice.mind.storageBody}
          </p>
          <p className="micro-label mt-3">
            {voice.mind.storageStats(brain?.vectors?.count ?? 0, brain?.vectors?.bytes ?? 0)}
          </p>

        </div>

        {entities.length > 0 && (
          <div className="mt-6 flex flex-col gap-3">
            {entities.slice(0, 30).map((entity) => (
              <div
                key={entity.id}
                className="raised flex flex-wrap items-start justify-between gap-5"
                style={{ padding: "18px 22px" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span style={{ fontWeight: 600 }}>{entity.name}</span>
                    <span className="micro-label">{entity.kind}</span>
                  </div>
                  {entity.note && (
                    <p
                      className="agent-voice mt-1.5"
                      style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                    >
                      {entity.note}
                    </p>
                  )}
                  <p className="micro-label mt-2">
                    seen {entity.seenCount} times &middot; last {ago(entity.lastSeen, now)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await doppel.brainForget(entity.id);
                    refresh();
                  }}
                >
                  {voice.mind.forget}
                </Button>
              </div>
            ))}
          </div>
        )}

        <ImportDocuments onDone={refresh} />

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button
            variant="ghost"
            onClick={async () => {
              const result = await doppel.exportBrain();
              if (result?.ok && result.file) {
                useDoppel.getState().setFlash(
                  `Exported ${result.stats?.totalEpisodes ?? 0} episodes to ${result.file}`,
                );
              }
            }}
          >
            Export brain
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              if (!window.confirm(voice.mind.wipeConfirm)) return;
              await doppel.wipeBrain();
              refresh();
            }}
          >
            {voice.mind.wipe}
          </Button>
        </div>
      </section>

    </div>
  );
}

/* --------------------------------------------------------------------------- */

/**
 * Ask what it remembers.
 *
 * Memories are stored as vectors and terse records, not prose — so this asks
 * the question, retrieves by meaning, and has Doppel put the answer back into
 * English. The raw records are underneath for anyone who wants to check it.
 */
function RecallBox() {
  const [query, setQuery] = useState("");
  const [pack, setPack] = useState<ContextPack | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const now = useDoppel((s) => s.now);
  const configured = useDoppel((s) => s.ai.configured);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setAnswer(null);

    if (configured) {
      const result = await doppel.askBrain(query);
      setPack(result?.pack ?? null);
      setAnswer(result?.ok ? (result.text ?? "") : null);
    } else {
      const result = await doppel.recall(query);
      setPack(result?.pack ?? null);
    }
    setBusy(false);
  };

  const empty =
    pack && pack.entities.length === 0 && pack.episodes.length === 0 && pack.digests.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={voice.mind.recallPlaceholder}
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
        <Button variant="primary" onClick={search} disabled={busy || !query.trim()}>
          {busy ? voice.mind.recallThinking : voice.mind.recallSearch}
        </Button>
      </div>

      {/* The answer, in English, reconstructed from what was retrieved. */}
      {answer !== null && answer !== "" && (
        <div
          className="agent-voice mt-5"
          style={{
            background: "var(--primary-soft)",
            borderRadius: "var(--radius-card-sm)",
            padding: "20px 24px",
            whiteSpace: "pre-wrap",
          }}
        >
          {answer}
        </div>
      )}

      {pack && (
        <div className="mt-5">
          {empty ? (
            <p className="agent-voice" style={{ color: "var(--slate)" }}>
              {voice.mind.recallEmpty}
            </p>
          ) : !showRaw ? (
            <button
              onClick={() => setShowRaw(true)}
              className="cursor-pointer"
              style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
            >
              {voice.mind.recallShowRaw}
            </button>
          ) : (
            <div className="pressed" style={{ padding: 24 }}>
              <div className="mb-5 flex items-baseline justify-between gap-4">
                <p className="micro-label">{voice.mind.recallRawTitle}</p>
                <button
                  onClick={() => setShowRaw(false)}
                  className="cursor-pointer"
                  style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
                >
                  Hide
                </button>
              </div>
              {pack.entities.length > 0 && (
                <>
                  <p className="micro-label">Things involved</p>
                  <ul className="mb-5 mt-2 flex flex-col gap-1.5">
                    {pack.entities.map((e) => (
                      <li key={e.id} style={{ fontSize: "var(--text-sm)" }}>
                        {e.line}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {pack.digests.length > 0 && (
                <>
                  <p className="micro-label">Recently</p>
                  <ul className="mb-5 mt-2 flex flex-col gap-2">
                    {pack.digests.map((d) => (
                      <li key={d.label} style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                        {d.summary}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {pack.episodes.length > 0 && (
                <>
                  <p className="micro-label">Moments</p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {pack.episodes.map((e) => (
                      <li key={e.id} style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                        {e.activity}
                        <span className="ml-2 opacity-60">{ago(e.at, now)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="micro-label mt-6">{voice.mind.recallNote(pack.tokens)}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------- */

function MorningBriefSection() {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = useDoppel((s) => s.ai.configured);

  useEffect(() => {
    doppel.morningBriefCached().then((r) => {
      if (r.ok && r.brief) setBrief(r.brief);
    });
  }, []);

  const generate = async () => {
    setLoading(true);
    setError(null);
    const result = await doppel.morningBrief();
    setLoading(false);
    if (result.ok && result.brief) setBrief(result.brief);
    else setError(("detail" in result ? result.detail : null) ?? result.reason ?? "Couldn't generate a brief.");
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <SectionHeading>{voice.brief.title}</SectionHeading>
        <Button size="sm" onClick={generate} disabled={loading || !configured}>
          {loading ? voice.brief.generating : brief ? voice.brief.refresh : voice.brief.title}
        </Button>
      </div>

      {error && (
        <p className="agent-voice mb-4" style={{
          background: "var(--primary-soft)", borderRadius: "var(--radius-card-sm)",
          padding: "14px 18px", fontSize: "var(--text-sm)",
        }}>
          {error}
        </p>
      )}

      {brief ? (
        <div className="raised" style={{ padding: "24px 28px" }}>
          <p className="agent-voice" style={{ fontWeight: 600, marginBottom: 12 }}>
            {brief.greeting}
          </p>
          <p className="agent-voice" style={{ marginBottom: 16, color: "var(--slate)" }}>
            {brief.yesterday}
          </p>

          {brief.patterns.length > 0 && (
            <div className="mb-4">
              <p className="micro-label mb-2">{voice.brief.patterns}</p>
              <ul className="flex flex-col gap-1.5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {brief.patterns.map((p, i) => <li key={i}>· {p}</li>)}
              </ul>
            </div>
          )}

          {brief.connections.length > 0 && (
            <div className="mb-4">
              <p className="micro-label mb-2">{voice.brief.connections}</p>
              <ul className="flex flex-col gap-1.5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {brief.connections.map((c, i) => <li key={i}>· {c}</li>)}
              </ul>
            </div>
          )}

          {brief.openThreads.length > 0 && (
            <div className="mb-4">
              <p className="micro-label mb-2">{voice.brief.openThreads}</p>
              <ul className="flex flex-col gap-1.5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {brief.openThreads.map((t, i) => <li key={i}>· {t}</li>)}
              </ul>
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
            <p className="micro-label mb-1">{voice.brief.suggestion}</p>
            <p className="agent-voice" style={{ fontSize: "var(--text-sm)" }}>{brief.suggestion}</p>
          </div>
        </div>
      ) : !loading && (
        <p className="agent-voice" style={{ color: "var(--slate)" }}>
          {configured ? voice.brief.notReady : voice.brief.noKey}
        </p>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------- */

function ImportDocuments({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ total: number; files: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importFiles = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await doppel.ingestDocument();
    setBusy(false);
    if (!res) return; // user cancelled picker
    if (res.ok) {
      setResult({ total: res.episodes ?? 0, files: res.files ?? [] });
      onDone();
    } else {
      setError(res.detail ?? "Import failed.");
    }
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" onClick={importFiles} disabled={busy}>
          {busy ? "Importing\u2026" : "Import documents"}
        </Button>
        {busy && <Pulse size={24} className="-m-1" />}
      </div>

      {result && (
        <div
          className="agent-voice mt-3"
          style={{
            background: "var(--primary-soft)",
            borderRadius: "var(--radius-card-sm)",
            padding: "14px 18px",
            fontSize: "var(--text-sm)",
          }}
        >
          Imported {result.files.length} document{result.files.length !== 1 ? "s" : ""} into{" "}
          {result.total} memory episode{result.total !== 1 ? "s" : ""}.
          {result.files.length > 0 && (
            <span style={{ color: "var(--slate)", marginLeft: 8 }}>
              {result.files.join(", ")}
            </span>
          )}
        </div>
      )}

      {error && (
        <p
          className="agent-voice mt-3"
          style={{
            background: "var(--primary-soft)",
            borderRadius: "var(--radius-card-sm)",
            padding: "14px 18px",
            fontSize: "var(--text-sm)",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function explain(reason?: string, detail?: string) {
  switch (reason) {
    case "no-key":
      return voice.mind.keyMissing;
    case "no-permission":
      return "Reading the screen isn't switched on yet.";
    case "paused":
      return voice.den.paused;
    case "too-soon":
      return "I only just looked. Give it a moment.";
    case "busy":
      return "I'm already looking.";
    case "refused":
      return "I was declined on that screen, so I've left it alone.";
    default:
      return voice.mind.lookFailed(detail ?? reason ?? "something went wrong");
  }
}
