"use client";

import { useEffect, useState } from "react";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import type { Permissions } from "@/lib/types";
import { Pulse } from "@/components/Pulse";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";
import { Button, SectionHeading, Toggle } from "@/components/ui";

const L = voice.permissions.labels;

const WATCH: { key: keyof Permissions; label: string; detail: string }[] = [
  { key: "windows", label: L.windows, detail: L.windowsDetail },
  { key: "files", label: L.files, detail: L.filesDetail },
  { key: "screen", label: L.screen, detail: L.screenDetail },
  { key: "clipboard", label: L.clipboard, detail: L.clipboardDetail },
];

const ACT: { key: keyof Permissions; label: string; detail: string }[] = [
  { key: "actFiles", label: L.actFiles, detail: L.actFilesDetail },
  { key: "actWrite", label: L.actWrite, detail: L.actWriteDetail },
  { key: "actLaunch", label: L.actLaunch, detail: L.actLaunchDetail },
  { key: "actTrash", label: L.actTrash, detail: L.actTrashDetail },
  { key: "actGui", label: L.actGui, detail: L.actGuiDetail },
];

export default function PermissionsPage() {
  const permissions = useDoppel((s) => s.permissions);
  const paused = useDoppel((s) => s.observation.paused);
  const roots = useDoppel((s) => s.observation.roots);
  const overlay = useDoppel((s) => s.overlay);
  const whisper = useDoppel((s) => s.whisper);
  const nudgeSettings = useDoppel((s) => s.nudgeSettings);
  return (
    <div className="max-w-[720px]">
      <header className="mb-12">
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>Permissions</h1>
        <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
          {voice.permissions.intro}
        </p>
      </header>

      {/* ------------------------------------------------------------ the stop */}
      <section className="mb-14">
        <div className={paused ? "pressed" : "raised"} style={{ padding: 28 }}>
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <Pulse size={64} paused={paused} className="-m-2" />
              <div>
                <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
                  {paused ? voice.permissions.resume : voice.permissions.pause}
                </p>
                <p
                  className="agent-voice mt-1"
                  style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                >
                  {paused ? voice.den.pausedSub : "Everything stops. Nothing is recorded."}
                </p>
              </div>
            </div>
            <Toggle checked={!paused} onChange={(on) => doppel.setPaused(!on)} label="Observation" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- the key */}
      <section className="mb-14">
        <ApiKeyPanel />
      </section>

      {/* ----------------------------------------------------------- overlay */}
      <section className="mb-14">
        <div className={overlay.enabled ? "raised" : "flat"} style={{ padding: 28 }}>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
                {voice.overlay.title}
              </p>
              <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
                {voice.overlay.body}
              </p>
            </div>
            <Toggle
              checked={overlay.enabled}
              onChange={(on) => doppel.overlaySetEnabled(on)}
              label="Overlay"
            />
          </div>
          {overlay.enabled && (
            <Button variant="ghost" size="sm" className="mt-5" onClick={() => doppel.overlayHome()}>
              {voice.overlay.home}
            </Button>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- whisper */}
      <section className="mb-14">
        <div className={whisper.enabled ? "raised" : "flat"} style={{ padding: 28 }}>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
                {voice.whisper.title}
              </p>
              <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
                {voice.whisper.body}
              </p>
              {whisper.enabled && (
                <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  Hotkey: <span style={{ fontWeight: 600, color: "var(--ink)" }}>{whisper.hotkey}</span>
                  {whisper.autoDismiss > 0 && (
                    <span> · auto-dismiss after {whisper.autoDismiss}s</span>
                  )}
                </p>
              )}
            </div>
            <Toggle
              checked={whisper.enabled}
              onChange={(on) => doppel.whisperSetEnabled(on)}
              label="Whisper"
            />
          </div>
          {whisper.enabled && (
            <Button variant="ghost" size="sm" className="mt-5" onClick={() => doppel.whisperHome()}>
              {voice.whisper.home}
            </Button>
          )}
        </div>

        {whisper.enabled && (
          <div className="pressed mt-5" style={{ padding: 28 }}>
            <p style={{ fontWeight: 600 }}>{voice.whisper.openaiTitle}</p>
            <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.whisper.openaiBody}
            </p>
            <OpenAIKeyInput />
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- nudges */}
      <section className="mb-14">
        <div className={nudgeSettings.enabled ? "raised" : "flat"} style={{ padding: 28 }}>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
                Proactive suggestions
              </p>
              <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
                Doppel will suggest things when it notices patterns, open tasks, or repeated work.
              </p>
            </div>
            <Toggle
              checked={nudgeSettings.enabled}
              onChange={(on) => doppel.nudgeSetEnabled(on)}
              label="Nudges"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- biometric lock */}
      <BiometricPanel />

      {/* -------------------------------------------------------- display */}
      {permissions.screen && (
        <section className="mb-14">
          <DisplayPicker />
        </section>
      )}

      {/* --------------------------------------------------- it all stays here */}
      <section className="mb-14">
        <div className="pressed" style={{ padding: 28 }}>
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {voice.permissions.localTitle}
          </p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.permissions.localBody}
          </p>
          <p
            className="agent-voice mt-4"
            style={{
              fontSize: "var(--text-sm)",
              color: permissions.screen ? "var(--primary)" : "var(--slate)",
            }}
          >
            {permissions.screen
              ? voice.permissions.localScreen
              : voice.permissions.localScreenOff}
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------- folders */}
      <section className="mb-14">
        <SectionHeading count={roots.length || undefined}>
          {voice.permissions.foldersTitle}
        </SectionHeading>
        <p className="mb-5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.permissions.foldersNote}
        </p>

        {roots.length === 0 ? (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {voice.permissions.foldersEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {roots.map((root) => (
              <div
                key={root}
                className="raised flex flex-wrap items-center justify-between gap-4"
                style={{ padding: "18px 24px" }}
              >
                <span
                  className="min-w-0 break-all"
                  style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}
                >
                  {root}
                </span>
                <Button variant="ghost" size="sm" onClick={() => doppel.removeRoot(root)}>
                  {voice.permissions.removeFolder}
                </Button>
              </div>
            ))}
          </div>
        )}

        <Button className="mt-5" onClick={() => doppel.addRoot()}>
          {voice.permissions.addFolder}
        </Button>
      </section>

      {/* --------------------------------------------------------------- watch */}
      <section className="mb-14">
        <SectionHeading>{voice.permissions.watchTitle}</SectionHeading>
        <div className="flex flex-col gap-3">
          {WATCH.map((p) => (
            <Row
              key={p.key}
              label={p.label}
              detail={p.detail}
              enabled={permissions[p.key]}
              disabled={paused}
              onToggle={() => doppel.setPermissions({ [p.key]: !permissions[p.key] })}
            />
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------------- act */}
      <section className="mb-14">
        <SectionHeading>{voice.permissions.actTitle}</SectionHeading>
        <div className="flex flex-col gap-3">
          {ACT.map((p) => (
            <Row
              key={p.key}
              label={p.label}
              detail={p.detail}
              enabled={permissions[p.key]}
              onToggle={() => doppel.setPermissions({ [p.key]: !permissions[p.key] })}
            />
          ))}
        </div>

        {permissions.actGui && (
          <p
            className="agent-voice mt-5"
            style={{
              background: "var(--primary-soft)",
              borderRadius: "var(--radius-card-sm)",
              padding: "16px 20px",
              fontSize: "var(--text-sm)",
            }}
          >
            {voice.permissions.guiWarning}
          </p>
        )}

        <p className="mt-5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          Anything removed goes to my own trash, never really deleted.{" "}
          <button
            onClick={() => doppel.revealTrash()}
            className="cursor-pointer"
            style={{ color: "var(--primary)" }}
          >
            {voice.panel.trash}
          </button>
        </p>
      </section>

    </div>
  );
}

