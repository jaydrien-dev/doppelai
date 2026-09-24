const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Identity storage.
 *
 * Accounts, devices and sessions — and deliberately nothing else. The account
 * holds who you are and which machines are yours; the substance of your trained
 * agent never leaves the machine it was trained on. That split is the product's
 * central claim, so it is enforced here by simply having nowhere to put it.
 *
 * JSON with atomic writes rather than a database: at this size it is faster to
 * reason about, has no native dependency, and the whole store is one readable
 * file a person can inspect or delete. Swap in SQLite when concurrency demands
 * it, not before.
 */

const DAY = 86_400_000;
const SESSION_LIFE = 30 * DAY;
const LINK_LIFE = 15 * 60_000;

let file = null;
let data = null;
let writeTimer = null;

const empty = () => ({
  version: 1,
  accounts: [],
  devices: [],
  sessions: [],
  links: [],
  oauthTokens: [],
  oauthClients: [],
});

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, "identity.json");
  try {
    data = { ...empty(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    data = empty();
  }
  prune();
  return data;
}

function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error("[doppel-id] could not save:", err.message);
    }
  }, 150);
}

function flush() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.error("[doppel-id] could not save:", err.message);
  }
}

/* ------------------------------------------------------------------ crypto */

const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const token = () => crypto.randomBytes(32).toString("base64url");
/** Tokens are stored only as digests, so a stolen store yields no live sessions. */
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash: derived };
}

function passwordMatches(password, salt, hash) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return candidate.length === known.length && crypto.timingSafeEqual(candidate, known);
}

/* ---------------------------------------------------------------- accounts */

const normaliseEmail = (email) => String(email ?? "").trim().toLowerCase();

function accountByEmail(email) {
  const wanted = normaliseEmail(email);
  return data.accounts.find((a) => a.email === wanted) ?? null;
}

