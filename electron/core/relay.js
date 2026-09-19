const WebSocket = require("ws");
const https = require("node:https");
const db = require("./db");
const account = require("./account");

/**
 * MCP Relay Client
 *
 * Connects this machine to the identity server via WebSocket so that external
 * AI agents can reach the local MCP server through a public URL.
 *
 * Flow:
 *   1. Opens a WS connection to the identity server at /v1/relay
 *   2. Server assigns a public URL: /mcp/:accountId
 *   3. When an external AI agent hits that URL, the server forwards the
 *      MCP JSON-RPC request over the WS to us
 *   4. We forward it to the local HTTPS MCP server at 127.0.0.1:4320/mcp
 *   5. We send the response back over the WS
 *
 * The identity server never sees brain data — it's a dumb pipe.
 */

const LOCAL_MCP = `https://127.0.0.1:${process.env.DOPPEL_MCP_PORT ?? 4320}/mcp`;

let ws = null;
let publicMcpUrl = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let intentionallyClosed = false;
let onStatusChange = null;

function status() {
  return {
    connected: ws?.readyState === WebSocket.OPEN,
    mcpUrl: publicMcpUrl,
  };
}

/**
 * Forward an MCP request to the local HTTPS server and return the response.
 */
function forwardToLocal(method, headers, body) {
  return new Promise((resolve) => {
    const url = new URL(LOCAL_MCP);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {},
      rejectUnauthorized: false, // self-signed cert
    };
    if (headers["content-type"]) opts.headers["content-type"] = headers["content-type"];
    if (headers["accept"]) opts.headers["accept"] = headers["accept"];
    if (headers["mcp-session-id"]) opts.headers["mcp-session-id"] = headers["mcp-session-id"];

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: {
            "content-type": res.headers["content-type"],
            "mcp-session-id": res.headers["mcp-session-id"],
          },
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    req.on("error", (err) => {
      console.error("[relay] local MCP error:", err.message);
      resolve({
        status: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "local_mcp_unreachable", detail: err.message }),
      });
    });

    if (body) req.write(body);
    req.end();
  });
}

function connect() {
  const acct = db.get().account ?? {};
  const token = acct.token;
  const server = account.serverUrl();

  if (!token || !acct.accountId) {
    // Not signed in — nothing to relay
    return;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return; // already connected or connecting
  }

  intentionallyClosed = false;

  // Convert http(s) to ws(s)
  const wsUrl = server.replace(/^http/, "ws") + "/v1/relay";

  try {
    ws = new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error("[relay] failed to create WebSocket:", err.message);
    scheduleReconnect();
    return;
  }

  ws.on("open", () => {
    console.log("[relay] connected to identity server");
    reconnectDelay = 1000; // reset backoff
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "relay-ready") {
      const serverBase = server.replace(/^https?:/, "https:");
      publicMcpUrl = `${serverBase}${msg.mcpUrl}`;
      console.log("[relay] public MCP URL:", publicMcpUrl);
      if (onStatusChange) onStatusChange(status());
      return;
    }

    if (msg.type === "mcp-request" && msg.id) {
      // Forward to local MCP server
      const result = await forwardToLocal(
        msg.method || "POST",
        msg.headers || {},
        msg.body || "",
      );

      // Send response back over WS
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "mcp-response",
          id: msg.id,
          status: result.status,
          headers: result.headers,
          body: result.body,
        }));
      }
    }
  });

  ws.on("close", (code) => {
    console.log(`[relay] disconnected (code ${code})`);
    publicMcpUrl = null;
    if (onStatusChange) onStatusChange(status());
    /* 4000 = "replaced" — another device took this account's relay slot.
       Reconnecting would just kick that one off in a loop. */
    if (!intentionallyClosed && code !== 4000) scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[relay] error:", err.message);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  console.log(`[relay] reconnecting in ${reconnectDelay / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000); // cap at 30s
    connect();
  }, reconnectDelay);
}

function disconnect() {
  intentionallyClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  publicMcpUrl = null;
}

/**
 * Start the relay. Called once from main.js after the app is ready.
 * Reconnects automatically when the account state changes (sign in/out).
 */
function init(statusCallback) {
  onStatusChange = statusCallback || null;

  // Connect immediately if signed in
  connect();

  // Watch for account changes (sign in, sign out, server change)
  let lastToken = db.get().account?.token ?? "";
  db.subscribe(() => {
    const currentToken = db.get().account?.token ?? "";
    if (currentToken !== lastToken) {
      lastToken = currentToken;
      disconnect();
      if (currentToken) {
        // Small delay to let the sign-in settle
        setTimeout(() => connect(), 500);
      }
    }
  });
}

function shutdown() {
  disconnect();
}

module.exports = { init, shutdown, status, connect, disconnect };
