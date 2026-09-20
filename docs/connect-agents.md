# Connecting AI Agents to Doppel

Doppel runs an MCP (Model Context Protocol) server that gives any compatible AI agent access to your personal memory — everything Doppel has observed, learned, and remembered about you.

## Prerequisites

1. **Doppel must have been opened at least once** so its data directory exists.
2. **Node.js** must be installed and available in your PATH.
3. You need the path to `electron/mcp-server.js` in your Doppel source directory.

### Paths

| Platform | MCP Server Script | Doppel Data |
|----------|-------------------|-------------|
| **Windows** | `C:\Users\<you>\OneDrive\Documents\MIMIC\electron\mcp-server.js` | `%APPDATA%\Doppel` |
| **macOS** | `~/code/doppel/electron/mcp-server.js` | `~/Library/Application Support/Doppel` |
| **Linux** | `~/code/doppel/electron/mcp-server.js` | `~/.config/Doppel` |

Replace the script path with wherever you cloned the repo.

---

## Available Tools

Once connected, agents get access to these tools:

| Tool | What it does |
|------|-------------|
| `recall` | Semantic + keyword search over all memory |
| `ask` | AI-powered Q&A synthesized from memory |
| `remember` | Store information into Doppel's brain |
| `screen_now` | What's currently on your screen |
| `recent_activity` | Last N observations |
| `known_entities` | People, apps, projects Doppel knows about |
| `user_context` | Full current state: active app, narration, folders |
| `patterns` | Behavioral patterns: app usage, time distribution |
| `daily_summary` | All observations for a given date |
| `available_dates` | Which dates have recorded activity |
| `focused_recall` | Search with time, app, and entity filters |
| `episode_timeline` | Chronological timeline for a date range |
| `morning_brief` | Synthesized daily digest |
| `about_user` | High-level summary of what Doppel knows |
| `user_profile` | Structured profile built from observations |
| `respond_as_user` | Draft a response in your voice and style |
| `check_inbox` | Poll for tasks you've queued for this agent |
| `claim_task` | Claim a task before working on it |
| `report_result` | Report task completion back to you |
| `orchestrate` | Create multi-step workflows across agents |

---

## Claude Desktop

**Config file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Create or edit the file:**

```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\OneDrive\\Documents\\MIMIC\\electron\\mcp-server.js"]
    }
  }
}
```

macOS version:
```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["/Users/<you>/code/doppel/electron/mcp-server.js"]
    }
  }
}
```

**After editing:** Fully quit Claude Desktop (not just close the window) and reopen it. You should see a hammer icon in the chat input — click it to verify "doppel" appears with its tools.

**Test it:** Ask Claude "What do you know about me?" — it should call `about_user` or `recall` and answer from your Doppel memory.

---

## Claude Code (CLI)

Run this command in your terminal:

```bash
claude mcp add doppel -- node /path/to/doppel/electron/mcp-server.js
```

Windows example:
```bash
claude mcp add doppel -- node "C:\Users\<you>\OneDrive\Documents\MIMIC\electron\mcp-server.js"
```

This saves to `~/.claude/settings.json`. To add it to a specific project instead:

```bash
claude mcp add --scope project doppel -- node /path/to/doppel/electron/mcp-server.js
```

**Verify:** Run `claude mcp list` to confirm "doppel" appears.

---

## Cursor

**Config file location:**
- Project-level: `.cursor/mcp.json` in your project root
- Global: `~/.cursor/mcp.json`

**Create or edit the file:**

```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\OneDrive\\Documents\\MIMIC\\electron\\mcp-server.js"]
    }
  }
}
```

macOS:
```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["/Users/<you>/code/doppel/electron/mcp-server.js"]
    }
  }
}
```

**After editing:** Restart Cursor. Open Settings > MCP to verify the server is connected (green dot).

**Note:** Cursor has a ~40 tool limit across all MCP servers. Doppel registers 20 tools, so keep this in mind if you have other MCP servers.

