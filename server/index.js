const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

/* Load .env from the server directory if present. */
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const store = require("./store");

/**
 * Doppel's identity server.
 *
 * Small on purpose. It knows who you are and which machines are yours, and
 * nothing else — no routines, no memories, no observations. The trained agent
 * stays on the user's own machine, so there is deliberately nowhere here to
 * put it even if a future feature were tempted to.
 *
 * No framework and no identity vendor. Handing identity to a third party would
 * contradict the one claim the product is built on: that the user owns the
 * model of themselves. Running this yourself is the point.
 */

const PORT = Number(process.env.PORT ?? process.env.DOPPEL_SERVER_PORT ?? 4319);
const HOST = process.env.DOPPEL_SERVER_HOST ?? "0.0.0.0";
const DATA_DIR =
  process.env.DOPPEL_SERVER_DATA
  || (os.homedir() ? path.join(os.homedir(), ".doppel-identity") : "/data");

/**
 * Email delivery is not wired up. Rather than pretend, the sign-in link is
 * returned to the caller and printed here, and the interface says plainly that
 * it is showing the link because nothing is sending it yet.
 */
const EMAIL_CONFIGURED = false;

/* --------------------------------------------------------------- plumbing */

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        /* OAuth token requests use form-encoded bodies */
        const params = {};
        for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
        return resolve(params);
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Body was not JSON"));
      }
    });
    req.on("error", reject);
  });
}

const bearer = (req) => {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

const requireAuth = (req, res) => {
  const found = store.authenticate(bearer(req));
  if (!found) {
    json(res, 401, { error: "not_signed_in" });
    return null;
  }
  return found;
};

const publicDevice = (device, currentId) => ({
  id: device.id,
  name: device.name,
  kind: device.kind,
  platform: device.platform,
  pairedAt: device.pairedAt,
  lastSeenAt: device.lastSeenAt,
  current: device.id === currentId,
});

const validEmail = (email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? "").trim());

/* ----------------------------------------------------------------- routes */

