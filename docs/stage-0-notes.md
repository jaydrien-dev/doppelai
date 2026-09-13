# Stage 0 — Accounts & Identity

Built, tested, ready for review. **40 identity tests + 88 core tests pass.**

---

## What was built

**A self-hosted identity server** (`server/`). Node's own `http`, no framework, no
identity vendor. JSON storage with atomic writes.

- Passwordless email link as the primary path — single-use, 15-minute life,
  consumed on redemption so a link sitting in an inbox can't be replayed.
- Email + password as the fallback. scrypt, per-account salt, and an unknown
  address returns the identical error to a wrong password.
- Sessions as bearer tokens, stored **only as SHA-256 digests** — a stolen
  store yields no live sessions. 30-day sliding expiry so a machine in daily
  use is never signed out mid-task.
- **Device pairing, not just login.** Pairing happens in the same step as
  sign-in; each machine is a named, durable member of the account with its own
  revocation.
- Cross-device revoke, which kills that device's sessions immediately rather
  than at next expiry. Another account cannot touch your devices.
- Sign out everywhere, optionally sparing the machine asking.
- Export, and deletion that actually deletes — no tombstone, no grace period.

**In the app**: `electron/core/account.js` holds the session token in this
machine's application data (never crossing to the renderer), plus a heartbeat so
"last seen" means something. `/account` follows the locked design system —
devices are `.raised` cards, the current machine carries the pulse, revoke is
always two steps.

---

## Decisions I made that you should overrule if you disagree

**1. Our own server rather than Clerk/Auth0/Supabase.**
Stage 0 forces the first backend — device pairing and cross-device revoke cannot
work without one. I chose to build it rather than buy it, on your own stated
principle: *the incumbents monetise by owning the model of you; this product's
architecture is the user owning it*, and when in doubt prefer more ownership and
an easier exit. Renting identity from a vendor contradicts that at the exact
layer where the claim has to hold.

Cost: it's ours to run and secure. Buying would have been faster and is a
defensible call for a seed-stage company. Say so and I'll swap it.

**2. JSON storage, not SQLite.**
Zero native dependencies, one readable file a person can inspect or delete,
trivially correct at this size. It will need SQLite under concurrent load —
the store is a single module, so that's a contained change.

**3. Nothing is emailing the links.**
No mail provider is configured, so the server prints the link and the app shows
it with an explicit note saying nothing is sending it yet. Rather than fake it.
Wiring Postmark/Resend is roughly an hour whenever you want other people
signing in.

**4. The server is not deployed.**
It runs on `127.0.0.1:4319` via `npm run server`. Fine for you as the demo; a
second physical device needs it reachable (LAN bind or a host). That's a
hosting decision I didn't want to make for you.

---

## Deliberately deferred

- Social login, teams, billing, profiles — explicitly out of scope per the
  roadmap.
- Rate limiting on the auth endpoints. Needed before public exposure, pointless
  on localhost.
- Device rename from the account screen (the plumbing exists; no UI yet).
- Sync. The account holds identity only. Stage 1's Export/Import Self is what
  moves an agent between machines, and it should stay a deliberate act rather
  than becoming silent cloud sync — that would quietly relocate the trained self
  to a server and undercut the whole thesis.

---

## Something Stage 0 does not fix, before Stage 1

You said you'll be the demo yourself. The sharpest gap right now isn't accounts
— it's **cold start**. A fresh install knows nothing and needs hours of watching
before it has anything to show, and the seeded routines were deleted when the
mock came out. The first ten minutes of the demo are currently empty.

Vision partly rescues this: it narrates what you're doing within about a minute,
and your screenshot showed it reading the Claude Code panel accurately. That is
the demo. But there's no first-run flow that puts it in front of you.

Worth considering for Stage 1 alongside The Self: an onboarding that turns the
key on, picks folders, takes the first look, and shows something real inside two
minutes. I haven't built it — it isn't Stage 0, and you asked to review between
stages.

---

## Verify it yourself

```
npm run server          # terminal one
npm run app             # terminal two — Account in the nav
npm run test:identity   # 40 tests
```

Pair a second machine by running the app with a different `DOPPEL_STATE_DIR`, or
just trust the tests — they pair two devices, revoke one from the other, and
assert the revoked one is signed out immediately.
