"use client";

import Link from "next/link";
import { SectionHeading } from "@/components/ui";

export default function PrivacyPage() {
  return (
    <div className="max-w-[720px]">
      <header className="mb-12">
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
          Privacy Policy
        </h1>
        <p className="mt-3" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          Last updated: September 21, 2026
        </p>
      </header>

      <div className="flex flex-col gap-10" style={{ fontSize: "var(--text-body)", lineHeight: 1.7 }}>

        <section>
          <SectionHeading>The short version</SectionHeading>
          <p>
            Doppel is designed around one principle: your data stays on your machine. We
            built it this way on purpose. Your screen observations, memories, conversations,
            and user profile never touch our servers. We have no way to read, access, or
            sell your personal data because we never receive it.
          </p>
        </section>

        <section>
          <SectionHeading>1. What stays on your machine</SectionHeading>
          <p>The following data is created and stored locally and never leaves your device:</p>
          <ul className="mt-2" style={{ paddingLeft: 20 }}>
            <li className="mt-1"><strong>Screen observations</strong> &mdash; screenshots and narrations of your screen activity</li>
            <li className="mt-1"><strong>Episodes</strong> &mdash; timestamped records of what you were doing</li>
            <li className="mt-1"><strong>Entities</strong> &mdash; people, projects, apps, and things Doppel recognizes in your work</li>
            <li className="mt-1"><strong>Digests</strong> &mdash; hourly and daily summaries of your activity</li>
            <li className="mt-1"><strong>User profile</strong> &mdash; communication style, priorities, expertise model</li>
            <li className="mt-1"><strong>Conversations</strong> &mdash; your chat history with Doppel</li>
            <li className="mt-1"><strong>Vector embeddings</strong> &mdash; semantic search index for your memories</li>
            <li className="mt-1"><strong>Ingested documents</strong> &mdash; files you feed to Doppel</li>
          </ul>
          <p className="mt-3">
            This data is stored in your user data directory and optionally encrypted with
            biometric protection. You can export it, wipe it, or delete it at any time.
          </p>
        </section>

        <section>
          <SectionHeading>2. What we collect</SectionHeading>
          <p>Our identity server collects only what is necessary for authentication and billing:</p>
          <ul className="mt-2" style={{ paddingLeft: 20 }}>
            <li className="mt-1"><strong>Email address</strong> &mdash; for account identification</li>
            <li className="mt-1"><strong>Hashed password</strong> &mdash; salted SHA-256; we never store plaintext passwords</li>
            <li className="mt-1"><strong>Device registrations</strong> &mdash; name, platform, and pairing date of connected devices</li>
            <li className="mt-1"><strong>Session tokens</strong> &mdash; stored as SHA-256 digests, not in plaintext</li>
            <li className="mt-1"><strong>Billing data</strong> &mdash; plan type and token usage counts (not payment details, which Stripe handles)</li>
          </ul>
          <p className="mt-3">
            We do not collect analytics, telemetry, usage patterns, crash reports, or any
            data about what you do with Doppel. We have no tracking pixels, no third-party
            analytics SDKs, and no data brokers.
          </p>
        </section>

        <section>
          <SectionHeading>3. Third-party AI processing</SectionHeading>
          <p>
            When Doppel processes your screen or answers your questions, it sends data to
            Google&apos;s Gemini API for AI processing. This includes:
          </p>
          <ul className="mt-2" style={{ paddingLeft: 20 }}>
            <li className="mt-1">Screenshots of your screen (for vision analysis)</li>
            <li className="mt-1">Text prompts (for question answering and summarization)</li>
            <li className="mt-1">Document content (when you ingest files)</li>
          </ul>
          <p className="mt-3">
            This data is sent directly from your machine to Google&apos;s API &mdash; it never
            passes through our servers. Google&apos;s data handling is governed by their{" "}
            <span style={{ color: "var(--primary)" }}>API Terms of Service</span> and{" "}
            <span style={{ color: "var(--primary)" }}>Privacy Policy</span>. You provide
            your own API key, giving you direct control over this relationship.
          </p>
        </section>

        <section>
          <SectionHeading>4. MCP server</SectionHeading>
          <p>
            If you enable the MCP (Model Context Protocol) server, external AI agents
            (like Claude Desktop or Cursor) can query your personal memory. This is
            opt-in and runs locally on your machine. The data shared with these agents
            depends on which tools they call and what permissions you have granted.
          </p>
          <p className="mt-3">
            MCP connections are authenticated and only work with agents you have explicitly
            connected. You can revoke access at any time from the Agents page.
          </p>
        </section>

        <section>
          <SectionHeading>5. Payment processing</SectionHeading>
          <p>
            Payments are processed by Stripe. We never see or store your credit card
            number, bank details, or other payment credentials. Stripe&apos;s handling of
            your payment data is governed by their privacy policy.
          </p>
        </section>

        <section>
          <SectionHeading>6. Data retention</SectionHeading>
          <p>
            <strong>Local data:</strong> Retained until you delete it. Uninstalling Doppel
            does not automatically delete your brain data &mdash; you should wipe it first
            from Settings if you want it gone.
          </p>
          <p className="mt-2">
            <strong>Server data:</strong> Your account information is retained while your
            account is active. If you request account deletion, we will remove your data
            within 30 days.
          </p>
        </section>

        <section>
          <SectionHeading>7. Security</SectionHeading>
          <p>
            Local data can be encrypted using biometric protection (Windows Hello, Touch ID).
            Server communications use HTTPS. Session tokens are stored as SHA-256 digests.
            Passwords are salted and hashed. API keys are stored locally and can be encrypted.
          </p>
        </section>

        <section>
          <SectionHeading>8. Children</SectionHeading>
          <p>
            Doppel is not intended for children under 13. We do not knowingly collect data
            from children under 13. If you believe a child under 13 is using Doppel,
            contact us and we will delete the associated account.
          </p>
        </section>

        <section>
          <SectionHeading>9. Your rights</SectionHeading>
          <p>You have the right to:</p>
          <ul className="mt-2" style={{ paddingLeft: 20 }}>
            <li className="mt-1"><strong>Access</strong> &mdash; all your data is already on your machine; server data is available via the Account page</li>
            <li className="mt-1"><strong>Export</strong> &mdash; export your entire brain as a portable file</li>
            <li className="mt-1"><strong>Delete</strong> &mdash; wipe your local brain and/or request server account deletion</li>
            <li className="mt-1"><strong>Correct</strong> &mdash; edit or remove individual memories and entities</li>
            <li className="mt-1"><strong>Object</strong> &mdash; disable screen watching, nudges, or any other feature at any time</li>
          </ul>
        </section>

        <section>
          <SectionHeading>10. Changes to this policy</SectionHeading>
          <p>
            We may update this Privacy Policy from time to time. Material changes will be
            communicated through the Software. The &quot;last updated&quot; date at the top
            indicates when changes were last made.
          </p>
        </section>

        <section>
          <SectionHeading>11. Contact</SectionHeading>
          <p>
            Questions about privacy? Contact us at{" "}
            <span style={{ color: "var(--primary)" }}>privacy@doppel.ai</span>
          </p>
        </section>

        <div className="mt-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
          <Link href="/terms" style={{ color: "var(--primary)", textDecoration: "none" }}>
            Terms of Service
          </Link>
          {" · "}
          <Link href="/billing" style={{ color: "var(--slate)", textDecoration: "none" }}>
            Back to billing
          </Link>
        </div>
      </div>
    </div>
  );
}
