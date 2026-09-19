const os = require("node:os");

const db = require("./db");

/**
 * The account, from the machine's side.
 *
 * Stage 0 of the roadmap: this is not a login gate, it is the container for
 * something the user owns. So the posture is deliberate — the account holds
 * identity and which machines are yours, and the trained agent stays here, on
 * disk, in the brain. Signing out does not take it away; deleting the account
 * does not reach into it.
 *
 * The session token lives in this machine's own application data alongside the
 * API key. It is never handed to the interface.
 */

const DEFAULT_SERVER = "http://127.0.0.1:4319";

const base = () => (db.get().account?.server || DEFAULT_SERVER).replace(/\/$/, "");
const tokenOf = () => db.get().account?.token ?? "";

const deviceIdentity = () => ({
  deviceName: db.get().account?.deviceName || os.hostname() || "This machine",
  deviceKind: "desk",
  platform: `${os.platform()} ${os.release()}`,
});

/* --------------------------------------------------------------------------- */

async function call(pathname, { method = "GET", body, auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth && tokenOf()) headers.authorization = `Bearer ${tokenOf()}`;

  let response;
  try {
    response = await fetch(`${base()}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: "unreachable",
      detail:
        err?.name === "TimeoutError"
          ? "The account server didn't answer."
          : "I couldn't reach the account server.",
    };
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    /* an empty or non-JSON body */
  }

  /* A revoked device is told once, clearly, and forgets its credentials —
     the whole point of revocation is that it takes effect here. */
  if (response.status === 401 && auth) {
    signOutLocally("Your access from this machine was revoked.");
    return { ok: false, error: "signed_out", detail: "This machine is no longer signed in." };
  }

  if (!response.ok) {
    return { ok: false, error: payload.error ?? `http_${response.status}`, detail: payload.detail };
  }

  return { ok: true, ...payload };
}

/* --------------------------------------------------------------- signing in */

/** Ask for a sign-in link. */
async function requestLink(email) {
  const result = await call("/v1/auth/link", {
    method: "POST",
    body: { email },
    auth: false,
  });
  if (result.ok) {
    db.update((s) => {
      s.account.pendingEmail = String(email ?? "").trim().toLowerCase();
    });
  }
  return result;
}

/** Redeem a link. Pairs this machine as a named device in the same step. */
async function verifyLink(token) {
  const result = await call("/v1/auth/verify", {
    method: "POST",
    body: { token, ...deviceIdentity() },
    auth: false,
  });
  if (result.ok) adopt(result);
  return result;
}

async function signInWithPassword(email, password) {
  const result = await call("/v1/auth/password", {
    method: "POST",
    body: { email, password, ...deviceIdentity() },
    auth: false,
  });
  if (result.ok) adopt(result);
  return result;
}

const setPassword = (password) =>
  call("/v1/auth/password/set", { method: "POST", body: { password } });

function adopt({ token, account, device }) {
  db.update((s) => {
    s.account.token = token;
    s.account.email = account.email;
    s.account.accountId = account.id;
    s.account.deviceId = device.id;
    s.account.deviceName = device.name;
    s.account.pairedAt = device.pairedAt;
    s.account.pendingEmail = null;
    s.account.lastError = null;
  });
}

/* -------------------------------------------------------------- the account */

async function overview() {
  if (!tokenOf()) return { ok: false, error: "signed_out" };
  return call("/v1/account");
}

const revokeDevice = (deviceId) =>
  call(`/v1/devices/${encodeURIComponent(deviceId)}/revoke`, { method: "POST" });

const signOutEverywhere = (keepThisDevice) =>
  call("/v1/auth/signout-all", { method: "POST", body: { keepThisDevice } });

const exportAccount = () => call("/v1/account/export");

async function deleteAccount() {
  const result = await call("/v1/account", { method: "DELETE" });
  if (result.ok) signOutLocally(null);
  return result;
}

/**
 * Sign out this machine.
 *
 * Only the credentials go. Routines, memories and the brain are untouched —
 * they were never the server's to hold, and this is where that claim either
 * holds or doesn't.
 */
function signOutLocally(reason) {
  db.update((s) => {
    s.account.token = "";
    s.account.accountId = null;
    s.account.deviceId = null;
    s.account.pendingEmail = null;
    s.account.lastError = reason;
  });
}

async function signOut() {
  signOutLocally(null);
  return { ok: true };
}

function setServer(url) {
  db.update((s) => {
    s.account.server = String(url ?? "").trim() || DEFAULT_SERVER;
  });
  return { ok: true, server: base() };
}

function renameDevice(name) {
  db.update((s) => {
    s.account.deviceName = String(name ?? "").slice(0, 60) || os.hostname();
  });
  return { ok: true };
}

/** A quiet keep-alive so "last seen" on the account home means something. */
let beat = null;
function startHeartbeat() {
  if (beat) clearInterval(beat);
  beat = setInterval(() => {
    if (tokenOf()) call("/v1/heartbeat", { method: "POST" }).catch(() => {});
  }, 5 * 60_000);
}

function stopHeartbeat() {
  if (beat) clearInterval(beat);
  beat = null;
}

/* -------------------------------------------------------------- billing */

async function createCheckout(priceId) {
  return call("/v1/billing/checkout", { method: "POST", body: { priceId } });
}

async function verifyCheckout(sessionId) {
  return call("/v1/billing/verify", { method: "POST", body: { sessionId } });
}

module.exports = {
  requestLink,
  verifyLink,
  signInWithPassword,
  setPassword,
  overview,
  revokeDevice,
  signOutEverywhere,
  exportAccount,
  deleteAccount,
  signOut,
  setServer,
  renameDevice,
  startHeartbeat,
  stopHeartbeat,
  createCheckout,
  verifyCheckout,
  DEFAULT_SERVER,
};
