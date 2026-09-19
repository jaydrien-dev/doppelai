"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import type { InboxTask } from "@/lib/store";
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
      "Open Claude Desktop",
      'Go to Settings \u2192 Developer \u2192 "Edit Config"',
      "Paste the config below into the file and save",
      "Restart Claude Desktop",
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's CLI agent.",
    steps: [
      "Open your terminal",
      "Run: claude mcp add doppel -- node <path>",
      "Or paste the config into ~/.claude/settings.json",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "AI-powered code editor.",
    steps: [
      "Open Cursor",
      "Go to Settings \u2192 MCP Servers \u2192 Add",
      "Paste the config below",
      "Restart Cursor",
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Microsoft's editor with Copilot.",
    steps: [
      "Open VS Code",
      "Open Settings (JSON) or .vscode/mcp.json",
      'Add a "servers" key with the config below',
      "Reload the window",
    ],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    description: "AI-native editor by Codeium.",
    steps: [
      "Open Windsurf",
      "Go to Settings \u2192 MCP",
      "Add the config below",
      "Restart Windsurf",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT Desktop",
    description: "OpenAI's desktop app.",
    steps: [
      "Open ChatGPT Desktop",
      "Go to Settings \u2192 Beta \u2192 MCP Servers \u2192 Add",
      "Paste the config below",
      "Restart ChatGPT",
    ],
  },
  {
    id: "grok",
    name: "Grok",
    description: "xAI's assistant.",
    steps: [
      "Open Grok settings",
      "Add the MCP server config below",
    ],
  },
  {
    id: "other",
    name: "Other MCP Client",
    description: "Any app that supports the Model Context Protocol.",
    steps: [
      "Open your MCP client's settings",
      "Add the config below as a new MCP server",
    ],
  },
];

/* =========================================================================
   Page
   ========================================================================= */

export default function AgentsPage() {
  const connect = useDoppel((s) => s.connect);
  const inbox = useDoppel((s) => s.inbox);
  const now = useDoppel((s) => s.now);
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  useEffect(() => { connect(); }, [connect]);

  const activeAgent = AGENTS.find((a) => a.id === openAgent);

  return (
    <div className="max-w-[720px]">
      <section className="mb-10">
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700, marginBottom: 8 }}>
          Agents
        </h1>
        <p className="agent-voice" style={{ color: "var(--slate)", maxWidth: 520 }}>
          Connect your AI tools to Doppel. Each agent gets its own chat and inbox.
        </p>
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
              <strong style={{ color: "var(--ink)" }}>1. Connect</strong> — Click an agent, follow the setup steps
              to add Doppel as an MCP server inside that app.
            </p>
            <p>
              <strong style={{ color: "var(--ink)" }}>2. Chat</strong> — Send tasks to a specific agent from its
              chat thread, or use the whisper panel ("tell Claude to...").
            </p>
            <p>
              <strong style={{ color: "var(--ink)" }}>3. Pick up</strong> — Open the agent and ask it to
              <code style={{ background: "var(--surface-alt)", padding: "1px 6px", borderRadius: 4, margin: "0 3px" }}>check its Doppel inbox</code>.
              It picks up the task, does the work, and reports back.
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
                    <span style={{ color: "#e89b00", fontStyle: "italic" }}>Working on it...</span>
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
                    {task.status === "rejected" && "Cancelled"}
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
    doppel.mcpSnippet().then((r: { snippet: unknown; scriptPath: string; httpUrl?: string }) => {
      setSnippet(JSON.stringify({ mcpServers: { doppel: r.snippet } }, null, 2));
      if (r.httpUrl) setHttpUrl(r.httpUrl);
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
