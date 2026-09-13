"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago } from "@/lib/time";
import type { AccountOverview } from "@/lib/types";
import { Pulse } from "@/components/Pulse";
import { Mascot } from "@/components/Mascot";
import { Button, SectionHeading } from "@/components/ui";

/**
 * Stage 0. Not a login gate — the container for something the user owns.
 *
 * The screen says plainly what is kept where, because the split between the
 * account (identity) and the machine (the trained agent) is the product's
 * central claim rather than a footnote.
 */
export default function AccountPage() {
  const account = useDoppel((s) => s.account);
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!account.signedIn) return setOverview(null);
    const result = await doppel.accountOverview();
    setOverview(result?.ok ? result : null);
  }, [account.signedIn]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="max-w-[720px]">
      <header className="mb-12 flex items-start gap-6">
        <Mascot mood={account.signedIn ? "idle" : "watching"} size="lg" />
        <div>
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
            {voice.account.title}
          </h1>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.account.intro}
          </p>
        </div>
      </header>

      <AnimatePresence>
        {note && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="agent-voice mb-8"
            style={{
              background: "var(--primary-soft)",
              borderRadius: "var(--radius-card-sm)",
              padding: "16px 20px",
              fontSize: "var(--text-sm)",
            }}
          >
            {note}
          </motion.p>
        )}
      </AnimatePresence>

      {!account.signedIn ? (
        <SignIn onNote={setNote} onDone={refresh} />
      ) : (
        <SignedIn overview={overview} onNote={setNote} onRefresh={refresh} />
      )}

      {/* The claim, stated where it matters rather than in fine print. */}
      <section className="mt-16">
        <div className="pressed" style={{ padding: 28 }}>
          <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
            {voice.account.localTitle}
          </p>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            {voice.account.localBody}
          </p>
        </div>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function SignIn({
  onNote,
  onDone,
}: {
  onNote: (s: string | null) => void;
  onDone: () => void;
}) {
  const pendingEmail = useDoppel((s) => s.account.pendingEmail);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"link" | "password">("link");
  const [busy, setBusy] = useState(false);
  const [shownLink, setShownLink] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    onNote(null);
    const result = await doppel.requestLink(email);
    setBusy(false);
    if (!result?.ok) {
      onNote(result?.error === "unreachable" ? voice.account.unreachable : voice.account.linkFailed(""));
      return;
    }
    onNote(voice.account.linkSent(email));
    if (result.link) setShownLink(result.link);
  };

  const redeem = async () => {
    setBusy(true);
    const result = await doppel.verifyLink(link.trim());
    setBusy(false);
    if (!result?.ok) return onNote(voice.account.linkFailed(result?.error ?? ""));
    onNote(null);
    onDone();
  };

  const withPassword = async () => {
    setBusy(true);
    const result = await doppel.signInWithPassword(email, password);
    setBusy(false);
    if (!result?.ok) {
      onNote(
        result?.error === "unreachable"
          ? voice.account.unreachable
          : "That email and password didn't match.",
      );
      return;
    }
    onNote(null);
    onDone();
  };

  return (
    <section>
      <div className="raised" style={{ padding: 30 }}>
        <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
          {voice.account.signInTitle}
        </p>
        <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
          {voice.account.signInBody}
        </p>

        <Field
          value={email}
          onChange={setEmail}
          placeholder={voice.account.emailPlaceholder}
          type="email"
          className="mt-7"
        />

        {mode === "link" ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={send} disabled={busy || !email.includes("@")}>
                {busy ? voice.account.sending : voice.account.sendLink}
              </Button>
              <Button variant="ghost" onClick={() => setMode("password")}>
                {voice.account.usePassword}
              </Button>
            </div>

            {(shownLink || pendingEmail) && (
              <div className="pressed mt-7" style={{ padding: 22 }}>
                {shownLink && (
                  <>
                    <p
                      className="agent-voice"
                      style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
                    >
                      {voice.account.noMailProvider}
                    </p>
                    <p
                      className="mt-3 break-all font-mono"
                      style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}
                    >
                      {shownLink}
                    </p>
                  </>
                )}
                <Field
                  value={link}
                  onChange={setLink}
                  placeholder={voice.account.linkPlaceholder}
                  className="mt-4"
                />
                <Button
                  variant="primary"
                  className="mt-4"
                  onClick={redeem}
                  disabled={busy || !link.trim()}
                >
                  {voice.account.useLink}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <Field
              value={password}
              onChange={setPassword}
              placeholder={voice.account.passwordPlaceholder}
              type="password"
              className="mt-4"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={withPassword}
                disabled={busy || !email.includes("@") || !password}
              >
                {voice.account.signInWithPassword}
              </Button>
              <Button variant="ghost" onClick={() => setMode("link")}>
                {voice.account.useLinkInstead}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------- */

function SignedIn({
  overview,
  onNote,
  onRefresh,
}: {
  overview: AccountOverview | null;
  onNote: (s: string | null) => void;
  onRefresh: () => void;
}) {
  const account = useDoppel((s) => s.account);
  const now = useDoppel((s) => s.now);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");

  const devices = overview?.devices ?? [];

  const revoke = async (id: string) => {
    const result = await doppel.revokeAccountDevice(id);
    setConfirming(null);
    onNote(result?.ok ? voice.account.revoked : "I couldn't cut that one off.");
    onRefresh();
  };

  return (
    <>
      <section className="mb-14">
        <SectionHeading count={devices.length || undefined}>
          {voice.account.devicesTitle}
        </SectionHeading>
        <p className="mb-5" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          {voice.account.devicesBody}
        </p>

        <div className="flex flex-col gap-3">
          {devices.map((device) => (
            <div key={device.id} className="raised" style={{ padding: "22px 26px" }}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  {/* The machine you're on carries the pulse. */}
                  {device.current ? (
                    <Pulse size={40} className="-m-2 shrink-0" />
                  ) : (
                    <span
                      aria-hidden
                      className="block shrink-0 rounded-full"
                      style={{ width: 7, height: 7, boxShadow: "var(--elev-pressed-sm)" }}
                    />
                  )}
                  <div className="min-w-0">
                    <p style={{ fontWeight: 600, letterSpacing: "var(--tracking-tight)" }}>
                      {device.name}
                      {device.current && (
                        <span className="micro-label ml-3">{voice.account.thisDevice}</span>
                      )}
                    </p>
                    <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                      {voice.account.pairedWhen(ago(device.pairedAt, now))} &middot;{" "}
                      {voice.account.lastSeen(ago(device.lastSeenAt, now))}
                    </p>
                  </div>
                </div>

                {/* Two steps, always — never a stray click. */}
                {confirming === device.id ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}>
                      {device.current
                        ? voice.account.revokeThisConfirm
                        : voice.account.revokeConfirm}
                    </span>
                    <Button variant="primary" size="sm" onClick={() => revoke(device.id)}>
                      {voice.account.revoke}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      {voice.account.revokeCancel}
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(device.id)}>
                    {voice.account.revoke}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            onClick={async () => {
              if (!window.confirm(voice.account.signOutAllConfirm)) return;
              const result = await doppel.signOutEverywhere(true);
              onNote(voice.account.signedOutAll(result?.revoked ?? 0));
              onRefresh();
            }}
          >
            {voice.account.signOutAll}
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await doppel.signOut();
              onRefresh();
            }}
          >
            {voice.account.signOutHere}
          </Button>
        </div>
      </section>

      {/* --------------------------------------------------------- password */}
      {overview && !overview.account.hasPassword && (
        <section className="mb-14">
          <SectionHeading>{voice.account.passwordTitle}</SectionHeading>
          <div className="pressed" style={{ padding: 26 }}>
            <p className="agent-voice" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
              {voice.account.passwordBody}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Field
                value={password}
                onChange={setPassword}
                placeholder={voice.account.passwordPlaceholder}
                type="password"
                className="flex-1"
              />
              <Button
                onClick={async () => {
                  const result = await doppel.setAccountPassword(password);
                  onNote(result?.ok ? voice.account.passwordSet : voice.account.passwordTooShort);
                  if (result?.ok) setPassword("");
                  onRefresh();
                }}
                disabled={password.length < 10}
              >
                {voice.account.passwordTitle}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- export */}
      <section className="mb-14">
        <SectionHeading>{voice.account.exportTitle}</SectionHeading>
        <div className="raised" style={{ padding: 26 }}>
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {voice.account.exportBody}
          </p>
          <Button
            className="mt-5"
            onClick={async () => {
              const result = await doppel.exportAccount();
              if (result?.ok && result.file) onNote(voice.account.exported(result.file));
            }}
          >
            {voice.account.exportCta}
          </Button>
        </div>
      </section>

      {/* ----------------------------------------------------------- delete */}
      <section>
        <SectionHeading>{voice.account.deleteTitle}</SectionHeading>
        <div className="pressed" style={{ padding: 26 }}>
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {voice.account.deleteBody}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* The exit offers the export first, and never hides it. */}
            <Button
              onClick={async () => {
                const result = await doppel.exportAccount();
                if (result?.ok && result.file) onNote(voice.account.exported(result.file));
              }}
            >
              {voice.account.deleteExportFirst}
            </Button>

            {deleting ? (
              <>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}>
                  {voice.account.deleteConfirm}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    const result = await doppel.deleteAccount();
                    setDeleting(false);
                    onNote(result?.ok ? voice.account.deleted : "I couldn't delete it.");
                    onRefresh();
                  }}
                >
                  {voice.account.deleteCta}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(false)}>
                  {voice.account.revokeCancel}
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                {voice.account.deleteCta}
              </Button>
            )}
          </div>
          <p className="micro-label mt-5">{account.email}</p>
        </div>
      </section>
    </>
  );
}

/* --------------------------------------------------------------------------- */

function Field({
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={`w-full min-w-0 ${className}`}
      style={{
        padding: "13px 16px",
        borderRadius: "var(--radius-control)",
        background: "var(--bg-base)",
        boxShadow: "var(--elev-pressed-sm)",
        fontSize: "var(--text-sm)",
        color: "var(--ink)",
      }}
    />
  );
}