function OpenAIKeyInput() {
  const ai = useDoppel((s) => s.ai);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await doppel.setOpenAIKey(draft);
    setBusy(false);
    if (result?.ok) setDraft("");
    else setError(result?.detail ?? "That didn't work.");
  };

  if (ai.openaiConfigured) {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="agent-voice" style={{ color: "var(--primary)" }}>
          {voice.whisper.openaiGood(ai.openaiHint)}
        </p>
        <Button variant="ghost" size="sm" onClick={() => doppel.clearOpenAIKey()}>
          {voice.whisper.openaiClear}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft && save()}
          placeholder={voice.whisper.openaiPlaceholder}
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
          {busy ? "Saving" : voice.whisper.openaiSave}
        </Button>
      </div>
      <p className="agent-voice mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
        {error ?? voice.whisper.openaiMissing}
      </p>
    </>
  );
}

function Row({
  label,
  detail,
  enabled,
  onToggle,
  disabled = false,
}: {
  label: string;
  detail: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={enabled ? "raised" : "flat"}
      style={{
        padding: "22px 26px",
        opacity: disabled ? 0.45 : 1,
        transition: "opacity var(--dur-fade) var(--ease-calm)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p style={{ fontWeight: 500 }}>{label}</p>
          <p
            className="agent-voice mt-1.5"
            style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
          >
            {detail}
          </p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} label={label} />
      </div>
    </div>
  );
}

function BiometricPanel() {
  const security = useDoppel((s) => s.security);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.doppel?.securityAvailable?.().then((r) => {
      setAvailable(r?.available ?? false);
    }).catch(() => setAvailable(false));
  }, []);

  if (available === null) return null; // still checking

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const result = await doppel.securitySetBiometric(!security.biometric);
    setBusy(false);
    if (!result?.ok) setError(result?.detail ?? voice.security.failed);
  };

  return (
    <section className="mb-14">
      <div className={security.biometric ? "raised" : "flat"} style={{ padding: 28 }}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
              {voice.security.title}
            </p>
            <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
              {available ? voice.security.body : voice.security.unavailable}
            </p>
            {error && (
              <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--danger, #ef4444)" }}>
                {error}
              </p>
            )}
          </div>
          {available && (
            <Toggle
              checked={security.biometric}
              onChange={toggle}
              label="Biometric lock"
            />
          )}
        </div>
        {security.biometric && (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => doppel.securityLock()}>
              {voice.security.lockNow}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

interface DisplayInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

function DisplayPicker() {
  const currentId = useDoppel((s) => s.observation.displayId);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => {
    doppel.listDisplays().then(setDisplays);
  }, []);

  if (displays.length <= 1) return null;

  return (
    <div className="raised" style={{ padding: 28 }}>
      <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
        {voice.permissions.displayTitle}
      </p>
      <p className="agent-voice mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
        {voice.permissions.displayNote}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {displays.map((d) => {
          const selected = currentId ? currentId === d.id : d.primary;
          return (
            <button
              key={d.id}
              onClick={() => doppel.setDisplay(d.primary && !currentId ? null : d.primary ? null : d.id)}
              className="cursor-pointer"
              style={{
                padding: "12px 20px",
                borderRadius: "var(--radius-control)",
                background: selected ? "var(--primary)" : "var(--bg-base)",
                color: selected ? "white" : "var(--ink)",
                fontWeight: selected ? 600 : 400,
                fontSize: "var(--text-sm)",
                border: "none",
                transition: "all 0.15s ease",
                boxShadow: selected ? "0 2px 8px var(--primary-glow)" : "var(--elev-pressed-sm)",
              }}
            >
              <span>{d.label}</span>
              <span style={{ opacity: 0.7, marginLeft: 8 }}>
                {d.width}x{d.height}
                {d.primary ? " · " + voice.permissions.displayPrimary : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
