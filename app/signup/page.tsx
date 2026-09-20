"use client";

import { useState } from "react";
import Link from "next/link";
import { doppel, useDoppel } from "@/lib/store";
import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui";

export default function SignUpPage() {
  const signedIn = useDoppel((s) => s.account.signedIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    email.includes("@") && password.length >= 10 && password === confirm;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const result = await doppel.register(email, password);
    setBusy(false);
    if (!result?.ok) {
      setError(
        result?.error === "already_exists"
          ? "That email is already registered. Sign in instead."
          : result?.error === "password_too_short"
            ? "Password must be at least 10 characters."
            : result?.error === "bad_email"
              ? "Please enter a valid email address."
              : result?.error === "unreachable"
                ? "Couldn't reach the account server."
                : "Something went wrong. Try again.",
      );
    }
  };

  if (signedIn) {
    return (
      <div className="max-w-[480px]">
        <header className="mb-10 flex items-start gap-6">
          <Mascot mood="idle" size="lg" />
          <div>
            <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
              You're in
            </h1>
            <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
              Your account is set up. Head to{" "}
              <Link href="/account" style={{ color: "var(--primary)" }}>
                Account
              </Link>{" "}
              to manage your devices, or{" "}
              <Link href="/permissions" style={{ color: "var(--primary)" }}>
                Settings
              </Link>{" "}
              to get started.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="max-w-[480px]">
      <header className="mb-10 flex items-start gap-6">
        <Mascot mood="watching" size="lg" />
        <div>
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
            Create your account
          </h1>
          <p className="agent-voice mt-3" style={{ color: "var(--slate)" }}>
            Your brain stays on this machine. The account just links your
            devices and handles billing.
          </p>
        </div>
      </header>

      {error && (
        <p
          className="agent-voice mb-6"
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

      <div className="raised" style={{ padding: 30 }}>
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          type="email"
        />

        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="At least 10 characters"
          type="password"
          className="mt-5"
        />

        <Field
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          placeholder="Same password again"
          type="password"
          className="mt-5"
        />

        {password && confirm && password !== confirm && (
          <p className="mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--rose, #ef4444)" }}>
            Passwords don't match.
          </p>
        )}

        <Button
          variant="primary"
          className="mt-7 w-full"
          onClick={submit}
          disabled={busy || !valid}
          style={{ justifyContent: "center" }}
        >
          {busy ? "Creating account..." : "Create account"}
        </Button>

        <p className="mt-5 text-center" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          Already have an account?{" "}
          <Link href="/account" style={{ color: "var(--primary)", fontWeight: 500 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        className="micro-label mb-2 block"
        style={{ fontSize: "var(--text-xs, 11px)" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete={type === "password" ? "new-password" : "off"}
        className="w-full"
        style={{
          padding: "13px 16px",
          borderRadius: "var(--radius-control)",
          background: "var(--bg-base)",
          boxShadow: "var(--elev-pressed-sm)",
          fontSize: "var(--text-sm)",
          color: "var(--ink)",
        }}
      />
    </div>
  );
}
