# Mimic — Staged Build Roadmap

> **Read this file in full before writing any code.** It defines the strategic direction and the order of work.
> It sits on top of `mimic-claude-code-prompt-v2.md`, which remains the authority for the product's core behaviour and for the **locked design system**. Nothing in this file overrides the design system.
>
> Work through **Stage 0 → 1 → 2 → 3 → 4 in order.** Do not begin a stage until the previous one is complete and I have reviewed it. Stop and show me your work at the end of every stage.

---

## THE THESIS (read once, keep in mind throughout)

Automation tools that "save time" have a ceiling. Mimic escapes it through four reframings, each of which changes what business the product is in. Each stage is only credible because the previous one is real — a marketplace without a trust ladder is a malware store; representation without ownership is just another platform owning the user.

1. **Ownership** — you own a trained copy of your working self.
2. **Protocol** — Mimic is the trust mechanism by which any agent earns authority.
3. **Economy** — trained competence becomes a tradable good.
4. **Representation** — your agent is how other agents reach you.

The through-line that makes all of it defensible: **the incumbents monetise by owning the model of you; this product's entire architecture is the user owning it.** Every design decision must stay consistent with that. When in doubt, choose the option that gives the user more ownership, more legibility, and an easier exit.

---

# STAGE 0 — ACCOUNTS & IDENTITY (build this first)

Nothing else works without an account, because from Stage 1 onward the user *owns* something. Accounts are not a login gate here — they are the container for a personal asset.

**Build:**

- **Email + password authentication** with proper session handling, plus passwordless email link as the primary path (fewer passwords is on-brand for a trust product). Use a standard library rather than rolling your own; keep the surface small.
- **Device pairing, not just login.** A user's machines and phone are *paired devices* on the account, each named, each listed, each individually revocable from any other device. This is the foundation of the Pocket custody model in v2 §8 — build it properly now.
- **Account home** showing: paired devices, active sessions, last activity per device, and a prominent revoke control.
- **Sign-out everywhere** and session expiry.
- **Account deletion that actually deletes**, with a plain-language explanation of what is removed and an export offered first. Never dark-pattern the exit.
- **A local-first data posture, stated in the UI.** The account holds identity and sync metadata; the trained agent's substance lives on the user's machine. Say this plainly in the account screen — it is a product claim, not fine print.

**Design:** the account area follows the locked neumorphic system exactly. Calm, airy, no dense settings tables. Device entries are `.raised` cards; the active device carries the pulse. Revocation is a deliberate two-step action, never a stray click.

**Do not build:** social login, teams, billing, or profiles. Not yet.

**Done when:** a user can register, pair two devices, see them both, revoke one from the other, export their data, and delete their account.

---

# STAGE 1 — OWNERSHIP: "a trained copy of your working self"

**The reframe:** the product stops being labour-saving and becomes asset-building. Every correction, routine, entity, and judgment threshold is equity in a second self that compounds. This is what beats a free OS-bundled agent: anyone can give the user *an* agent; nobody else can give them *theirs*, five years trained.

**Build:**

- **The Self.** The user's entire trained agent — intent models, corrections, entities, judgment thresholds, hard rules, run history — represented as one coherent, named, portable object. Give it a real screen: what it knows, when it learned each thing, how it has changed. Ownership must be literal and visible, not rhetorical.
- **Export the Self** as a single encrypted file the user can download and keep. One click, no friction, no retention flow. Make leaving easy; that is how you earn trust.
- **Import the Self** on any machine the user logs into, restoring the agent exactly. Switching laptops must not cost the user their agent.
- **Ledger reframed from time to accrual.** Keep the weekly receipt from v2, but add the ownership view: *"Your Self can now do 34 things"*, what it learned this month, how its judgment has sharpened. Concrete counts, never vague praise.
- **The annual résumé** — a generated, shareable summary of what the user's agent learned and did over a year. This is both the retention moment and the product's best organic marketing.
- **Provenance on everything.** Every capability traces back to when and how it was learned, and every correction is attributed to the moment the user taught it. The user should be able to point at any behaviour and see their own fingerprint on it.

**Additional features required at this stage:**

- **Forgetting.** Ownership without deletion is not ownership. Any routine, entity, correction, or memory is individually deletable, and the Self visibly changes when it is. Include a "forget everything about X" action for a person, client, or project.
- **Succession.** The user designates who receives specified routines if they stop using the product — passing "how I handle the family finances" to a child, or a freelancer's workflows to a successor. Unusual for a productivity app; it is precisely what makes ownership emotionally undeniable.
- **Self diff.** A simple view of how the agent changed over a chosen period — capabilities gained, judgment adjusted, things forgotten.

**Done when:** a user can export their Self, wipe local state, import it on a "different machine", and find their agent identically trained — and can point at any single behaviour and see when they taught it.

---

# STAGE 2 — PROTOCOL: "the trust mechanism for delegation"

**The reframe:** the trust ladder is not a feature of this product, it is a general mechanism by which *any* agent earns authority incrementally. Nobody owns the standard for how humans safely grant machines power. Owning it makes the company infrastructure rather than an app.

**Build:**