const routes = {
  /* Ask for a sign-in link. Deliberately does not reveal whether the address
     is already registered. */
  "POST /v1/auth/link": async (req, res) => {
    const { email } = await readBody(req);
    if (!validEmail(email)) return json(res, 400, { error: "bad_email" });

    const link = store.createLink(email);
    console.log(`\n[doppel-id] sign-in link for ${store.normaliseEmail(email)}:\n  ${link}\n`);

    /* Only return the link in the HTTP response when running locally.
       On a public server without email configured, the link is logged to
       the console only — returning it would let anyone sign in as anyone. */
    const isLocal = HOST === "127.0.0.1" || HOST === "localhost";
    return json(res, 200, {
      sent: true,
      emailConfigured: EMAIL_CONFIGURED,
      link: (!EMAIL_CONFIGURED && isLocal) ? link : undefined,
    });
  },

  /* Redeem the link, pairing this device in the same step. */
  "POST /v1/auth/verify": async (req, res) => {
    const { token, deviceName, deviceKind, platform } = await readBody(req);
    const used = store.consumeLink(String(token ?? "").trim());
    if (!used.ok) return json(res, 400, { error: `link_${used.reason}` });

    const account = store.accountByEmail(used.email) ?? store.createAccount(used.email);
    const device = store.pairDevice(account.id, {
      name: deviceName,
      kind: deviceKind,
      platform,
    });
    const { token: sessionToken } = store.createSession(account.id, device.id);

    return json(res, 200, {
      token: sessionToken,
      account: { id: account.id, email: account.email, createdAt: account.createdAt },
      device: publicDevice(device, device.id),
      hasPassword: Boolean(account.password),
    });
  },

  /* The password path, for anyone who would rather not wait for a link. */
  "POST /v1/auth/password": async (req, res) => {
    const { email, password, deviceName, deviceKind, platform } = await readBody(req);
    if (!validEmail(email) || !password) return json(res, 400, { error: "bad_credentials" });

    const account = store.accountByEmail(email);
    if (!account?.password) return json(res, 401, { error: "bad_credentials" });
    if (!store.passwordMatches(password, account.password.salt, account.password.hash)) {
      return json(res, 401, { error: "bad_credentials" });
    }

    const device = store.pairDevice(account.id, { name: deviceName, kind: deviceKind, platform });
    const { token } = store.createSession(account.id, device.id);

    return json(res, 200, {
      token,
      account: { id: account.id, email: account.email, createdAt: account.createdAt },
      device: publicDevice(device, device.id),
      hasPassword: true,
    });
  },

  "POST /v1/auth/password/set": async (req, res) => {
    const found = requireAuth(req, res);
    if (!found) return undefined;
    const { password } = await readBody(req);
    if (!password || String(password).length < 10) {
      return json(res, 400, { error: "too_short", minimum: 10 });
    }
    store.setPassword(found.account.id, String(password));
    return json(res, 200, { ok: true });
  },

  /* Everything the account holds, for the account home. */
  "GET /v1/account": async (req, res) => {
    const found = requireAuth(req, res);
    if (!found) return undefined;

    return json(res, 200, {
      account: {
        id: found.account.id,
        email: found.account.email,
        createdAt: found.account.createdAt,
        hasPassword: Boolean(found.account.password),
      },
      devices: store
        .devicesFor(found.account.id)
        .map((d) => publicDevice(d, found.device.id))
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      sessions: store.sessionsFor(found.account.id).length,
      currentDeviceId: found.device.id,
    });
  },

  "POST /v1/heartbeat": async (req, res) => {
    const found = requireAuth(req, res);
    if (!found) return undefined;
    return json(res, 200, { ok: true, at: Date.now() });
  },

  "POST /v1/auth/signout-all": async (req, res) => {
    const found = requireAuth(req, res);
    if (!found) return undefined;
    const { keepThisDevice } = await readBody(req);
    const revoked = store.revokeAllSessions(found.account.id, {
      exceptDeviceId: keepThisDevice ? found.device.id : null,
    });
    return json(res, 200, { ok: true, revoked });
  },

  "GET /v1/account/export": async (req, res) => {
    const found = requireAuth(req, res);
    if (!found) return undefined;
    return json(res, 200, store.exportAccount(found.account.id));
  },

  "DELETE /v1/account": async (req, res) => {
    const found = requireAuth(req, res);
    if (!found) return undefined;
    const gone = store.deleteAccount(found.account.id);
    return json(res, 200, { deleted: gone });
  },
};

/* --------------------------------------------------------------- billing */

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

const PRO_PRICE_ID = "price_1UFwALGPQDGH6ygYesHAfUCL";

const PACK_PRICES = {
  "price_1UFw8UGPQDGH6ygY5meqjAWI": 100,
  "price_1UFw8jGPQDGH6ygYdATY7wPt": 500,
  "price_1UFw95GPQDGH6ygY9KYQvKa7": 2000,
  "price_1UFw9sGPQDGH6ygYyP3C7abz": 5000,
};

let stripe = null;
function getStripe() {
  if (!stripe && STRIPE_SECRET) {
    stripe = require("stripe")(STRIPE_SECRET);
  }
  return stripe;
}

/**
 * Create a Stripe Checkout session for a plan upgrade or token purchase.
 */
routes["POST /v1/billing/checkout"] = async (req, res) => {
  const found = requireAuth(req, res);
  if (!found) return undefined;
  const s = getStripe();
  if (!s) return json(res, 503, { error: "stripe_not_configured" });

  const { priceId } = await readBody(req);
  if (!priceId) return json(res, 400, { error: "missing_price_id" });

  const isPro = priceId === PRO_PRICE_ID;
  const isTokenPack = priceId in PACK_PRICES;
  if (!isPro && !isTokenPack) return json(res, 400, { error: "unknown_price" });

  const session = await s.checkout.sessions.create({
    mode: isPro ? "subscription" : "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: found.account.id,
    customer_email: found.account.email,
    metadata: {
      accountId: found.account.id,
      type: isPro ? "pro" : "tokens",
      tokens: isTokenPack ? String(PACK_PRICES[priceId]) : "0",
    },
    success_url: "https://doppel.ai/payment-success?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://doppel.ai/payment-cancelled",
  });

  return json(res, 200, { ok: true, url: session.url, sessionId: session.id });
};

/**
 * Verify a completed Checkout session and return what was purchased.
 */