function createAccount(email) {
  const normalized = normaliseEmail(email);
  /* Deterministic ID: same email always gets the same account ID.
     This keeps the MCP relay URL stable even if the account is recreated. */
  const stableId = `acct_${crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
  const account = {
    id: stableId,
    email: normalized,
    createdAt: Date.now(),
    password: null,
  };
  data.accounts.push(account);
  save();
  return account;
}

function setPassword(accountId, password) {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return false;
  account.password = hashPassword(password);
  save();
  return true;
}

/* ----------------------------------------------------------------- links */

/**
 * A single-use sign-in link. Short-lived, and consumed on first use so a link
 * sitting in an inbox cannot be replayed.
 */
function createLink(email) {
  const raw = token();
  data.links.push({
    tokenHash: digest(raw),
    email: normaliseEmail(email),
    createdAt: Date.now(),
    expiresAt: Date.now() + LINK_LIFE,
    usedAt: null,
  });
  save();
  return raw;
}

function consumeLink(raw) {
  const hash = digest(raw);
  const link = data.links.find((l) => l.tokenHash === hash);
  if (!link) return { ok: false, reason: "unknown" };
  if (link.usedAt) return { ok: false, reason: "used" };
  if (Date.now() > link.expiresAt) return { ok: false, reason: "expired" };
  link.usedAt = Date.now();
  save();
  return { ok: true, email: link.email };
}

/* ---------------------------------------------------------------- devices */

/**
 * Pairing, not just logging in.
 *
 * A device is a durable member of the account with its own name and its own
 * revocation. Revoking it kills its sessions immediately — that is what makes
 * "revoke from another device" mean something.
 */
function pairDevice(accountId, { name, kind, platform }) {
  const device = {
    id: id("dev"),
    accountId,
    name: String(name ?? "A device").slice(0, 60),
    kind: ["desk", "phone", "other"].includes(kind) ? kind : "other",
    platform: String(platform ?? "").slice(0, 40),
    pairedAt: Date.now(),
    lastSeenAt: Date.now(),
    revokedAt: null,
  };
  data.devices.push(device);
  save();
  return device;
}

function devicesFor(accountId) {
  return data.devices.filter((d) => d.accountId === accountId && !d.revokedAt);
}

function revokeDevice(accountId, deviceId) {
  const device = data.devices.find((d) => d.id === deviceId && d.accountId === accountId);
  if (!device || device.revokedAt) return { ok: false, reason: "unknown" };
  device.revokedAt = Date.now();
  /* The point of revocation is that it takes effect now, not at next expiry. */
  for (const session of data.sessions) {
    if (session.deviceId === deviceId) session.revokedAt = Date.now();
  }
  save();
  return { ok: true, device };
}

/* --------------------------------------------------------------- sessions */

function createSession(accountId, deviceId) {
  const raw = token();
  const session = {
    id: id("sess"),
    accountId,
    deviceId,
    tokenHash: digest(raw),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + SESSION_LIFE,
    revokedAt: null,
  };
  data.sessions.push(session);
  save();
  return { session, token: raw };
}

/** Resolve a bearer token to a live session, touching its last-seen time. */
function authenticate(raw) {
  if (!raw) return null;
  const hash = digest(raw);
  const session = data.sessions.find((s) => s.tokenHash === hash);
  if (!session || session.revokedAt) return null;
  if (Date.now() > session.expiresAt) return null;

  const device = data.devices.find((d) => d.id === session.deviceId);
  if (!device || device.revokedAt) return null;

  const account = data.accounts.find((a) => a.id === session.accountId);
  if (!account) return null;

  session.lastSeenAt = Date.now();
  device.lastSeenAt = Date.now();
  /* Sliding expiry: a machine in daily use never gets logged out mid-task. */
  session.expiresAt = Date.now() + SESSION_LIFE;
  save();

  return { session, device, account };
}

function sessionsFor(accountId) {
  return data.sessions.filter((s) => s.accountId === accountId && !s.revokedAt && Date.now() < s.expiresAt);
}

/** Sign out everywhere, optionally sparing the device asking. */
function revokeAllSessions(accountId, { exceptDeviceId = null, onlyDeviceId = null } = {}) {
  let count = 0;
  for (const session of data.sessions) {
    if (session.accountId !== accountId || session.revokedAt) continue;
    if (exceptDeviceId && session.deviceId === exceptDeviceId) continue;
    if (onlyDeviceId && session.deviceId !== onlyDeviceId) continue;
    session.revokedAt = Date.now();
    count += 1;
  }
  save();
  return count;
}

/* ------------------------------------------------------- export & deletion */

/** Everything held about an account, in one readable object. */
function exportAccount(accountId) {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  return {
    exportedAt: new Date().toISOString(),
    note:
      "This is everything the Doppel account holds. It is identity and device " +
      "records only — your trained agent lives on your own machines and is " +
      "exported separately from the app.",
    account: { id: account.id, email: account.email, createdAt: account.createdAt },
    devices: data.devices
      .filter((d) => d.accountId === accountId)
      .map(({ accountId: _a, ...rest }) => rest),
    sessions: data.sessions
      .filter((s) => s.accountId === accountId)
      .map(({ tokenHash: _t, accountId: _a, ...rest }) => rest),
  };
}

/** Deletion that actually deletes. No tombstone, no grace period, no recovery. */
function deleteAccount(accountId) {
  const before = data.accounts.length;
  data.accounts = data.accounts.filter((a) => a.id !== accountId);
  data.devices = data.devices.filter((d) => d.accountId !== accountId);
  data.sessions = data.sessions.filter((s) => s.accountId !== accountId);
  flush();
  return data.accounts.length < before;
}

/* -------------------------------------------------------------- OAuth tokens */

const OAUTH_TOKEN_LIFE = 90 * 24 * 60 * 60_000; // 90 days — MCP connectors should stay connected

function createOAuthToken(tokenHash, clientId, accountId) {
  const entry = {
    tokenHash,
    clientId,
    accountId,
    createdAt: Date.now(),
    expiresAt: Date.now() + OAUTH_TOKEN_LIFE,
  };
  data.oauthTokens.push(entry);
  save();
  return entry;
}

function findOAuthToken(tokenHash) {
  const entry = data.oauthTokens.find((t) => t.tokenHash === tokenHash);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

/* -------------------------------------------------------- OAuth clients -- */

function saveOAuthClient(clientId, clientData) {
  if (!data.oauthClients) data.oauthClients = [];
  const existing = data.oauthClients.findIndex((c) => c.clientId === clientId);
  const entry = { clientId, ...clientData, savedAt: Date.now() };
  if (existing >= 0) {
    data.oauthClients[existing] = entry;
  } else {
    data.oauthClients.push(entry);
  }
  save();
  return entry;
}

function findOAuthClient(clientId) {
  if (!data.oauthClients) return null;
  return data.oauthClients.find((c) => c.clientId === clientId) ?? null;
}

function allOAuthClients() {
  return data.oauthClients ?? [];
}

/* --------------------------------------------------------------------------- */

/** Drop what has aged out. Nothing here is worth keeping past its life. */
function prune() {
  const now = Date.now();
  data.links = data.links.filter((l) => now < l.expiresAt && !l.usedAt);
  data.sessions = data.sessions.filter((s) => now < s.expiresAt);
  data.oauthTokens = (data.oauthTokens ?? []).filter((t) => now < t.expiresAt);
  save();
}

module.exports = {
  init,
  flush,
  prune,
  accountByEmail,
  createAccount,
  setPassword,
  passwordMatches,
  createLink,
  consumeLink,
  pairDevice,
  devicesFor,
  revokeDevice,
  createSession,
  authenticate,
  sessionsFor,
  revokeAllSessions,
  exportAccount,
  deleteAccount,
  normaliseEmail,
  createOAuthToken,
  findOAuthToken,
  saveOAuthClient,
  findOAuthClient,
  allOAuthClients,
  digest,
  SESSION_LIFE,
  LINK_LIFE,
  _data: () => data,
};