- **Extract the ladder into a documented, versioned spec** — a real document in the repo (`/spec/trust-ladder.md`) defining the stages, the graduation criteria, corrections-as-training, the second graduation for unattended work, hard rules on irreversible actions, and the quarantine rule for imported capability. Write it as a standard others could implement, not as internal notes.
- **Foreign agents under supervision.** Allow a third-party agent or tool to be registered and to operate *under Mimic's ladder* — entering at the bottom, proving itself through supervised runs, subject to the same hard rules and the same clean-stop failure protocol. Prototype this with one or two mock foreign agents.
- **The trust passport.** A signed, verifiable record of what a given agent (Mimic's own routines or a foreign agent) has proven: autonomy level reached, clean-run count, correction history, failure history. Viewable, exportable, and requestable by third parties.
- **The universal ledger.** One audit trail covering everything any agent did on the user's behalf, regardless of who built it. Same reasoning expansion and same rollback affordances as v2 §6.
- **Delegation primitives, exposed.** Spend caps, action scopes, session ceilings, and expiring authority as first-class objects that any registered agent must route through — with a single screen where the user sees every grant of authority currently outstanding and can revoke any of it instantly.

**Additional features required at this stage:**

- **Revocation propagation.** Revoking authority must halt in-flight work, roll back what is reversible, and report plainly what could not be undone.
- **Incident record.** Every failure, near-miss, and hard-rule stop is recorded and feeds the passport. An agent's honesty about its failures is what makes its trust score mean anything.

**Done when:** a mock third-party agent can be registered, climb the ladder, earn a passport, act under caps, and be revoked mid-run cleanly — with everything it did appearing in the same ledger as Mimic's own work.

---

# STAGE 3 — ECONOMY: "your agent earns you money"

**The reframe:** because routines store intent and re-bind to a new user's world, they are economic goods. A person who encodes their competence once can be paid for it indefinitely. The product becomes a market for encoded human competence, where supply is created by ordinary people watching themselves work — a network effect no OS vendor can bootstrap, because it requires neutrality.

**Build:**

- **The routine marketplace.** Publish a routine, browse, install. Every listing shows what the routine is *for* (intent, in plain language), not a script.
- **Clean-run rates as the rating system.** Because Mimic executes and audits, ratings are verifiable performance rather than opinion: install count, clean-run rate across users, median corrections needed before graduation. Star ratings are secondary to this.
- **Verified craft / provenance at install.** Who taught it, when, how many clean runs, correction history, and the quarantine notice — installed routines always begin at SUPERVISED regardless of their reputation (v2 §10, non-negotiable).
- **Revenue share and creator payouts**, with a clear, unsurprising split shown to creators before they publish.
- **Bounties.** A user posts "I'll pay for a routine that handles this portal"; demand summons supply. This solves the marketplace cold-start problem and should be built alongside listings, not after.
- **Re-binding transparency.** At install, show exactly what the routine needs from the user's world — which entities, which accounts, which permissions — and let them bind each one deliberately.

**Additional features required at this stage:**

- **Safety review before listing.** Automated inspection of a published routine's intent and required scopes, plus a hard block on routines whose intent requires credential exfiltration or acting against the installing user's interest. State the rules publicly.
- **Earnings view for creators** — installs, clean-run rate, income, and which corrections other users are commonly making (a signal to improve the routine).
- **Refund on failure** — if a purchased routine cannot graduate, the buyer is made whole automatically. Trust in the market is worth more than the revenue.

**Done when:** a user can publish a routine, another account can discover it, see honest provenance, install it into quarantine, bind it to their own world, prove it through supervised runs, and the creator sees the earning.

---

# STAGE 4 — REPRESENTATION: "your agent represents you to other agents"

**The reframe:** as more digital interaction becomes agent-to-agent, the durable position is being the entity other machines must deal with in order to deal with you — the successor to the phone number and the email address. This is the identity layer, and it is only reachable because Stages 1–3 established ownership, safety, and neutrality.

**Build:**

- **The agent inbox.** A reachable endpoint where other people's agents and institutional agents contact yours. Mimic triages, answers routine requests in the user's voice within taught bounds, and escalates anything else to Pocket as a needs-you card.
- **Machine-readable boundaries.** The user's availability, prices, standing preferences, and hard nos published as policy other agents can query without disturbing the human. Editable in plain language; the user always sees what is public.
- **Agent-to-agent negotiation.** Two agents settle a time, a split, or a dispute; both humans receive result cards showing what was proposed, conceded, and agreed, with the reasoning expandable and the outcome reversible within a window.
- **Advocacy against institutional agents.** When a company's agent makes an offer, the user's agent knows their history and pushes back on their behalf. Build one worked example end-to-end — this is the demo that explains the entire reframe in fifteen seconds.

**Additional features required at this stage:**

- **Impersonation defence.** Verifiable agent identity so a counterparty knows they are speaking to the real agent of the real person, and the user can see who claimed to be whom.
- **Negotiation mandates.** Before any agent-to-agent negotiation, the user sets the bounds — floor, ceiling, walk-away — and the agent cannot exceed them. Mandates expire.
- **Conversation record.** Full transcript of any agent-to-agent exchange, in plain language, permanently available to the human.
- **Deniability and silence.** The user can be unreachable. Boundaries include the right for the agent to decline to engage at all, and this must be as easy to set as any other preference.

**Done when:** two accounts' agents can negotiate a simple decision under mandates, both users receive result cards with full reasoning, either can reverse it within the window, and the whole exchange sits in the universal ledger.

---

## RULES THAT APPLY TO EVERY STAGE

- The **locked design system in `mimic-claude-code-prompt-v2.md` §14–15 is never modified**. New surfaces adopt it; they do not extend the palette or introduce borders.
- All agent-authored copy lives in `lib/voice.ts`. The voice — understated, first person, admits uncertainty, no exclamation marks, no emoji — applies to every new feature.
- **Nothing skips the trust ladder.** New capability, foreign agents, and installed routines all enter at the bottom.
- **Everything is reversible, and the exit is never hidden.** Export, revoke, forget, demote, delete — all reachable, all plain.
- Each stage ends with a short `/docs/stage-N-notes.md` recording what was built, what was deliberately deferred, and any decision you made that I should overrule if I disagree.

**Begin with Stage 0. Show me the account system before starting Stage 1.**