routes["POST /v1/billing/verify"] = async (req, res) => {
  const found = requireAuth(req, res);
  if (!found) return undefined;
  const s = getStripe();
  if (!s) return json(res, 503, { error: "stripe_not_configured" });

  const { sessionId } = await readBody(req);
  if (!sessionId) return json(res, 400, { error: "missing_session_id" });

  const session = await s.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") {
    return json(res, 400, { error: "not_paid", status: session.payment_status });
  }
  if (session.client_reference_id !== found.account.id) {
    return json(res, 403, { error: "wrong_account" });
  }

  const meta = session.metadata ?? {};
  return json(res, 200, {
    ok: true,
    type: meta.type,
    tokens: Number(meta.tokens) || 0,
    priceId: session.line_items?.data?.[0]?.price?.id ?? null,
  });
};

/** Revoking a device is `POST /v1/devices/:id/revoke`, so it needs a pattern. */
async function revokeDeviceRoute(req, res, deviceId) {
  const found = requireAuth(req, res);
  if (!found) return undefined;
  const result = store.revokeDevice(found.account.id, deviceId);
  if (!result.ok) return json(res, 404, { error: "unknown_device" });
  return json(res, 200, {
    ok: true,
    revoked: deviceId,
    wasCurrentDevice: deviceId === found.device.id,
  });
}

/* ----------------------------------------------------------- OAuth 2.0 for MCP */

const crypto = require("node:crypto");

/**
 * Minimal OAuth 2.0 server for MCP connectors (Claude, etc.).
 *
 * Claude's connector requires OAuth to connect to remote MCP servers.
 * We implement just enough: dynamic client registration, authorization
 * code grant, and token exchange. The tokens map onto the existing
 * Doppel identity system.
 */

const oauthClients = new Map();  // clientId → { secret, redirectUris, name }
const oauthCodes = new Map();    // code → { clientId, accountId, expiresAt, codeChallenge, codeChallengeMethod }
/* OAuth tokens are persisted in the store (store.oauthTokens) so they survive deploys. */

/* Dynamic Client Registration (RFC 7591) */
routes["POST /oauth/register"] = async (req, res) => {
  const body = await readBody(req);
  const clientId = `client_${crypto.randomBytes(16).toString("hex")}`;
  const clientSecret = crypto.randomBytes(32).toString("hex");
  oauthClients.set(clientId, {
    secret: clientSecret,
    redirectUris: body.redirect_uris || [],
    name: body.client_name || "MCP Client",
  });
  return json(res, 201, {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: body.redirect_uris || [],
    client_name: body.client_name || "MCP Client",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  });
};

/* Token Exchange */
routes["POST /oauth/token"] = async (req, res) => {
  const body = await readBody(req);

  if (body.grant_type !== "authorization_code") {
    return json(res, 400, { error: "unsupported_grant_type" });
  }

  const codeEntry = oauthCodes.get(body.code);
  if (!codeEntry || Date.now() > codeEntry.expiresAt) {
    oauthCodes.delete(body.code);
    return json(res, 400, { error: "invalid_grant" });
  }

  /* PKCE verification */
  if (codeEntry.codeChallenge) {
    const verifier = body.code_verifier || "";
    const expected = codeEntry.codeChallengeMethod === "S256"
      ? crypto.createHash("sha256").update(verifier).digest("base64url")
      : verifier;
    if (expected !== codeEntry.codeChallenge) {
      return json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
    }
  }

  oauthCodes.delete(body.code);

  const accessToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = store.digest(accessToken);
  store.createOAuthToken(tokenHash, codeEntry.clientId, codeEntry.accountId);

  return json(res, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 86400,
    scope: "mcp",
  });
};

/* ----------------------------------------------------------- MCP relay */

const WebSocket = require("ws");

/**
 * MCP relay — lets external AI agents reach a user's local Doppel brain
 * through a public URL.
 *
 * Flow:
 *   1. Doppel desktop app connects via WS to /v1/relay (auth'd with bearer token)
 *   2. External AI agent sends MCP HTTP request to /mcp/:accountId
 *   3. Server forwards the request over the WS to the desktop app
 *   4. Desktop app processes it locally and sends the response back
 *   5. Server returns the response to the external AI agent
 *
 * The server never sees brain data — it's a dumb pipe.
 */