**Using the inbox:** In Cursor's agent mode, tell it to `check_inbox` to see if you've queued tasks for it from Doppel. After completing work, it can `report_result` back to you.

---

## Windsurf (Codeium)

**Config file location:**
- macOS/Linux: `~/.codeium/windsurf/mcp_config.json`
- Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`

**Create or edit the file:**

```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\OneDrive\\Documents\\MIMIC\\electron\\mcp-server.js"]
    }
  }
}
```

macOS:
```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["/Users/<you>/code/doppel/electron/mcp-server.js"]
    }
  }
}
```

**After editing:** Restart Windsurf. Check the MCP panel in settings to confirm the server is running.

---

## Cline (VS Code Extension)

**Easiest way:** Open Cline's sidebar panel > click the MCP Servers icon (plug icon) > Configure tab > edit the JSON.

**Config file location (manual):**
- macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

**Add to the file:**

```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\OneDrive\\Documents\\MIMIC\\electron\\mcp-server.js"]
    }
  }
}
```

**After editing:** Cline auto-detects changes. You should see "doppel" in the MCP Servers list with a green status.

---

## VS Code + Continue

**Config file:** `~/.continue/config.yaml` (preferred) or `~/.continue/config.json`

**YAML format (add to existing config):**

```yaml
mcpServers:
  - name: doppel
    command: node
    args:
      - /path/to/doppel/electron/mcp-server.js
```

Windows:
```yaml
mcpServers:
  - name: doppel
    command: node
    args:
      - C:\Users\<you>\OneDrive\Documents\MIMIC\electron\mcp-server.js
```

**Alternative:** Drop a JSON config file into `~/.continue/mcpServers/doppel.json`:
```json
{
  "command": "node",
  "args": ["/path/to/doppel/electron/mcp-server.js"]
}
```

**After editing:** Restart VS Code or reload the Continue extension.

---

## Amazon Q Developer

**Config file location:**
- Global: `~/.aws/amazonq/mcp.json`
- Workspace: `.amazonq/mcp.json` in your project root

**Create or edit the file:**

```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["/path/to/doppel/electron/mcp-server.js"]
    }
  }
}
```

Windows:
```json
{
  "mcpServers": {
    "doppel": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\OneDrive\\Documents\\MIMIC\\electron\\mcp-server.js"]
    }
  }
}
```

**After editing:** Restart Q Developer. Use `/tools` in chat to verify doppel tools are available.

---

## Zed Editor

**Config file:** `~/.config/zed/settings.json`

**Add a `context_servers` key (not `mcpServers`):**

```json
{
  "context_servers": {
    "doppel": {
      "source": "custom",
      "command": "node",
      "args": ["/path/to/doppel/electron/mcp-server.js"]
    }
  }
}
```

**Note:** Zed requires `"source": "custom"` for manually-added servers. It only supports stdio transport currently.

**After editing:** Restart Zed.

---

## Workflows: Multi-Agent Orchestration

Doppel can coordinate work across multiple agents. Here's how it works:

1. **You create a workflow** in the Doppel app (Agents tab) with ordered steps, each targeting a specific agent (e.g. "Cursor", "Claude Desktop").

2. **Step 1 auto-queues** as an inbox task. The targeted agent calls `check_inbox` and sees it.

3. **The agent claims it** with `claim_task`, does the work, then calls `report_result` with its output.

4. **Doppel auto-advances** to the next step, passing the previous output as context to the next agent.

**Example workflow:**
- Step 1 (Cursor): "Write unit tests for the auth module"
- Step 2 (Claude Desktop): "Review the tests and suggest improvements"

Each agent only needs the standard MCP connection above. The orchestration happens through the inbox system automatically.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Data directory not found" | Open the Doppel app at least once first |
| Tools don't appear | Restart the agent app after editing config |
| `recall` returns nothing | Doppel needs to observe for a while first — let it watch your screen |
| `ask` fails | Set your Anthropic API key in Doppel's Settings page |
| Agent can't find `node` | Use the full path to node (e.g. `/usr/local/bin/node` or `C:\Program Files\nodejs\node.exe`) |
