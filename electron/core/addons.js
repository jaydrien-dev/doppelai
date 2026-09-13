const fs = require("node:fs");
const path = require("node:path");

const db = require("./db");
const oauth = require("./oauth");

/**
 * Doppel's add-on system.
 *
 * Add-ons extend what the agent can do: API integrations, MCP servers, or
 * custom tools. Each is a folder under `electron/addons/` with an `addon.json`
 * manifest and optionally a `handler.js` for the implementation.
 *
 * The base Doppel ships with a handful of built-in add-ons. Eventually this
 * becomes a store where people can browse and install more.
 */

const ADDONS_DIR = path.join(__dirname, "..", "addons");

/** All discovered add-ons, keyed by id. */
const registry = new Map();

/** Tool name -> addon id, for routing execute() calls. */
const toolOwner = new Map();

/** Live MCP client connections. */
const mcpClients = new Map();

/* -------------------------------------------------------------------- init */

function init() {
  registry.clear();
  toolOwner.clear();

  /* Scan the built-in addons directory. */
  let dirs = [];
  try {
    dirs = fs.readdirSync(ADDONS_DIR).filter((d) => {
      try { return fs.statSync(path.join(ADDONS_DIR, d)).isDirectory(); }
      catch { return false; }
    });
  } catch {
    /* No addons directory yet — that's fine. */
  }

  for (const dir of dirs) {
    const manifestPath = path.join(ADDONS_DIR, dir, "addon.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (!manifest.id) continue;

      let handler = null;
      const handlerPath = path.join(ADDONS_DIR, dir, "handler.js");
      if (fs.existsSync(handlerPath)) {
        handler = require(handlerPath);
      }

      registry.set(manifest.id, {
        manifest,
        handler,
        dir: path.join(ADDONS_DIR, dir),
      });
    } catch (err) {
      console.error(`[doppel] could not load add-on ${dir}:`, err.message);
    }
  }

  /* Reconcile with saved state — auto-install built-in add-ons that aren't
     in the state yet, and rebuild the tool routing map. */
  const state = db.get();
  if (!state.addons) state.addons = { installed: {} };

  for (const [id, entry] of registry) {
    if (!state.addons.installed[id] && entry.manifest.builtin) {
      state.addons.installed[id] = {
        enabled: true,
        config: {},
        installedAt: Date.now(),
      };
    }
  }

  rebuildToolMap();
  db.notify();

  console.log(
    `[doppel] add-ons: ${registry.size} found, ` +
    `${[...registry.values()].filter((e) => isEnabled(e.manifest.id)).length} enabled`,
  );
}

function rebuildToolMap() {
  toolOwner.clear();
  for (const [id, entry] of registry) {
    if (!isEnabled(id)) continue;
    for (const tool of entry.manifest.tools ?? []) {
      toolOwner.set(tool.name, id);
    }
  }
}

function isEnabled(id) {
  return db.get().addons?.installed?.[id]?.enabled === true;
}

/* -------------------------------------------------------------------- list */

/** Return all add-ons with their status, for the store UI. */
function list() {
  const state = db.get();
  const result = [];

  for (const [id, entry] of registry) {
    const saved = state.addons?.installed?.[id];
    const configValues = {};

    /* Redact secret config values, just like we do for API keys. */
    for (const field of entry.manifest.config ?? []) {
      const val = saved?.config?.[field.key] ?? "";
      if (field.secret && val.length > 6) {
        configValues[field.key] = `...${val.slice(-4)}`;
      } else {
        configValues[field.key] = val;
      }
    }

    result.push({
      id,
      name: entry.manifest.name,
      description: entry.manifest.description,
      version: entry.manifest.version ?? "0.1.0",
      author: entry.manifest.author ?? "Doppel",
      icon: entry.manifest.icon ?? "addon",
      category: entry.manifest.category ?? "general",
      type: entry.manifest.type ?? "api",
      builtin: Boolean(entry.manifest.builtin),
      permissions: entry.manifest.permissions ?? [],
      config: entry.manifest.config ?? [],
      tools: (entry.manifest.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
      })),
      installed: Boolean(saved),
      enabled: Boolean(saved?.enabled),
      userConfig: configValues,
      needsAuth: Boolean(entry.manifest.auth),
      connected: saved?.config?._connected === "true",
    });
  }

  return result;
}

/* --------------------------------------------------------------- mutations */

function install(id) {
  const entry = registry.get(id);
  if (!entry) return { ok: false, detail: "Add-on not found." };

  db.update((s) => {
    if (!s.addons) s.addons = { installed: {} };
    s.addons.installed[id] = {
      enabled: true,
      config: {},
      installedAt: Date.now(),
    };
  });
  rebuildToolMap();
  return { ok: true };
}