/** Map<accountId, WebSocket> — one relay connection per account. */
const relayClients = new Map();

/** Map<requestId, { res, timer }> — pending HTTP requests waiting for WS response. */
const pendingRelay = new Map();
let relaySeq = 0;

/**
 * Handle incoming MCP requests from external AI agents.
 * Route: POST /mcp/:accountId  (also GET, DELETE for full Streamable HTTP support)
 */
async function mcpRelayRoute(req, res, accountId) {
  /* GET without a session is a discovery/health probe from connectors like Claude.
     Return a simple JSON-RPC server info response so the connector knows we exist. */
  if (req.method === "GET" && !req.headers["mcp-session-id"]) {
    return json(res, 200, {
      jsonrpc: "2.0",
      result: {
        name: "doppel",
        version: "3.0.0",
        status: relayClients.has(accountId) ? "online" : "offline",
      },
    });
  }

  const ws = relayClients.get(accountId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return json(res, 502, { error: "device_offline", detail: "The user's Doppel is not connected." });
  }

  /* Read the raw body (MCP JSON-RPC). */
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");

  const relayId = String(++relaySeq);

  /* Forward to the desktop app over WS. */
  ws.send(JSON.stringify({
    type: "mcp-request",
    id: relayId,
    method: req.method,
    headers: {
      "content-type": req.headers["content-type"],
      "accept": req.headers["accept"],
      "mcp-session-id": req.headers["mcp-session-id"],
    },
    body,
  }));

  /* Wait for the response (timeout after 120s). */
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRelay.delete(relayId);
      json(res, 504, { error: "timeout", detail: "Doppel did not respond in time." });
      resolve();
    }, 120_000);

    pendingRelay.set(relayId, {
      accountId,
      resolve: (relayRes) => {
        clearTimeout(timer);
        pendingRelay.delete(relayId);

        /* Forward response headers */
        const outHeaders = {
          "content-type": relayRes.headers?.["content-type"] ?? "application/json",
        };
        if (relayRes.headers?.["mcp-session-id"]) {
          outHeaders["mcp-session-id"] = relayRes.headers["mcp-session-id"];
        }
        res.writeHead(relayRes.status ?? 200, outHeaders);
        res.end(relayRes.body ?? "");
        resolve();
      },
    });
  });
}

/* --------------------------------------------------------------- the server */

