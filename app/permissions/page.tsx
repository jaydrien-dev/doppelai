"use client";

import { mimic, useMimic } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago } from "@/lib/time";
import { describeEvent } from "@/lib/events";
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
  const permissions = useMimic((s) => s.permissions);
  const paused = useMimic((s) => s.observation.paused);
  const roots = useMimic((s) => s.observation.roots);
  const entities = useMimic((s) => s.entities);
  const events = useMimic((s) => s.recentEvents);
  const overlay = useMimic((s) => s.overlay);
  const now = useMimic((s) => s.now);

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
            <Toggle checked={!paused} onChange={(on) => mimic.setPaused(!on)} label="Observation" />
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
              onChange={(on) => mimic.overlaySetEnabled(on)}
              label="Overlay"
            />
          </div>
          {overlay.enabled && (
            <Button variant="ghost" size="sm" className="mt-5" onClick={() => mimic.overlayHome()}>
              {voice.overlay.home}
            </Button>
          )}
        </div>
      </section>

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
                <Button variant="ghost" size="sm" onClick={() => mimic.removeRoot(root)}>
                  {voice.permissions.removeFolder}
                </Button>
              </div>
            ))}
          </div>
        )}

        <Button className="mt-5" onClick={() => mimic.addRoot()}>
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
              onToggle={() => mimic.setPermissions({ [p.key]: !permissions[p.key] })}
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
              onToggle={() => mimic.setPermissions({ [p.key]: !permissions[p.key] })}
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
          {voice.rules.reassure("my own trash")}{" "}
          <button
            onClick={() => mimic.revealTrash()}
            className="cursor-pointer"
            style={{ color: "var(--primary)" }}
          >
            {voice.ledger.trash}
          </button>
        </p>
      </section>

      {/* ---------------------------------------------------------- live feed */}
      <section className="mb-14">
        <SectionHeading>{voice.permissions.feedTitle}</SectionHeading>
        <p className="mb-5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.permissions.feedNote}
        </p>
        <div className="pressed" style={{ padding: 24 }}>
          {events.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.permissions.feedEmpty}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {events.slice(0, 12).map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-3">
                  <span style={{ fontSize: "var(--text-sm)" }}>{describeEvent(e)}</span>
                  <span className="micro-label">{ago(e.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* -------------------------------------------------------------- memory */}
      <section>
        <SectionHeading count={entities.length || undefined}>{voice.memory.title}</SectionHeading>
        <p className="mb-5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.memory.body}
        </p>

        {entities.length === 0 ? (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {voice.memory.empty}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {entities.map((e) => (
              <div
                key={e.id}
                className="raised flex flex-wrap items-start justify-between gap-5"
                style={{ padding: "20px 24px" }}
              >
                <div className="min-w-0 flex-1">
                  <p style={{ fontWeight: 600 }}>{e.name}</p>
                  <p
                    className="agent-voice mt-1.5"
                    style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                  >
                    {e.note}
                  </p>
                  <p className="micro-label mt-2">{voice.memory.learned(ago(e.learnedAt, now))}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => mimic.forgetEntity(e.id)}>
                  {voice.memory.forget}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
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
