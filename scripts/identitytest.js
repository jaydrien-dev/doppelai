#!/usr/bin/env node
/**
 * Exercises the identity server against a real HTTP listener.
 *
 * Stage 0's whole job is that a person can pair two machines, cut one off from
 * the other, take their data with them, and leave properly. Those are security
 * properties, so they are tested against the running server rather than the
 * store in isolation.
 *
 *   node scripts/identitytest.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DATA = path.join(os.tmpdir(), "mimic-identity-test");
const PORT = 4399;

process.env.MIMIC_SERVER_DATA = DATA;
process.env.MIMIC_SERVER_PORT = String(PORT);
process.env.MIMIC_SERVER_HOST = "127.0.0.1";

fs.rmSync(DATA, { recursive: true, force: true });

const store = require("../server/store");
const { server } = require("../server/index");

let passed = 0;
let failed = 0;

const check = (label, condition, extra = "") => {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

const section = (title) => console.log(`\n${title}`);

const base = `http://127.0.0.1:${PORT}`;

async function call(pathname, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    /* empty body */
  }
  return { status: response.status, ...payload };
}

/** Sign in a fresh machine, all the way through the link flow. */
async function pair(email, deviceName) {
  const asked = await call("/v1/auth/link", { method: "POST", body: { email } });
  return call("/v1/auth/verify", {
    method: "POST",
    body: { token: asked.link, deviceName, deviceKind: "desk", platform: "test" },
  });
}