const server = http.createServer(async (req, res) => {
  /* The desktop app is not a browser origin, but the Pocket surface may be. */
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, mcp-session-id");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("access-control-expose-headers", "mcp-session-id");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const key = `${req.method} ${url.pathname}`;

  try {
    if (url.pathname === "/v1/health") return json(res, 200, { ok: true, service: "doppel-identity" });

    /* OAuth metadata discovery */
    if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") {
      const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
      return json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256", "plain"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      });
    }

    /* OAuth authorization endpoint */
    if (url.pathname === "/oauth/authorize" && req.method === "GET") {
      const clientId = url.searchParams.get("client_id");
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const codeChallenge = url.searchParams.get("code_challenge");
      const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "plain";

      if (!clientId || !redirectUri) {
        return json(res, 400, { error: "invalid_request" });
      }

      /* Validate redirect_uri against registered client */
      const client = oauthClients.get(clientId);
      if (!client) {
        return json(res, 400, { error: "invalid_client" });
      }
      if (!client.redirectUris.length) {
        return json(res, 400, { error: "invalid_client", detail: "Client has no registered redirect URIs." });
      }
      if (!client.redirectUris.includes(redirectUri)) {
        return json(res, 400, { error: "invalid_redirect_uri" });
      }

      /* The caller must prove they own this Doppel account by presenting a
         valid session token. Without this, anyone who knows the server URL
         could get an OAuth code for any account. */
      const found = store.authenticate(bearer(req) || url.searchParams.get("session_token"));
      if (!found) {
        return json(res, 401, { error: "not_signed_in", detail: "A valid Doppel session is required to authorize MCP access." });
      }
      const account = found.account;

      /* Auto-approve: the user already proved identity via their session. */
      const code = crypto.randomBytes(32).toString("base64url");
      oauthCodes.set(code, {
        clientId,
        accountId: account.id,
        expiresAt: Date.now() + 5 * 60_000,
        codeChallenge: codeChallenge || null,
        codeChallengeMethod,
      });

      const redir = new URL(redirectUri);
      redir.searchParams.set("code", code);
      if (state) redir.searchParams.set("state", state);

      res.writeHead(302, { location: redir.toString() });
      res.end();
      return;
    }

    /* MCP relay — /mcp/:accountId */
    const mcpMatch = url.pathname.match(/^\/mcp\/([\w-]+)$/);
    if (mcpMatch) {
      res.setHeader("access-control-expose-headers", "mcp-session-id");

      /* GET probes (discovery) are public — connectors need to check the server exists. */
      if (req.method === "GET" && !req.headers["mcp-session-id"]) {
        return await mcpRelayRoute(req, res, mcpMatch[1]);
      }

      /* All other requests require a valid OAuth token. */
      const authToken = bearer(req);
      if (!authToken) {
        return json(res, 401, { error: "unauthorized", detail: "A valid OAuth token is required." });
      }
      const tokenEntry = store.findOAuthToken(store.digest(authToken));
      if (!tokenEntry) {
        return json(res, 401, { error: "unauthorized", detail: "Token is invalid or expired." });
      }

      /* Verify token is scoped to this account. */
      if (tokenEntry.accountId !== mcpMatch[1]) {
        return json(res, 403, { error: "forbidden", detail: "Token is not scoped to this account." });
      }

      return await mcpRelayRoute(req, res, mcpMatch[1]);
    }

    const revoke = url.pathname.match(/^\/v1\/devices\/([\w-]+)\/revoke$/);
    if (revoke && req.method === "POST") return await revokeDeviceRoute(req, res, revoke[1]);

    const handler = routes[key];
    if (!handler) return json(res, 404, { error: "no_such_route" });

    return await handler(req, res);
  } catch (err) {
    console.error("[doppel-id]", err);
    return json(res, 400, { error: "bad_request", detail: err.message });
  }
});

function start() {
  store.init(DATA_DIR);
  setInterval(() => store.prune(), 60 * 60_000);

  /* WebSocket server for relay connections from desktop apps. */
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== "/v1/relay") {
      socket.destroy();
      return;
    }

    /* Authenticate using the same bearer token as HTTP routes. */
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const found = store.authenticate(token);
    if (!found) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const accountId = found.account.id;
      console.log(`[relay] device ${found.device.name} connected (account ${accountId})`);

      /* Close existing connection for this account (only one relay per account). */
      const prev = relayClients.get(accountId);
      if (prev && prev.readyState === WebSocket.OPEN) prev.close(4000, "replaced");

      relayClients.set(accountId, ws);

      /* Tell the client its public MCP URL. */
      ws.send(JSON.stringify({
        type: "relay-ready",
        mcpUrl: `/mcp/${accountId}`,
      }));

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "mcp-response" && msg.id && pendingRelay.has(msg.id)) {
            pendingRelay.get(msg.id).resolve(msg);
          }
        } catch (err) {
          console.error("[relay] bad message:", err.message);
        }
      });

      ws.on("close", () => {
        if (relayClients.get(accountId) === ws) {
          relayClients.delete(accountId);
          console.log(`[relay] device ${found.device.name} disconnected`);

          /* Fail pending relay requests for THIS account so HTTP callers
             get an immediate error instead of waiting for the 120s timeout. */
          for (const [rid, entry] of pendingRelay) {
            if (entry.accountId !== accountId) continue;
            entry.resolve({
              status: 502,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ error: "device_disconnected", detail: "The user's Doppel went offline." }),
            });
          }
        }
      });

      ws.on("error", (err) => console.error("[relay] ws error:", err.message));
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[doppel-id] listening on http://${HOST}:${PORT}`);
    console.log(`[doppel-id] identity stored in ${DATA_DIR}`);
    console.log(`[doppel-id] MCP relay available at /mcp/:accountId`);
    if (!EMAIL_CONFIGURED) {
      console.log("[doppel-id] no mail provider — sign-in links are printed here");
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    store.flush();
    server.close(() => process.exit(0));
  });
}

if (require.main === module) start();

module.exports = { server, start, PORT, HOST, DATA_DIR };
