"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import type { InboxTask, Workflow } from "@/lib/store";
import type { WorkflowStep } from "@/lib/types";
import { ago } from "@/lib/time";
import { SectionHeading, Button } from "@/components/ui";

/* =========================================================================
   Agent definitions
   ========================================================================= */

interface AgentDef {
  id: string;
  name: string;
  description: string;
  /** Step-by-step instructions for adding the MCP server from inside the agent. */
  steps: string[];
}

const AGENTS: AgentDef[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    description: "Anthropic's desktop app.",
    steps: [
      'Open Settings \u2192 Connectors \u2192 "Add connector"',
      "Paste the MCP URL above and name it Doppel",
      "Or: Settings \u2192 Developer \u2192 Edit Config \u2192 paste the JSON config",
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's CLI agent.",
    steps: [
      "Run: claude mcp add-json doppel '{the JSON config}'",
      "Or paste the JSON config into ~/.claude/settings.json",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "AI-powered code editor.",
    steps: [
      "Go to Settings \u2192 MCP Servers \u2192 Add",
      "Paste the MCP URL or the JSON config",
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Microsoft's editor with Copilot.",
    steps: [
      "Open command palette \u2192 MCP: Add Server",
      "Paste the MCP URL, or add the JSON config to .vscode/mcp.json",
    ],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    description: "AI-native editor by Codeium.",
    steps: [
      "Go to Settings \u2192 MCP \u2192 Add",
      "Paste the MCP URL or the JSON config",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT Desktop",
    description: "OpenAI's desktop app.",
    steps: [
      "Go to Settings \u2192 Beta \u2192 MCP Servers \u2192 Add",
      "Paste the MCP URL or the JSON config",
    ],
  },
  {
    id: "grok",
    name: "Grok",
    description: "xAI's assistant.",
    steps: [
      "Open Grok settings \u2192 MCP",
      "Paste the MCP URL or the JSON config",
    ],
  },
  {
    id: "other",
    name: "Other MCP Client",
    description: "Any app that supports MCP.",
    steps: [
      "Open your AI agent's settings",
      "Add a new MCP server with the URL or JSON config below",
    ],
  },
];

/* =========================================================================
   Page
   ========================================================================= */

export default function AgentsPage() {
  const connect = useDoppel((s) => s.connect);
  const inbox = useDoppel((s) => s.inbox);
  const workflows = useDoppel((s) => s.workflows);
  const now = useDoppel((s) => s.now);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [httpUrl, setHttpUrl] = useState("");
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { connect(); }, [connect]);
  useEffect(() => {
    doppel.mcpSnippet().then((r: { httpUrl?: string; relayUrl?: string | null }) => {
      if (r.httpUrl) setHttpUrl(r.httpUrl);
      if (r.relayUrl) setRelayUrl(r.relayUrl);
    });
    const unsub = doppel.onRelay?.((s: { connected: boolean; mcpUrl: string | null }) => {
      setRelayUrl(s.mcpUrl);
    });
    return () => { unsub?.(); };
  }, []);

  const activeAgent = AGENTS.find((a) => a.id === openAgent);

  return (
    <div className="max-w-[720px]">
      <section className="mb-10">
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700, marginBottom: 8 }}>
          Agents
        </h1>
        <p className="agent-voice" style={{ color: "var(--slate)", maxWidth: 520 }}>
          Connect any AI to Doppel. Give it your memory, context, and a task inbox.
        </p>

        {/* Universal MCP URL — always visible */}
        {(httpUrl || relayUrl) && !activeAgent && (
          <div className="pressed mt-6" style={{ padding: "16px 20px" }}>
            {relayUrl ? (
              <>
                <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  <span
                    className="block shrink-0 rounded-full"
                    style={{ width: 7, height: 7, background: "#3a3", boxShadow: "0 0 6px #3a3" }}
                  />
                  <p style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", fontWeight: 600 }}>
                    MCP Server URL — works from anywhere
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code
                    style={{
                      flex: 1,
                      padding: "10px 14px",
                      borderRadius: "var(--radius-control)",
                      background: "var(--bg-base)",
                      fontSize: 13,
                      color: "var(--ink)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {relayUrl}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(relayUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="cursor-pointer shrink-0"
                    style={{
                      fontSize: "var(--text-sm)",
                      color: copied ? "#3a3" : "var(--primary)",
                      background: "none", border: "none", fontWeight: 600,
                    }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p style={{ fontSize: 10, color: "var(--slate)", marginTop: 6, opacity: 0.7 }}>
                  Local: {httpUrl}
                </p>
              </>
            ) : httpUrl ? (
              <>
                <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  <span
                    className="block shrink-0 rounded-full"
                    style={{ width: 7, height: 7, background: "var(--slate)", opacity: 0.4 }}
                  />
                  <p style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", fontWeight: 600 }}>
                    MCP Server URL — local only (sign in to get a public URL)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code
                    style={{
                      flex: 1,
                      padding: "10px 14px",
                      borderRadius: "var(--radius-control)",
                      background: "var(--bg-base)",
                      fontSize: 13,
                      color: "var(--ink)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {httpUrl}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(httpUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="cursor-pointer shrink-0"
                    style={{
                      fontSize: "var(--text-sm)",
                      color: copied ? "#3a3" : "var(--primary)",
                      background: "none", border: "none", fontWeight: 600,
                    }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </section>

      <AnimatePresence mode="wait">
        {activeAgent ? (
          <motion.div
            key={activeAgent.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <AgentChat
              agent={activeAgent}
              tasks={inbox}
              now={now}
              onBack={() => setOpenAgent(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <WorkflowSection workflows={workflows} now={now} />
            <AgentList
              agents={AGENTS}
              inbox={inbox}
              now={now}
              onOpen={(id) => setOpenAgent(id)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* =========================================================================
   Agent List — overview of all agents
   ========================================================================= */

function AgentList({
  agents,
  inbox,
  now,
  onOpen,
}: {
  agents: AgentDef[];
  inbox: InboxTask[];
  now: number;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 mb-14">
        {agents.map((agent) => {
          const tasks = inbox.filter(
            (t) => t.target === agent.id || (t.target === "any" && t.agent?.toLowerCase() === agent.name.toLowerCase()),
          );
          const active = tasks.filter((t) => t.status === "approved" || t.status === "claimed");
          const done = tasks.filter((t) => t.status === "done");
          const lastTask = tasks[0];

          return (
            <button
              key={agent.id}
              onClick={() => onOpen(agent.id)}
              className="pressable w-full cursor-pointer text-left"
              style={{
                padding: "18px 22px",
                borderRadius: "var(--radius-card-sm)",
                background: "var(--surface)",
                boxShadow: "var(--elev-raised-sm)",
                border: "none",
                transition: "all 0.15s ease",
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="block shrink-0 rounded-full"
                    style={{
                      width: 8, height: 8,
                      background: active.length > 0 ? "#e89b00" : done.length > 0 ? "var(--primary)" : "var(--surface-alt)",
                      boxShadow: active.length > 0 ? "0 0 8px #e89b00" : "none",
                      transition: "all 0.3s ease",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{agent.name}</p>
                      {active.length > 0 && (
                        <span style={{
                          fontSize: 10, background: "#e89b00", color: "white",
                          borderRadius: 8, padding: "1px 6px", fontWeight: 700,
                        }}>
                          {active.length} active
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", marginTop: 2 }}>
                      {lastTask
                        ? `${lastTask.instruction.slice(0, 50)}${lastTask.instruction.length > 50 ? "\u2026" : ""} \u00B7 ${ago(lastTask.createdAt, now)}`
                        : agent.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {done.length > 0 && (
                    <span className="micro-label">{done.length} done</span>
                  )}
                  <span style={{ fontSize: 18, color: "var(--slate)", opacity: 0.4 }}>&rsaquo;</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* How it works */}
      <section className="mb-14">
        <SectionHeading>How it works</SectionHeading>
        <div className="pressed mt-5" style={{ padding: 24 }}>
          <div className="flex flex-col gap-4" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
            <p>
              <strong style={{ color: "var(--ink)" }}>1. Connect</strong> — Paste the MCP URL into any AI agent
              that supports connectors, or use the JSON config for file-based setup.
            </p>
            <p>
              <strong style={{ color: "var(--ink)" }}>2. It just works</strong> — The agent automatically gets
              access to your memory, screen context, and task inbox. No extra prompting needed.
            </p>
            <p>
              <strong style={{ color: "var(--ink)" }}>3. Queue tasks</strong> — Send work to any agent from here
              or the whisper panel. The agent picks it up, does the work, and reports back.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

/* =========================================================================
   Agent Chat — per-agent conversation + inbox
   ========================================================================= */

function AgentChat({
  agent,
  tasks,
  now,
  onBack,
}: {
  agent: AgentDef;
  tasks: InboxTask[];
  now: number;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Tasks for this agent: targeted at it, OR claimed by it from "any". */
  const agentTasks = tasks.filter(
    (t) =>
      t.target === agent.id ||
      (t.target === "any" && t.agent?.toLowerCase() === agent.name.toLowerCase()),
  );

  /* Chronological order for chat (oldest first). */
  const chat = [...agentTasks].reverse();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await doppel.inboxCreate(text, true, agent.id);
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="cursor-pointer shrink-0"
          style={{
            background: "none", border: "none", color: "var(--primary)",
            fontSize: "var(--text-sm)", fontWeight: 600, padding: "4px 0",
          }}
        >
          &larr; All agents
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h2 style={{ fontSize: "var(--text-title)", fontWeight: 700 }}>{agent.name}</h2>
          <p style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}>
            {agent.description}
          </p>
        </div>
        <button
          onClick={() => setShowSetup(!showSetup)}
          className="cursor-pointer shrink-0"
          style={{
            fontSize: "var(--text-xs, 11px)", color: "var(--primary)",
            background: "none", border: "none",
          }}
        >
          {showSetup ? "Hide setup" : "Setup"}
        </button>
      </div>

      {/* Setup panel */}
      <AnimatePresence>
        {showSetup && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mb-6"
          >
            <SetupPanel agent={agent} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat thread */}
      <div
        ref={scrollRef}
        className="flex flex-col gap-3 mb-4"
        style={{ maxHeight: "50vh", overflowY: "auto", minHeight: 120 }}
      >
        {chat.length === 0 && (
          <div className="flex items-center justify-center" style={{ padding: "40px 0" }}>
            <p className="agent-voice" style={{ color: "var(--slate)", textAlign: "center" }}>
              No messages yet. Send a task to {agent.name} below.
            </p>
          </div>
        )}

        {chat.map((task) => (
          <div key={task.id} className="flex flex-col gap-2">
            {/* User message (the task instruction) */}
            <div className="flex justify-end">
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius: "14px 14px 4px 14px",
                  background: "var(--primary)",
                  color: "white",
                  fontSize: "var(--text-sm)",
                  lineHeight: 1.5,
                }}
              >
                {task.instruction}
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: "right" }}>
                  {ago(task.createdAt, now)}
                </div>
              </div>
            </div>

            {/* Agent response */}
            {(task.status === "claimed" || task.status === "done" || task.status === "failed") && (
              <div className="flex justify-start">
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "10px 14px",
                    borderRadius: "14px 14px 14px 4px",
                    background: "var(--surface)",
                    boxShadow: "var(--elev-raised-sm)",
                    fontSize: "var(--text-sm)",
                    lineHeight: 1.5,
                    color: "var(--ink)",
                  }}
                >
                  {task.status === "claimed" && (
                    <div className="flex items-center gap-2">
                      <span style={{ color: "#e89b00", fontStyle: "italic" }}>Working on it...</span>
                      <button
                        onClick={() => doppel.inboxReject(task.id)}
                        className="cursor-pointer"
                        style={{
                          fontSize: "var(--text-xs, 11px)",
                          color: "#e55",
                          background: "none",
                          border: "1px solid #e55",
                          borderRadius: 6,
                          padding: "2px 8px",
                          fontWeight: 600,
                        }}
                      >
                        Force stop
                      </button>
                    </div>
                  )}
                  {task.status === "done" && task.result && (
                    <span style={{ whiteSpace: "pre-wrap" }}>{task.result}</span>
                  )}
                  {task.status === "done" && !task.result && (
                    <span style={{ color: "#3a3" }}>Done.</span>
                  )}
                  {task.status === "failed" && (
                    <span style={{ color: "#e55" }}>
                      Failed{task.result ? `: ${task.result}` : "."}
                    </span>
                  )}
                  {task.completedAt && (
                    <div style={{ fontSize: 10, color: "var(--slate)", marginTop: 4 }}>
                      {ago(task.completedAt, now)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Status badge for pending/approved */}
            {(task.status === "pending" || task.status === "approved" || task.status === "rejected") && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2" style={{ padding: "4px 0" }}>
                  <span
                    style={{
                      fontSize: "var(--text-xs, 11px)",
                      color: task.status === "approved" ? "var(--primary)" : task.status === "rejected" ? "#e55" : "var(--slate)",
                      fontWeight: 600,
                    }}
                  >
                    {task.status === "pending" && "Waiting for your approval"}
                    {task.status === "approved" && `Queued \u2014 open ${agent.name} and ask it to check its Doppel inbox`}
                    {task.status === "rejected" && (task.completedAt ? "Stopped" : "Cancelled")}
                  </span>
                  {task.status === "pending" && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => doppel.inboxApprove(task.id)}
                        className="cursor-pointer"
                        style={{ fontSize: "var(--text-xs, 11px)", color: "var(--primary)", background: "none", border: "none", fontWeight: 600 }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => doppel.inboxReject(task.id)}
                        className="cursor-pointer"
                        style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", background: "none", border: "none" }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {task.status === "approved" && (
                    <button
                      onClick={() => doppel.inboxReject(task.id)}
                      className="cursor-pointer"
                      style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", background: "none", border: "none" }}
                    >
                      Cancel
                    </button>
                  )}
                  {(task.status === "rejected") && (
                    <button
                      onClick={() => doppel.inboxRetry(task.id)}
                      className="cursor-pointer"
                      style={{ fontSize: "var(--text-xs, 11px)", color: "var(--primary)", background: "none", border: "none" }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Compose */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft.trim() && send()}
          placeholder={`Message ${agent.name}...`}
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
        <Button variant="primary" onClick={send} disabled={!draft.trim()}>
          Send
        </Button>
      </div>
    </>
  );
}

/* =========================================================================
   Setup Panel — how to connect from the agent's side
   ========================================================================= */

function SetupPanel({ agent }: { agent: AgentDef }) {
  const [snippet, setSnippet] = useState("");
  const [httpUrl, setHttpUrl] = useState("");
  const [copied, setCopied] = useState<"none" | "json" | "url">("none");

  useEffect(() => {
    doppel.mcpSnippet().then((r: { snippet: unknown; scriptPath: string; httpUrl?: string; relayUrl?: string | null }) => {
      setSnippet(JSON.stringify({ mcpServers: { doppel: r.snippet } }, null, 2));
      // Prefer relay URL (public, works from anywhere) over local
      setHttpUrl(r.relayUrl || r.httpUrl || "");
    });
  }, [agent.id]);

  const copy = (text: string, kind: "json" | "url") => {
    navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied("none"), 2000);
  };

  return (
    <div className="pressed" style={{ padding: 20 }}>
      {/* Steps */}
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: "var(--text-sm)", color: "var(--ink)", lineHeight: 1.8 }}>
        {agent.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {/* HTTP URL — for connector-style agents (Claude.ai, etc.) */}
      {httpUrl && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", marginBottom: 6, fontWeight: 600 }}>
            MCP Server URL (for connectors)
          </p>
          <div className="flex items-center gap-2">
            <code
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: "var(--radius-control)",
                background: "var(--bg-base)",
                fontSize: "var(--text-xs, 11px)",
                color: "var(--ink)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {httpUrl}
            </code>
            <button
              onClick={() => copy(httpUrl, "url")}
              className="cursor-pointer shrink-0"
              style={{
                fontSize: "var(--text-xs, 11px)",
                color: copied === "url" ? "#3a3" : "var(--primary)",
                background: "none", border: "none",
              }}
            >
              {copied === "url" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* JSON config — for stdio agents (Claude Desktop, Cursor, etc.) */}
      {snippet && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)", marginBottom: 6, fontWeight: 600 }}>
            JSON Config (for config files)
          </p>
          <pre
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-base)",
              fontSize: "var(--text-xs, 11px)",
              color: "var(--ink)",
              overflow: "auto",
              maxHeight: 160,
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {snippet}
          </pre>
          <button
            onClick={() => copy(snippet, "json")}
            className="cursor-pointer mt-2"
            style={{
              fontSize: "var(--text-xs, 11px)",
              color: copied === "json" ? "#3a3" : "var(--primary)",
              background: "none", border: "none",
            }}
          >
            {copied === "json" ? "Copied!" : "Copy to clipboard"}
          </button>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Workflow Section — active cross-agent workflows
   ========================================================================= */

function WorkflowSection({ workflows, now }: { workflows: Workflow[]; now: number }) {
  const [creating, setCreating] = useState(false);

  const active = workflows.filter((w) => w.status === "running" || w.status === "paused");
  const recent = workflows
    .filter((w) => w.status !== "running" && w.status !== "paused")
    .slice(0, 3);
  const shown = [...active, ...recent];

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <SectionHeading>Workflows</SectionHeading>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>New workflow</Button>
        )}
      </div>

      {creating && (
        <WorkflowCreator
          onCreated={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      )}

      {shown.length > 0 && (
        <div className="flex flex-col gap-3 mt-4">
          {shown.map((wf) => (
            <WorkflowCard key={wf.id} workflow={wf} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

const AGENT_TARGETS = ["any", "Claude Desktop", "Claude Code", "Cursor", "VS Code", "Windsurf", "ChatGPT Desktop", "Grok"];

function WorkflowCreator({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState([{ instruction: "", target: "any" }, { instruction: "", target: "any" }]);
  const [onFailure, setOnFailure] = useState<"abort" | "skip" | "retry">("abort");

  const addStep = () => setSteps([...steps, { instruction: "", target: "any" }]);
  const removeStep = (i: number) => {
    if (steps.length <= 2) return;
    setSteps(steps.filter((_, idx) => idx !== i));
  };
  const updateStep = (i: number, field: "instruction" | "target", value: string) => {
    const next = [...steps];
    next[i] = { ...next[i], [field]: value };
    setSteps(next);
  };

  const canSubmit = title.trim() && steps.every((s) => s.instruction.trim());

  const submit = async () => {
    if (!canSubmit) return;
    await doppel.workflowCreate(
      title.trim(),
      steps.map((s) => ({ instruction: s.instruction.trim(), target: s.target })),
      onFailure,
    );
    onCreated();
  };

  return (
    <div className="raised mb-4" style={{ padding: "20px 24px", borderRadius: "var(--radius-card-sm)" }}>
      {/* Title */}
      <input
        type="text"
        placeholder="Workflow title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{
          width: "100%", border: "none", outline: "none",
          background: "var(--surface-alt)", borderRadius: 6,
          padding: "10px 14px", fontSize: "var(--text-sm)",
          marginBottom: 12, color: "var(--ink)",
        }}
      />

      {/* Steps */}
      <div className="flex flex-col gap-2 mb-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2">
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "var(--surface-alt)", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "var(--slate)", flexShrink: 0, marginTop: 6,
            }}>
              {i + 1}
            </span>
            <div className="flex-1 flex gap-2">
              <input
                type="text"
                placeholder={`Step ${i + 1} instruction`}
                value={step.instruction}
                onChange={(e) => updateStep(i, "instruction", e.target.value)}
                style={{
                  flex: 1, border: "none", outline: "none",
                  background: "var(--surface-alt)", borderRadius: 6,
                  padding: "8px 12px", fontSize: "var(--text-xs, 11px)", color: "var(--ink)",
                }}
              />
              <select
                value={step.target}
                onChange={(e) => updateStep(i, "target", e.target.value)}
                style={{
                  width: 120, border: "none", outline: "none",
                  background: "var(--surface-alt)", borderRadius: 6,
                  padding: "8px 10px", fontSize: "var(--text-xs, 11px)",
                  color: "var(--slate)", cursor: "pointer",
                }}
              >
                {AGENT_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {steps.length > 2 && (
              <button
                onClick={() => removeStep(i)}
                style={{
                  background: "none", border: "none", color: "var(--slate)",
                  cursor: "pointer", fontSize: 16, padding: "4px 6px", marginTop: 4,
                }}
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={addStep}
        style={{
          background: "none", border: "none", color: "var(--primary)",
          cursor: "pointer", fontSize: "var(--text-xs, 11px)", padding: "4px 0", marginBottom: 12,
        }}
      >
        + Add step
      </button>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}>On failure:</span>
          <select
            value={onFailure}
            onChange={(e) => setOnFailure(e.target.value as "abort" | "skip" | "retry")}
            style={{
              border: "none", outline: "none", background: "var(--surface-alt)",
              borderRadius: 4, padding: "4px 8px", fontSize: "var(--text-xs, 11px)",
              color: "var(--slate)", cursor: "pointer",
            }}
          >
            <option value="abort">Abort</option>
            <option value="skip">Skip</option>
            <option value="retry">Wait for retry</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>Start</Button>
        </div>
      </div>
    </div>
  );
}

function WorkflowCard({ workflow: wf, now }: { workflow: Workflow; now: number }) {
  const doneSteps = wf.steps.filter((s: WorkflowStep) => s.status === "done" || s.status === "skipped").length;
  const progress = wf.steps.length > 0 ? (doneSteps / wf.steps.length) * 100 : 0;
  const isRunning = wf.status === "running";
  const currentStep = wf.steps[wf.currentStep];

  const statusColor: Record<string, string> = {
    running: "#e89b00",
    paused: "var(--slate)",
    done: "var(--primary)",
    failed: "#e55",
    aborted: "#e55",
  };

  return (
    <div
      className="raised"
      style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-card-sm)",
        borderLeft: `3px solid ${statusColor[wf.status] || "var(--surface-alt)"}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{wf.title}</p>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: statusColor[wf.status],
              textTransform: "uppercase",
            }}>
              {wf.status}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{
            width: "100%", height: 4, borderRadius: 2,
            background: "var(--surface-alt)", marginBottom: 8,
          }}>
            <div style={{
              width: `${progress}%`, height: "100%", borderRadius: 2,
              background: wf.status === "failed" ? "#e55" : "var(--primary)",
              transition: "width 0.3s ease",
            }} />
          </div>

          {/* Steps */}
          <div style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}>
            {wf.steps.map((step: WorkflowStep, i: number) => {
              const stepStatusIcon: Record<string, string> = {
                pending: "\u25CB",
                queued: "\u25D4",
                claimed: "\u25D4",
                done: "\u2713",
                failed: "\u2717",
                skipped: "\u2013",
              };
              const isCurrent = i === wf.currentStep && isRunning;
              return (
                <div
                  key={step.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    padding: "2px 0",
                    color: isCurrent ? "var(--ink)" : step.status === "done" ? "var(--primary)" : "var(--slate)",
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>
                    {stepStatusIcon[step.status] || "\u25CB"}
                  </span>
                  <span className="min-w-0">
                    {step.instruction.slice(0, 80)}{step.instruction.length > 80 ? "\u2026" : ""}
                    {step.target !== "any" && (
                      <span style={{ color: "var(--slate)", fontWeight: 400 }}> \u2192 {step.target}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Current step detail for running workflows */}
          {isRunning && currentStep && currentStep.status === "claimed" && (
            <p style={{ fontSize: "var(--text-xs, 11px)", color: "#e89b00", marginTop: 4 }}>
              Step {wf.currentStep + 1} claimed by {currentStep.agent || "agent"}{" "}
              {currentStep.claimedAt ? ago(currentStep.claimedAt, now) : ""}
            </p>
          )}
        </div>

        {/* Abort button for running workflows */}
        {isRunning && (
          <button
            onClick={() => doppel.workflowAbort(wf.id)}
            style={{
              fontSize: "var(--text-xs, 11px)",
              color: "#e55",
              border: "1px solid #e55",
              borderRadius: 6,
              padding: "4px 10px",
              background: "transparent",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Abort
          </button>
        )}
      </div>
    </div>
  );
}