function uninstall(id) {
  const entry = registry.get(id);
  if (!entry) return { ok: false, detail: "Add-on not found." };
  if (entry.manifest.builtin) return { ok: false, detail: "Can't remove a built-in add-on." };

  disconnectMcp(id);
  db.update((s) => {
    if (s.addons?.installed) delete s.addons.installed[id];
  });
  rebuildToolMap();
  return { ok: true };
}

function enable(id) {
  const entry = registry.get(id);
  if (!entry) return { ok: false, detail: "Add-on not found." };

  db.update((s) => {
    if (!s.addons) s.addons = { installed: {} };
    if (!s.addons.installed[id]) {
      s.addons.installed[id] = { enabled: true, config: {}, installedAt: Date.now() };
    } else {
      s.addons.installed[id].enabled = true;
    }
  });
  rebuildToolMap();

  if (entry.manifest.type === "mcp") connectMcp(id).catch(() => {});
  return { ok: true };
}

function disable(id) {
  disconnectMcp(id);
  db.update((s) => {
    if (s.addons?.installed?.[id]) s.addons.installed[id].enabled = false;
  });
  rebuildToolMap();
  return { ok: true };
}

function setConfig(id, key, value) {
  db.update((s) => {
    if (!s.addons?.installed?.[id]) return;
    if (!s.addons.installed[id].config) s.addons.installed[id].config = {};
    s.addons.installed[id].config[key] = value;
  });
  return { ok: true };
}

/* --------------------------------------------------------- tool aggregation */

/**
 * Tool definitions from all enabled add-ons, ready to merge into the agent's
 * tool list. Each tool gets the add-on id stashed in a property so execute()
 * can route it.
 */
function getTools() {
  const tools = [];
  for (const [id, entry] of registry) {
    if (!isEnabled(id)) continue;

    /* MCP add-ons provide tools dynamically from the server. */
    if (entry.manifest.type === "mcp") {
      const client = mcpClients.get(id);
      if (client?.tools) {
        for (const tool of client.tools) {
          tools.push({
            name: tool.name,
            description: tool.description ?? "",
            input_schema: tool.inputSchema ?? { type: "object", properties: {} },
          });
        }
      }
      continue;
    }

    /* API and custom add-ons declare tools in the manifest. */
    for (const tool of entry.manifest.tools ?? []) {
      tools.push({
        name: tool.name,
        description: tool.description ?? "",
        input_schema: tool.input_schema ?? { type: "object", properties: {} },
      });
    }
  }
  return tools;
}