async function main() {
  store.init(DATA);
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  /* ------------------------------------------------------- 1. signing in --- */

  section("Signing in");

  const health = await call("/v1/health");
  check("the server is up", health.ok === true);

  const bad = await call("/v1/auth/link", { method: "POST", body: { email: "nonsense" } });
  check("a malformed address is refused", bad.status === 400, String(bad.status));

  const asked = await call("/v1/auth/link", {
    method: "POST",
    body: { email: "Demo@Example.com " },
  });
  check("a link is issued", Boolean(asked.link));
  check("and the app is told nothing is emailing it yet", asked.emailConfigured === false);

  const laptop = await call("/v1/auth/verify", {
    method: "POST",
    body: { token: asked.link, deviceName: "Laptop", deviceKind: "desk", platform: "test" },
  });
  check("redeeming it signs you in", Boolean(laptop.token), JSON.stringify(laptop));
  check("the address is normalised", laptop.account.email === "demo@example.com", laptop.account.email);
  check("and the machine is paired in the same step", laptop.device.name === "Laptop");

  const replay = await call("/v1/auth/verify", {
    method: "POST",
    body: { token: asked.link, deviceName: "Thief", deviceKind: "desk" },
  });
  check("a link cannot be used twice", replay.status === 400 && replay.error === "link_used",
    JSON.stringify(replay));

  const forged = await call("/v1/auth/verify", {
    method: "POST",
    body: { token: "not-a-real-token", deviceName: "Thief" },
  });
  check("an invented link is refused", forged.status === 400);

  check(
    "no session token is stored in the clear",
    !JSON.stringify(store._data().sessions).includes(laptop.token),
  );

  /* -------------------------------------------------------- 2. the guard --- */

  section("Guarding the account");

  const anonymous = await call("/v1/account");
  check("no token means no account", anonymous.status === 401);

  const wrongToken = await call("/v1/account", { token: "wrong" });
  check("a wrong token means no account", wrongToken.status === 401);

  const mine = await call("/v1/account", { token: laptop.token });
  check("the right token returns the account", mine.account.email === "demo@example.com");
  check("with this machine marked as current", mine.devices[0].current === true);

  /* ------------------------------------------------------ 3. two machines --- */

  section("Pairing a second machine and cutting it off");

  const phone = await pair("demo@example.com", "Phone");
  check("a second machine pairs to the same account",
    phone.account.id === laptop.account.id, `${phone.account.id} vs ${laptop.account.id}`);

  const both = await call("/v1/account", { token: laptop.token });
  check("both machines are listed", both.devices.length === 2, String(both.devices.length));

  /* The load-bearing one: revoke the phone *from the laptop*. */
  const cut = await call(`/v1/devices/${phone.device.id}/revoke`, {
    method: "POST",
    token: laptop.token,
  });
  check("one machine can cut off another", cut.ok === true, JSON.stringify(cut));

  const phoneAfter = await call("/v1/account", { token: phone.token });
  check("the cut-off machine is signed out at once", phoneAfter.status === 401,
    String(phoneAfter.status));

  const laptopAfter = await call("/v1/account", { token: laptop.token });
  check("and the one that did the cutting is untouched", laptopAfter.status !== 401);
  check("with only itself left", laptopAfter.devices.length === 1, String(laptopAfter.devices.length));

  const strangerLaptop = await pair("someone@else.com", "Stranger");
  const trespass = await call(`/v1/devices/${laptopAfter.devices[0].id}/revoke`, {
    method: "POST",
    token: strangerLaptop.token,
  });
  check("another account cannot revoke your machines", trespass.status === 404,
    String(trespass.status));

  /* ------------------------------------------------- 4. sign out everywhere --- */

  section("Signing out everywhere");

  const tablet = await pair("demo@example.com", "Tablet");
  const desktop = await pair("demo@example.com", "Desktop");

  const swept = await call("/v1/auth/signout-all", {
    method: "POST",
    body: { keepThisDevice: true },
    token: tablet.token,
  });
  check("the others are signed out", swept.revoked >= 2, String(swept.revoked));
  check("the machine asking stays signed in",
    (await call("/v1/account", { token: tablet.token })).status !== 401);
  check("the others really are out",
    (await call("/v1/account", { token: desktop.token })).status === 401);

  /* --------------------------------------------------- 5. leaving properly --- */

  section("Leaving");

  const exported = await call("/v1/account/export", { token: tablet.token });
  check("the account exports", exported.account.email === "demo@example.com");
  check("with its devices", Array.isArray(exported.devices) && exported.devices.length > 0);
  check("and no session tokens in it", !JSON.stringify(exported).includes("tokenHash"));
  check("and it says where the trained self actually lives",
    exported.note.includes("own machines"), exported.note);

  const removed = await call("/v1/account", { method: "DELETE", token: tablet.token });
  check("deletion reports success", removed.deleted === true);
  check("the session dies with it",
    (await call("/v1/account", { token: tablet.token })).status === 401);

  const data = store._data();
  check("no account record survives",
    !data.accounts.some((a) => a.email === "demo@example.com"));
  check("no device record survives",
    !data.devices.some((d) => d.accountId === tablet.account.id));
  check("no session record survives",
    !data.sessions.some((s) => s.accountId === tablet.account.id));
  check("and the other account is untouched",
    data.accounts.some((a) => a.email === "someone@else.com"));

  /* --------------------------------------------------------- 6. passwords --- */

  section("Passwords, for anyone who wants one");

  const short = await call("/v1/auth/password/set", {
    method: "POST",
    body: { password: "short" },
    token: strangerLaptop.token,
  });
  check("a short password is refused", short.status === 400, String(short.status));

  const set = await call("/v1/auth/password/set", {
    method: "POST",
    body: { password: "a-long-enough-password" },
    token: strangerLaptop.token,
  });
  check("a long one is accepted", set.ok === true);

  const wrong = await call("/v1/auth/password", {
    method: "POST",
    body: { email: "someone@else.com", password: "not-the-password", deviceName: "X" },
  });
  check("the wrong password is refused", wrong.status === 401);

  const right = await call("/v1/auth/password", {
    method: "POST",
    body: { email: "someone@else.com", password: "a-long-enough-password", deviceName: "Second" },
  });
  check("the right one signs in", Boolean(right.token));
  check("no password is stored in the clear",
    !JSON.stringify(store._data().accounts).includes("a-long-enough-password"));

  const unknown = await call("/v1/auth/password", {
    method: "POST",
    body: { email: "nobody@nowhere.com", password: "whatever-at-all", deviceName: "X" },
  });
  check("an unknown account gives the same answer as a wrong password",
    unknown.status === 401 && unknown.error === wrong.error);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
