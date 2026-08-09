const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const store = require("./store");

/**
 * Mimic's identity server.
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

const PORT = Number(process.env.MIMIC_SERVER_PORT ?? 4319);
const HOST = process.env.MIMIC_SERVER_HOST ?? "127.0.0.1";
const DATA_DIR =
  process.env.MIMIC_SERVER_DATA ?? path.join(os.homedir(), ".mimic-identity");

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
    console.log(`\n[mimic-id] sign-in link for ${store.normaliseEmail(email)}:\n  ${link}\n`);

    return json(res, 200, {
      sent: true,
      emailConfigured: EMAIL_CONFIGURED,
      /* Shown only while no mail provider is configured. */
      link: EMAIL_CONFIGURED ? undefined : link,
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

/* --------------------------------------------------------------- the server */

const server = http.createServer(async (req, res) => {
  /* The desktop app is not a browser origin, but the Pocket surface may be. */
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const key = `${req.method} ${url.pathname}`;

  try {
    if (url.pathname === "/v1/health") return json(res, 200, { ok: true, service: "mimic-identity" });

    const revoke = url.pathname.match(/^\/v1\/devices\/([\w-]+)\/revoke$/);
    if (revoke && req.method === "POST") return await revokeDeviceRoute(req, res, revoke[1]);

    const handler = routes[key];
    if (!handler) return json(res, 404, { error: "no_such_route" });

    return await handler(req, res);
  } catch (err) {
    console.error("[mimic-id]", err);
    return json(res, 400, { error: "bad_request", detail: err.message });
  }
});

function start() {
  store.init(DATA_DIR);
  setInterval(() => store.prune(), 60 * 60_000);

  server.listen(PORT, HOST, () => {
    console.log(`[mimic-id] listening on http://${HOST}:${PORT}`);
    console.log(`[mimic-id] identity stored in ${DATA_DIR}`);
    if (!EMAIL_CONFIGURED) {
      console.log("[mimic-id] no mail provider — sign-in links are printed here");
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