/** Brief documentation string for the agent's system prompt. */
function getToolDocs() {
  const lines = [];
  for (const [id, entry] of registry) {
    if (!isEnabled(id)) continue;
    const tools = entry.manifest.tools ?? [];
    if (tools.length === 0 && entry.manifest.type !== "mcp") continue;

    if (entry.manifest.type === "mcp") {
      const client = mcpClients.get(id);
      if (client?.tools?.length) {
        lines.push(`**${entry.manifest.name}**: ${entry.manifest.description}`);
        for (const t of client.tools) {
          lines.push(`  - ${t.name}: ${t.description ?? ""}`);
        }
      }
    } else {
      lines.push(`**${entry.manifest.name}**: ${entry.manifest.description}`);
      for (const t of tools) {
        lines.push(`  - ${t.name}: ${t.description}`);
      }
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------ tool execution */

/**
 * Execute an add-on tool by name. Returns { text } or { error, text }, or
 * null if no add-on owns this tool name.
 */
async function execute(toolName, input) {
  const addonId = toolOwner.get(toolName);
  if (!addonId) return null;

  const entry = registry.get(addonId);
  if (!entry) return { error: true, text: "Add-on not found." };

  const saved = db.get().addons?.installed?.[addonId];
  const config = saved?.config ?? {};

  /* MCP tools go through the MCP client. */
  if (entry.manifest.type === "mcp") {
    return executeMcp(addonId, toolName, input);
  }

  /* API and custom tools go through handler.js. */
  if (!entry.handler?.[toolName]) {
    return { error: true, text: `Add-on "${entry.manifest.name}" has no handler for "${toolName}".` };
  }

  /* For OAuth add-ons, get a valid token and pass it to the handler. */
  if (entry.manifest.auth) {
    const token = await getToken(addonId);
    if (!token) {
      return { error: true, text: `Not connected. Enable the ${entry.manifest.name} add-on and click Connect in the Add-ons page.` };
    }
    config = { ...config, _token: token };
  }

  try {
    const result = await entry.handler[toolName](input, config);
    if (typeof result === "string") return { text: result };
    return result;
  } catch (err) {
    return { error: true, text: `Add-on error: ${err.message}` };
  }
}

/* -------------------------------------------------------------------- MCP */

async function connectMcp(id) {
  const entry = registry.get(id);
  if (!entry || entry.manifest.type !== "mcp") return;

  const server = entry.manifest.server;
  if (!server?.command) return;

  try {
    const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

    const saved = db.get().addons?.installed?.[id];
    const config = saved?.config ?? {};

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: { ...process.env, ...(server.env ?? {}), ...config },
    });

    const client = new Client({ name: "doppel", version: "0.1.0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    mcpClients.set(id, { client, transport, tools });

    /* Register MCP tool names in the routing map. */
    for (const tool of tools) toolOwner.set(tool.name, id);

    console.log(`[doppel] MCP connected: ${entry.manifest.name} (${tools.length} tools)`);
  } catch (err) {
    console.error(`[doppel] MCP connect failed for ${id}:`, err.message);
  }
}

async function disconnectMcp(id) {
  const client = mcpClients.get(id);
  if (!client) return;

  /* Remove tool routing entries. */
  for (const tool of client.tools ?? []) toolOwner.delete(tool.name);

  try { await client.client.close(); } catch {}
  mcpClients.delete(id);
}

async function executeMcp(addonId, toolName, input) {
  const client = mcpClients.get(addonId);
  if (!client) return { error: true, text: "MCP server not connected." };

  try {
    const result = await client.client.callTool({ name: toolName, arguments: input });
    const text = (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return { text: text || "Done.", ...(result.isError ? { error: true } : {}) };
  } catch (err) {
    return { error: true, text: `MCP error: ${err.message}` };
  }
}

/* ------------------------------------------------------------------- auth */

/**
 * Start the OAuth flow for an add-on. Opens the user's browser to the
 * consent page, waits for the redirect, and stores the tokens.
 */
async function startAuth(id) {
  const entry = registry.get(id);
  if (!entry) return { ok: false, error: "Add-on not found." };
  if (!entry.manifest.auth) return { ok: false, error: "This add-on doesn't use OAuth." };

  const result = await oauth.authorize(entry.manifest.auth);
  if (!result.ok) return result;

  /* Store tokens in the add-on's config. */
  db.update((s) => {
    if (!s.addons) s.addons = { installed: {} };
    if (!s.addons.installed[id]) {
      s.addons.installed[id] = { enabled: true, config: {}, installedAt: Date.now() };
    }
    s.addons.installed[id].config._access_token = result.tokens.access_token;
    s.addons.installed[id].config._refresh_token = result.tokens.refresh_token || "";
    s.addons.installed[id].config._expires_at = String(result.tokens.expires_at);
    s.addons.installed[id].config._connected = "true";
  });

  rebuildToolMap();
  return { ok: true };
}

/**
 * Disconnect an add-on's OAuth — clear stored tokens.
 */
function disconnectAuth(id) {
  db.update((s) => {
    const saved = s.addons?.installed?.[id];
    if (!saved) return;
    delete saved.config._access_token;
    delete saved.config._refresh_token;
    delete saved.config._expires_at;
    delete saved.config._connected;
  });
  return { ok: true };
}

/**
 * Get a valid access token for an add-on, refreshing if needed.
 * This is called by handlers at execution time.
 */
async function getToken(id) {
  const entry = registry.get(id);
  if (!entry?.manifest.auth) return null;

  const saved = db.get().addons?.installed?.[id];
  if (!saved?.config?._access_token) return null;

  const expiresAt = Number(saved.config._expires_at || 0);

  /* If the token expires in the next 5 minutes, refresh it. */
  if (expiresAt > 0 && Date.now() > expiresAt - 5 * 60_000) {
    const refreshToken = saved.config._refresh_token;
    if (!refreshToken) return null;

    try {
      const fresh = await oauth.refresh(entry.manifest.auth, refreshToken);
      db.update((s) => {
        const cfg = s.addons.installed[id].config;
        cfg._access_token = fresh.access_token;
        cfg._refresh_token = fresh.refresh_token;
        cfg._expires_at = String(fresh.expires_at);
      });
      return fresh.access_token;
    } catch (err) {
      console.error(`[doppel] token refresh failed for ${id}:`, err.message);
      return null;
    }
  }

  return saved.config._access_token;
}

/* ---------------------------------------------------------------- shutdown */

async function shutdown() {
  for (const [id] of mcpClients) {
    await disconnectMcp(id);
  }
}

module.exports = {
  init,
  list,
  install,
  uninstall,
  enable,
  disable,
  setConfig,
  getTools,
  getToolDocs,
  execute,
  startAuth,
  disconnectAuth,
  getToken,
  shutdown,
};
