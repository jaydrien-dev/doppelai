"use client";

import { useEffect, useState } from "react";
import { doppel, useDoppel } from "@/lib/store";
import { Mascot } from "@/components/Mascot";
import { Button, SectionHeading } from "@/components/ui";
import type { BillingStatus, PlanInfo, TokenPack, TokenEvent } from "@/lib/types";

/** Human-readable labels for internal action keys. */
const ACTION_LABELS: Record<string, string> = {
  "vision:look": "Vision look",
  "brain:ask": "Ask Doppel",
  "brain:ask-fast": "Quick ask",
  "brain:consolidate": "Memory consolidation",
  "brain:ingest": "Document ingestion",
  "brain:morningBrief": "Morning brief",
  "whisper:ask": "Voice question",
  "whisper:transcribe": "Transcription",
  "nudge:evaluate": "Nudge evaluation",
};

export default function BillingPage() {
  const billing = useDoppel((s) => s.billing);
  const account = useDoppel((s) => s.account);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [packs, setPacks] = useState<TokenPack[]>([]);
  const [history, setHistory] = useState<TokenEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    doppel.billingStatus().then(setStatus);
    doppel.billingPlans().then(setPlans);
    doppel.billingCosts().then(setCosts);
    doppel.billingTokenPacks().then(setPacks);
    doppel.billingHistory(30).then(setHistory);
  }, [billing.plan, billing.dailyUsed, billing.tokenBalance]);

  const checkout = async (priceId: string) => {
    if (!account.signedIn) {
      setNote("Sign in to your account first.");
      return;
    }
    setBusy(true);
    setNote(null);
    const result = await doppel.billingCheckout(priceId);
    setBusy(false);
    if (result.ok && result.sessionId) {
      setPendingSession(result.sessionId);
      setNote("Complete payment in your browser, then click \"Verify purchase\" below.");
    } else {
      setNote(
        result.error === "stripe_not_configured"
          ? "Payment server not configured yet."
          : "Could not start checkout.",
      );
    }
  };

  const verify = async () => {
    if (!pendingSession) return;
    setBusy(true);
    const result = await doppel.billingVerifyPurchase(pendingSession);
    setBusy(false);
    if (result.ok) {
      setPendingSession(null);
      setNote(
        result.type === "pro"
          ? "You're on Pro now. Unlimited usage."
          : `${result.tokens} tokens added to your balance.`,
      );
      doppel.billingStatus().then(setStatus);
      doppel.billingHistory(30).then(setHistory);
    } else {
      setNote("Payment not confirmed yet. Try again in a moment.");
    }
  };

  if (!status) return null;

  const dailyPct = status.dailyLimit
    ? Math.min(100, Math.round((status.dailyUsed / status.dailyLimit) * 100))
    : 0;

  return (
    <div className="max-w-[720px]">
      <header className="mb-12 flex items-start gap-6">
        <Mascot mood="idle" size="lg" />
        <div>
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
            Usage &amp; billing
          </h1>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            Every AI action costs tokens. Your plan determines how they replenish.
          </p>
        </div>
      </header>

      {/* -------------------------------------------------------- current plan */}
      <section className="mb-12">
        <SectionHeading>Current plan</SectionHeading>

        <div className="raised" style={{ padding: 26 }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
                {status.planName}
              </p>
              <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                {status.plan === "free" &&
                  `${status.dailyRemaining ?? 0} of ${status.dailyLimit} tokens remaining today`}
                {status.plan === "pro" && "Unlimited tokens"}
                {status.plan === "paygo" &&
                  `${status.tokenBalance} tokens in your balance`}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
                {status.totalSpent}
              </p>
              <p style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}>
                tokens used all time
              </p>
            </div>
          </div>

          {/* Daily usage bar */}
          {status.dailyLimit != null && (
            <div className="mt-5">
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--bg-base)",
                  boxShadow: "var(--elev-pressed-sm)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${dailyPct}%`,
                    borderRadius: 3,
                    background: dailyPct > 80 ? "var(--rose)" : "var(--primary)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <p className="micro-label mt-2">
                {status.dailyUsed} / {status.dailyLimit} tokens today
              </p>
            </div>
          )}
        </div>
      </section>

      {/* -------------------------------------------------------- notification */}
      {note && (
        <div className="pressed mb-8" style={{ padding: "16px 20px" }}>
          <p
            className="agent-voice"
            style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
          >
            {note}
          </p>
          {pendingSession && (
            <Button className="mt-3" variant="primary" onClick={verify} disabled={busy}>
              {busy ? "Verifying..." : "Verify purchase"}
            </Button>
          )}
        </div>
      )}

      {/* ----------------------------------------------------- upgrade to Pro */}
      {status.plan !== "pro" && (() => {
        const pro = plans.find((p) => p.id === "pro");
        if (!pro) return null;
        return (
          <section className="mb-12">
            <SectionHeading>Upgrade</SectionHeading>

            <div
              className="raised"
              style={{
                padding: "26px 28px",
                borderLeft: "3px solid var(--primary)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p style={{ fontSize: "var(--text-title)", fontWeight: 600 }}>
                    Doppel {pro.name}
                  </p>
                  <p
                    className="mt-1"
                    style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                  >
                    ${(pro.price / 100).toFixed(0)}/month &middot;{" "}
                    {pro.dailyTokens === null ? "unlimited tokens" : `${pro.dailyTokens} tokens/day`}
                  </p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => checkout("price_1UFwALGPQDGH6ygYesHAfUCL")}
                  disabled={busy}
                  style={{ alignSelf: "flex-start" }}
                >
                  {busy ? "Opening..." : `Upgrade to ${pro.name}`}
                </Button>
              </div>
            </div>
          </section>
        );
      })()}

      {/* -------------------------------------------------------- token packs */}
      {status.plan !== "pro" && (
        <section className="mb-12">
          <SectionHeading>Token packs</SectionHeading>
          <p className="mb-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            Buy tokens individually. They never expire.
          </p>

          <div className="flex flex-wrap gap-3">
            {packs.map((pack) => (
              <button
                key={pack.id}
                onClick={() => checkout(pack.stripePriceId)}
                disabled={busy}
                className="raised flex-1"
                style={{
                  padding: "20px 22px",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                  textAlign: "center",
                  minWidth: 140,
                }}
              >
                <p style={{ fontSize: "var(--text-title)", fontWeight: 700 }}>
                  {pack.tokens.toLocaleString()}
                </p>
                <p style={{ fontSize: "var(--text-micro)", color: "var(--slate)", marginTop: 2 }}>
                  tokens
                </p>
                <p
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: 600,
                    marginTop: 8,
                    color: "var(--primary)",
                  }}
                >
                  ${(pack.price / 100).toFixed(2)}
                </p>
              </button>
            ))}
          </div>

          {status.plan === "paygo" && (
            <p className="micro-label mt-3">
              Current balance: {status.tokenBalance} tokens
            </p>
          )}
        </section>
      )}

      {/* --------------------------------------------------- token costs */}
      {Object.keys(costs).length > 0 && (
        <section className="mb-12">
          <SectionHeading>Token costs</SectionHeading>
          <div className="raised" style={{ padding: 22 }}>
            <div className="flex flex-col gap-2">
              {Object.entries(costs).map(([action, cost]) => (
                <div
                  key={action}
                  className="flex items-center justify-between"
                  style={{ fontSize: "var(--text-sm)" }}
                >
                  <span>{ACTION_LABELS[action] ?? action}</span>
                  <span style={{ color: "var(--slate)" }}>
                    {cost} {cost === 1 ? "token" : "tokens"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* -------------------------------------------------- recent activity */}
      {history.length > 0 && (
        <section className="mb-12">
          <SectionHeading count={history.length}>Recent usage</SectionHeading>
          <div className="raised" style={{ padding: 22 }}>
            <div className="flex flex-col gap-2">
              {history.map((evt, i) => {
                const label = evt.action
                  .replace("brain:", "")
                  .replace("agent:", "")
                  .replace("vision:", "")
                  .replace("whisper:", "")
                  .replace("nudge:", "");
                const when = new Date(evt.date);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between"
                    style={{ fontSize: "var(--text-sm)" }}
                  >
                    <span>
                      {label}
                      <span
                        className="ml-3"
                        style={{ fontSize: "var(--text-micro)", color: "var(--slate)" }}
                      >
                        {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                    <span style={{ color: "var(--slate)" }}>
                      -{evt.cost}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
