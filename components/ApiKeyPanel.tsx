"use client";

import { useState } from "react";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { Button, Toggle } from "./ui";

/**
 * Where Doppel's intelligence comes from.
 *
 * The key is verified against the API before it is stored, so nobody walks
 * away believing this is switched on when it isn't. It lives in this machine's
 * application data and is never sent to the interface — the panel only ever
 * sees the last few characters back.
 */
export function ApiKeyPanel({ compact = false }: { compact?: boolean }) {
  const ai = useDoppel((s) => s.ai);
  const stats = useDoppel((s) => s.stats);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await doppel.setApiKey(draft);
    setBusy(false);
    if (result?.ok) setDraft("");
    else setError(result?.detail ?? "That didn't work.");
  };

  const good = ai.configured && (ai.verified || ai.fromEnvironment);

  return (
    <div className={compact ? "" : "pressed"} style={compact ? undefined : { padding: 28 }}>
      {!compact && (
        <>
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>{voice.mind.keyTitle}</p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.mind.keyBody}
          </p>
        </>
      )}

      {good ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="agent-voice" style={{ color: "var(--primary)" }}>
            {ai.fromEnvironment ? voice.mind.keyFromEnv : voice.mind.keyGood(ai.hint)}
          </p>
          {!ai.fromEnvironment && (
            <Button variant="ghost" size="sm" onClick={() => doppel.clearApiKey()}>
              {voice.mind.keyClear}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
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
                padding: "12px 16px",
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

          <p className="agent-voice mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            {error ? voice.mind.keyBad(error) : voice.mind.keyMissing}
          </p>
        </>
      )}

      {good && !compact && (
        <>
          <div className="mt-8 flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p className="micro-label">
                {ai.autoWatch ? voice.mind.autoWatch : voice.mind.autoWatchOff}
              </p>
              <p
                className="agent-voice mt-2"
                style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
              >
                {voice.mind.watchBody}
              </p>
            </div>
            <Toggle
              checked={ai.autoWatch}
              onChange={(on) => doppel.setAutoWatch(on)}
              label="Look on my own"
            />
          </div>

          {/* How closely it reads — the setting with the real cost attached. */}
          <div className="mt-9">
            <p className="micro-label">{voice.mind.detailTitle}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["thorough", "light"] as const).map((level) => {
                const on = ai.detail === level;
                return (
                  <button
                    key={level}
                    onClick={() => doppel.setDetail(level)}
                    className="pressable cursor-pointer"
                    style={{
                      padding: "10px 18px",
                      borderRadius: "var(--radius-control)",
                      background: on ? "var(--primary-soft)" : "var(--surface)",
                      color: on ? "var(--primary)" : "var(--slate)",
                      fontWeight: on ? 600 : 400,
                      fontSize: "var(--text-sm)",
                      boxShadow: on ? "none" : "var(--elev-raised-sm)",
                    }}
                  >
                    {level === "thorough" ? voice.mind.detailThorough : voice.mind.detailLight}
                  </button>
                );
              })}
            </div>
            <p
              className="agent-voice mt-3"
              style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
            >
              {ai.detail === "thorough"
                ? voice.mind.detailThoroughBody
                : voice.mind.detailLightBody}
            </p>
            <p className="micro-label mt-3">
              {voice.mind.detailCost(stats.looks ?? 0, stats.visionTokens ?? 0)}
            </p>
          </div>

          {/* The counterweight. Stated where the setting is, not buried. */}
          <div
            className="agent-voice mt-8"
            style={{
              background: "var(--primary-soft)",
              borderRadius: "var(--radius-card-sm)",
              padding: "18px 22px",
            }}
          >
            <p style={{ fontWeight: 600, color: "var(--primary)" }}>{voice.mind.privacyTitle}</p>
            <p className="mt-2" style={{ fontSize: "var(--text-sm)" }}>
              {voice.mind.privacyBody}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
