"use client";

import { useEffect, useState } from "react";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import type { AddonInfo } from "@/lib/types";
import { SectionHeading, Toggle } from "@/components/ui";

const V = voice.store;

const ICONS: Record<string, string> = {
  browse: "globe",
  scholar: "book",
  weather: "cloud",
  calendar: "calendar",
  mail: "mail",
  addon: "puzzle",
};

function iconFor(icon: string) {
  const name = ICONS[icon] ?? "puzzle";
  const map: Record<string, React.ReactNode> = {
    globe: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    book: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    puzzle: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
        <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
      </svg>
    ),
    cloud: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    ),
    calendar: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
      </svg>
    ),
    mail: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    ),
  };
  return map[name] ?? map.puzzle;
}

export default function StorePage() {
  const connect = useDoppel((s) => s.connect);
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [configOpen, setConfigOpen] = useState<string | null>(null);

  useEffect(() => {
    connect();
    loadAddons();
  }, [connect]);

  const loadAddons = async () => {
    const list = await doppel.listAddons();
    setAddons(list);
  };

  const toggleAddon = async (id: string, enabled: boolean) => {
    if (enabled) await doppel.disableAddon(id);
    else await doppel.enableAddon(id);
    await loadAddons();
  };

  const saveConfig = async (id: string, key: string, value: string) => {
    await doppel.setAddonConfig(id, key, value);
    await loadAddons();
  };

  const [authLoading, setAuthLoading] = useState<string | null>(null);

  const handleAuth = async (id: string) => {
    setAuthLoading(id);
    try {
      const result = await doppel.addonAuth(id);
      if (!result.ok) {
        // Could show error toast here
      }
      await loadAddons();
    } finally {
      setAuthLoading(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    await doppel.addonDisconnect(id);
    await loadAddons();
  };

  const installed = addons.filter((a) => a.installed);
  const available = addons.filter((a) => !a.installed);

  return (
    <div className="max-w-[720px]">
      <header className="mb-12">
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>{V.title}</h1>
        <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
          {V.intro}
        </p>
      </header>

      {/* Installed add-ons */}
      <section className="mb-14">
        <SectionHeading>{V.installed}</SectionHeading>
        {installed.length === 0 && (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>{V.noAddons}</p>
        )}
        <div className="flex flex-col gap-3">
          {installed.map((addon) => (
            <AddonCard
              key={addon.id}
              addon={addon}
              configOpen={configOpen === addon.id}
              onToggle={() => toggleAddon(addon.id, addon.enabled)}
              onConfigToggle={() =>
                setConfigOpen(configOpen === addon.id ? null : addon.id)
              }
              onSaveConfig={(key, value) => saveConfig(addon.id, key, value)}
              onAuth={() => handleAuth(addon.id)}
              onDisconnect={() => handleDisconnect(addon.id)}
            />
          ))}
        </div>
      </section>

      {/* Available add-ons */}
      {available.length > 0 && (
        <section className="mb-14">
          <SectionHeading>{V.available}</SectionHeading>
          <div className="flex flex-col gap-3">
            {available.map((addon) => (
              <AddonCard
                key={addon.id}
                addon={addon}
                configOpen={false}
                onToggle={async () => {
                  await doppel.installAddon(addon.id);
                  await loadAddons();
                }}
                onConfigToggle={() => {}}
                onSaveConfig={() => {}}
                onAuth={() => handleAuth(addon.id)}
                onDisconnect={() => handleDisconnect(addon.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AddonCard({
  addon,
  configOpen,
  onToggle,
  onConfigToggle,
  onSaveConfig,
  onAuth,
  onDisconnect,
}: {
  addon: AddonInfo;
  configOpen: boolean;
  onToggle: () => void;
  onConfigToggle: () => void;
  onSaveConfig: (key: string, value: string) => void;
  onAuth: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="raised" style={{ padding: "20px 24px" }}>
      <div className="flex items-center gap-4">
        <div
          className="grid shrink-0 place-items-center rounded-xl"
          style={{
            width: 44,
            height: 44,
            background: addon.enabled ? "var(--primary)" : "var(--bg-base)",
            color: addon.enabled ? "white" : "var(--slate)",
            transition: "all 0.2s ease",
          }}
        >
          {iconFor(addon.icon)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span style={{ fontWeight: 600 }}>{addon.name}</span>
            {addon.builtin && (
              <span
                className="micro-label"
                style={{
                  background: "var(--bg-base)",
                  padding: "2px 8px",
                  borderRadius: 99,
                }}
              >
                {V.builtin}
              </span>
            )}
            {addon.needsAuth && addon.connected && (
              <span
                className="micro-label"
                style={{
                  background: "rgba(34, 197, 94, 0.1)",
                  color: "#16a34a",
                  padding: "2px 8px",
                  borderRadius: 99,
                }}
              >
                {V.connected}
              </span>
            )}
            <span className="micro-label">{V.tools(addon.tools.length)}</span>
          </div>
          <p
            className="agent-voice mt-1"
            style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
          >
            {addon.description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* OAuth connect/disconnect */}
          {addon.installed && addon.needsAuth && !addon.connected && (
            <button
              onClick={onAuth}
              className="cursor-pointer"
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "white",
                background: "var(--primary)",
                padding: "6px 16px",
                borderRadius: "var(--radius-control)",
                border: "none",
              }}
            >
              {V.connect}
            </button>
          )}
          {addon.installed && addon.needsAuth && addon.connected && (
            <button
              onClick={onDisconnect}
              className="cursor-pointer"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--slate)",
              }}
            >
              {V.disconnect}
            </button>
          )}

          {addon.installed && addon.config.length > 0 && (
            <button
              onClick={onConfigToggle}
              className="cursor-pointer"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--primary)",
              }}
            >
              {V.configure}
            </button>
          )}
          {addon.installed ? (
            <Toggle checked={addon.enabled} onChange={onToggle} label={addon.enabled ? V.disable : V.enable} />
          ) : (
            <button
              onClick={onToggle}
              className="cursor-pointer"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--primary)",
                fontWeight: 600,
              }}
            >
              {V.install}
            </button>
          )}
        </div>
      </div>

      {/* Config panel */}
      {configOpen && addon.config.length > 0 && (
        <div className="mt-4 flex flex-col gap-3" style={{ paddingLeft: 60 }}>
          {addon.config.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={addon.userConfig[field.key] ?? ""}
              onSave={(value) => onSaveConfig(field.key, value)}
            />
          ))}
        </div>
      )}

      {/* Tool list */}
      {addon.tools.length > 0 && (
        <div
          className="mt-3 flex flex-wrap gap-2"
          style={{ paddingLeft: 60 }}
        >
          {addon.tools.map((tool) => (
            <span
              key={tool.name}
              className="micro-label"
              style={{
                background: "var(--bg-base)",
                padding: "3px 10px",
                borderRadius: 99,
              }}
              title={tool.description}
            >
              {tool.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigField({
  field,
  value,
  onSave,
}: {
  field: { key: string; label: string; type: string; secret?: boolean; required?: boolean };
  value: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex items-center gap-3">
      <label
        className="micro-label shrink-0"
        style={{ minWidth: 100 }}
      >
        {field.label}
      </label>
      <input
        type={field.secret ? "password" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        className="min-w-0 flex-1"
        style={{
          padding: "6px 12px",
          borderRadius: "var(--radius-control)",
          background: "var(--bg-base)",
          fontSize: "var(--text-sm)",
          border: "none",
          outline: "none",
        }}
      />
      <button
        onClick={handleSave}
        className="cursor-pointer shrink-0"
        style={{
          fontSize: "var(--text-sm)",
          color: saved ? "var(--slate)" : "var(--primary)",
          fontWeight: 500,
        }}
      >
        {saved ? "Saved" : V.configSave}
      </button>
    </div>
  );
}
