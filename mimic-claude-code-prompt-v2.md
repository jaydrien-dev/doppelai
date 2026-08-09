# Claude Code Prompt — **Mimic v2**

> Supersedes v1. Paste everything below into Claude Code as the initial prompt.
> Codename only — the product name is not final.

---

Build a high-fidelity, interactive front-end prototype for **Mimic**: a personal trusted execution engine that lives on a desktop, learns tasks by watching, and — once trusted — runs them on its own, including while the user is away and dispatching from their phone.

**Stack:** Next.js (App Router) + TypeScript + Tailwind + Framer Motion. No backend, no auth, no database. All agent behaviour is simulated with mock data and a controllable fake clock so the entire product story is demoable in the browser. Prioritise the feel of the interface over architectural completeness.

**Two surfaces in one codebase:**
- **Desk** — the desktop app (primary, desktop-first layout).
- **Pocket** — the phone companion (a phone-framed viewport, reachable at `/pocket`, and rendered inside a device mockup when viewed on desktop so both can be demoed side by side).

---

## 1. WHAT MIMIC IS

Mimic watches how you work, learns the tasks you repeat, and takes them over — but only after it has proven itself under your supervision.

It is not a chatbot and not a macro recorder. There is no scripting and no setup wizard. The user never configures an automation; they simply work, and the work gradually stops being theirs.

Crucially, Mimic executes **locally, inside the user's own machine and their own logged-in sessions**. It needs no integrations and no permission from the services it operates. This is a core product truth and the UI should quietly reflect it (see Permissions and Away Mode).

**Emotional arc:** *curiosity → recognition → supervision → trust → relief → "it did that while I was out."*

---

## 2. INTENT, NOT STEPS (foundational — affects all copy and data)

Mimic does not store click sequences. It stores an **intent** — what the user was trying to accomplish — with observed steps as *evidence*. This must be visible in the interface: routines are described by goal and outcome, steps are shown as "how I've seen you do it," and when the world changes (a button moves, a layout differs) Mimic adapts and says so plainly.

Reflect this in the data model: a routine has `intent`, `successCriteria`, `observedPaths[]`, and `corrections[]` — not a flat step array. Steps rendered in the UI are derived from the current plan for *this* run, not a fixed recording.

---

## 3. THE TRUST LADDER (the product — get this exactly right)

Six stages. Stage is the most important piece of state in the app and must be legible at a glance.

**1 — LEARNING.** Mimic has spotted a repeated sequence and is still watching. Shows a **progress bar** of learning confidence (0–100%), advancing in visible jumps when a new observation lands, never ticking smoothly. Card states in humble, plain language what it thinks it's watching, how many times it's seen it, and what it's still unsure about.

**2 — READY.** At 100%, a single primary action: **"Let Mimic try it."** Expanding shows a plain-language playback of the learned intent, with Mimic stating honestly which parts it's confident about and which it's guessing at. Nothing runs without explicit consent.

**3 — SUPERVISED.** Mimic runs while the user watches, for a set number of proving runs (default 4, adjustable 3–5). See Run Theatre below. A **corrected run does not count** toward the total and must be re-proven; state this rule in the UI so graduation feels earned.

**4 — TRUSTED.** A deliberate, ceremonial **graduation moment** — the emotional peak. Mimic asks for autonomy in its own voice; the user grants it. Trusted routines run on command or on trigger while the user is present.

**5 — UNATTENDED (second graduation).** Trusted is not the same as trusted-while-you're-out. A routine only becomes eligible for unattended execution after several clean autonomous runs *with the user present*. This second graduation is separately requested and separately granted, and the UI must never conflate the two.

**Demotion** from any stage is one click and always visible, never buried. The whole ladder depends on feeling reversible.

---

## 4. TEACHING MODES (solves the cold start — build early)

**Passive observation** — the default; confidence accrues as Mimic watches.

**"Watch this"** — the user deliberately teaches. They hit *pay attention now*, do the task once, and narrate optionally. One or two deliberate demonstrations reach 100% where passive observation would need six. This is what makes the product useful on day one; give it a prominent, always-reachable control.

**Starter routines** — a small set of near-universal routines offered at install, pre-learned but still required to pass supervised runs like anything else.

---

## 5. RUN THEATRE (give this the most design attention)

A stepped, cinematic walkthrough of a supervised run.

- Steps render as a vertical timeline; the active step carries the agent's blue pulse.
- Execution is deliberately watchable (~1.2–2s per step), never instant.
- Persistent controls: **Pause**, **Step back**, **Correct this step**.
- **Correct this step** opens an inline panel to edit parameters, skip, or reorder. After a correction, Mimic acknowledges in its own voice ("Got it — I'll always check the date column first") and the correction visibly applies on subsequent runs.
- Mimic **pauses itself when genuinely unsure** and asks one specific question rather than guessing.
- When the plan diverges from what it has seen before, it says so inline ("the layout changed — I'm going by what this is for, not where the buttons were").
- Proving-run tracker always visible ("Run 2 of 4").
- Each run ends with a summary: what it did, what changed, time taken, corrections received.

---

## 6. WHEN THINGS GO WRONG (design this before you need it)

**Failure protocol.** Mimic never leaves work half-done. On failure it parks the routine, restores what state it can, and reports plainly what it completed and what it didn't, then asks. Build a dedicated "stopped cleanly" result state — calm, not alarming, clearly distinct from both success and error.

**Drift detection.** Routines rot. When success rate on a routine falls, Mimic flags it and asks to re-learn ("this hasn't gone cleanly twice — can I watch you do it once more?"), which sends it back to a short learning state without losing its corrections.

**Undo.** Anything Mimic did in the last 24 hours is listed and individually reversible, with one-click rollback. Reachable from the ledger and from any run summary.

**"Why did you do that?"** Every action in the ledger expands into reasoning and evidence: what it saw, what it inferred, which past correction it applied.

---

## 7. JUDGMENT & LIMITS

Mimic has a learned policy for ambiguous cases: **handle silently**, **act and report**, or **stop and ask**. It learns this from corrections, and the Routine Detail screen shows it as a readable list of *things I taught it* ("check with me above £200", "never send to someone new without asking").

**Hard rules, independent of trust level:** anything that spends money, sends to a new recipient, deletes, or cannot be undone always parks and asks. Thresholds are user-set. Present this in the UI as a feature, not a limitation.

---

## 8. AWAY MODE & POCKET (the remote execution surface)

**Authorization is granted before leaving, like handing over keys.** The Away Mode screen is a deliberate, single-purpose authorization: which routines may run unattended (only ones that passed the second graduation), a spend cap, a cap on actions per session, a duration after which authority expires automatically, and a plain-language summary of exactly what is being permitted. Design it to feel weighty and considered, not like a settings toggle.

**Pocket is a queue, not a chat.** The user dispatches; they do not converse. Three states must be distinguishable at a glance:
- **Queued** — accepted, waiting its turn.
- **Running now** — with live step text and the pulse.
- **Needs you** — parked on an ambiguity or a hard-rule action, with one specific question and three responses: approve, skip, handle later.

Results arrive as **result cards**: what it did, what changed, time taken, expandable into reasoning, with rollback available.

**Presence is first-class.** The machine sleeps, drops connection, or closes. Pocket must show an honest, prominent state for *your computer is unreachable — I've held your instruction*, plus a keep-alive option the user enables before leaving. Instructions must never appear to have silently evaporated.

**Emergency stop** is a single unmissable control on Pocket that halts everything and rolls back what it can.

**Interruption is designed, not discovered.** If the user returns mid-run, Mimic yields instantly on any human input, surfaces a calm panel showing what it was doing, and asks whether to resume, hand over, or stop.

**Custody:** Pocket pairs to the desktop as a device (no password login), requires biometric confirmation on dispatch, sessions expire, and any paired device can revoke the others. Represent this in the UI even though it's simulated.

---

## 9. SCREENS

**Desk — The Den.** The bot's home. Calm, mostly empty, dominated by negative space and the pulse. One line in the agent's voice about what it's currently noticing, counts by stage, and anything awaiting a decision. Away Mode status if active.

**Desk — Routines.** Sectioned by stage. Learning shows progress bars; Ready shows its call to action; Supervised shows the proving-run tracker; Trusted shows last run and autonomy marker; Unattended-eligible carries a distinct quiet mark. Reads as a quiet inventory, not a dashboard.

**Desk — Routine Detail.** Intent and success criteria in plain language, how it's seen the task done, confidence history, *things I taught it*, hard-rule thresholds, run history, drift status, and stage controls including both graduations and demotion.

**Desk — Run Theatre.** As above.

**Desk — Ledger.** The receipt: routines run, time returned, corrections given, week-over-week trend, and every action expandable into reasoning with rollback. Includes **export** (freelancers proving billable hours) and **share a run recording** — a clean, exportable clip of Mimic doing the work.

**Desk — Away Mode.** The authorization screen described above, plus live status while active.

**Desk — Permissions.** What Mimic may watch and act on, in plain language, with a **Pause observation** control reachable from every screen. States plainly that execution happens locally on this machine.

**Pocket — Queue.** The dispatch surface, result cards, needs-you prompts, presence state, emergency stop.

---

## 10. MULTIPLAYER (implement as a visible but shallow slice)

Routines can be shared. Because routines store intent rather than clicks, a shared routine is stripped of the owner's entities and credentials and re-binds to the recipient's own world on install.

**Quarantine rule, non-negotiable:** an installed routine always begins at SUPERVISED, never inherits trust, and must prove itself from scratch — no matter how trusted it was for its author. Show this clearly at install.

Build: a small shared library view, an install flow that shows the re-binding, and the quarantine notice. Do not build accounts, profiles, or social features.

---

## 11. ENTITY MEMORY

Mimic knows the user's working world — recurring people, clients, projects, accounts, and which file "the Tuesday deck" means. Surface it as a simple, readable **Memory** panel within Permissions: what it has learned about the user's world, each item individually deletable. Routines reference these entities by name in their plain-language descriptions.

---

## 12. AGENT VOICE

First person, warm, understated, slightly dry. Short sentences. Admits uncertainty freely. Never enthusiastic, never salesy, no exclamation marks, no emoji, never says "I'm just an AI." Reports what it did rather than praising itself.

Good: *"Ran the Monday report. The client column was empty again — I left it alone rather than guess."*
Wrong: *"Task completed successfully! 🎉 I've automated your workflow!"*

Centralise all agent copy in `lib/voice.ts`.

---

## 13. MOCK DATA & SIMULATION

Seed ~11 routines spanning every stage, drawn from ordinary recognisable computer work — assembling a recurring report, filing and renaming incoming documents, chasing an unpaid invoice, prepping a weekly summary, cleaning a spreadsheet export. Deliberately include: one partially-learned routine, one that fails mid-run during a supervised run, one showing drift, one eligible for unattended, and one installed from someone else sitting in quarantine.

**Demo Controls** panel (floating, dismissible, toggled with `D`):
- Advance the fake clock
- Force an observation (bumps learning confidence)
- Trigger a new routine discovery
- Force the next run to make a mistake
- Force a failure (tests the clean-stop protocol)
- Take the desktop offline / bring it back (tests presence)
- Simulate the user returning mid-run (tests interruption)
- Reset to seed

Single store (Zustand or Context + reducer), memory-only. Simulated runs deterministic and interruptible. Desk and Pocket share the store so a dispatch on one appears live on the other.

---

## 14. UI / DESIGN SYSTEM (locked — implement exactly)

Aesthetic: **minimalist neumorphism**. Cool, sleek, easy on the eyes. Soft tactile surfaces that feel pressed out of the background rather than stacked on top of it. This must not look like a Notion/Linear clone or a default AI-startup template.

**Color tokens** (define as CSS variables in one `tokens.css` / Tailwind theme extension; never hardcode hex in components):
- `--bg-base: #F0F3F8` — off-white app background
- `--surface: #FFFFFF` — raised cards and controls
- `--primary: #2563EB` — blue; reserved for the agent, active states, and at most one accent per screen
- `--primary-soft: #DBEAFE` — tints, hover washes, agent-content backgrounds
- `--ink: #0F172A` — primary text
- `--slate: #64748B` — secondary text, metadata
- `--shadow-dark: rgba(163,177,198,0.28)` and `--shadow-light: rgba(255,255,255,0.9)` — the neumorphic pair

Everything else is white-on-white; elevation, not color, does the separating.

**Neumorphic treatment:**
- Raised surfaces: dual soft shadows — `box-shadow: -6px -6px 14px var(--shadow-light), 6px 6px 14px var(--shadow-dark)`.
- Pressed/inset (inputs, active toggles, selected states): `box-shadow: inset -4px -4px 10px var(--shadow-light), inset 4px 4px 10px var(--shadow-dark)`.
- Border radius: 16–24px on cards, 12px on controls, pill on chips.
- **No hard borders or outlines anywhere.** Separation comes from elevation only.
- Define these as reusable utility classes/components (`.raised`, `.pressed`) — do not re-derive shadows per component.

**Typography:** Figtree everywhere, loaded via Google Fonts (`next/font/google`, weights 400/500/600/700). Headings 600–700 with letter-spacing -0.02em; body 400 in `--ink`; secondary text in `--slate`; uppercase micro-labels at 500 with 0.08em tracking for metadata. Comfortable line-height (1.6 body); a clear scale of ~5 sizes, defined once as tokens.

**Spacing & layout:** airy and calm — generous negative space, comfortable card padding (24px+), never dense or dashboard-like. Desktop-first, responsive down to mobile widths.

**Motion:** subtle and slow. Buttons press from raised → inset on click; soft fades on view changes; nothing bouncy. One signature ambient element: a **quiet blue pulse** showing the agent's presence / last tick — this is the interface's heartbeat and the hero of the design. Respect `prefers-reduced-motion`.

---

## 15. DESIGN SYSTEM — MIMIC-SPECIFIC EXTENSIONS

**Progress bars** are the most-repeated component; make them exceptional. Track is an inset (`.pressed`) channel; fill is `--primary` with a soft inner glow, animating in slow eased steps. Percentage is a small `--slate` numeral, never inside the bar. No stripes, gradients, or shimmer.

**The pulse** is a soft, slowly breathing blue radial glow, ~4-second cycle. Large in the Den, small beside the active step in Run Theatre, small in Pocket when a job is running. It never spins or bounces. When observation is paused it dims to `--slate` and holds still — that stillness must be immediately noticeable. When the desktop is unreachable, Pocket's pulse goes still and grey.

**Stage is communicated by elevation and treatment, not coloured badges.** Learning sits slightly inset, as if still forming; Ready is raised with a single blue accent; Supervised is raised and carries the pulse; Trusted sits flattest and calmest with a small blue mark; Unattended-eligible carries the same calm with one additional quiet marker. Stage should be readable from across the room without reading a word.

**Away Mode** shifts the entire app's ambient temperature slightly — the Den's pulse becomes slower and steadier — so the user can feel that the machine is working without them.

**Needs-you states** are the one place a warmer accent is permitted, but keep it within the palette: use `--primary` at full strength against `--primary-soft`, never red, never an alert icon. Mimic asking a question is normal, not an error.

Avoid: coloured status pills, icon-heavy toolbars, dark chrome, gradient hero sections, dense tables, emoji.

---

## 16. BUILD ORDER

1. Tokens, Tailwind theme, Figtree, `.raised` / `.pressed` primitives.
2. Shared shell: nav, pulse component, layout.
3. Store, seed data, simulation engine (shared by Desk and Pocket).
4. Routines list with all stage treatments and progress bars.
5. Run Theatre: pause, step-back, correction flow, self-pause, clean-stop failure.
6. Both graduations, demotion, drift flag.
7. Den, Ledger (with reasoning, rollback, export, run recording), Permissions with Memory panel.
8. Away Mode authorization, then Pocket: queue, result cards, needs-you, presence, emergency stop, interruption.
9. Shared library slice with quarantine.
10. Demo Controls, `prefers-reduced-motion` pass, responsive pass.

Pause after step 4 and show me the routines list before continuing — the stage treatments must be right before anything is built on them. Pause again after step 8 before multiplayer.

---

## 17. ACCEPTANCE CRITERIA

- A visitor can take a routine from partial learning → 100% → four supervised runs (correcting a mistake in at least one, and hitting one clean failure) → graduation → several present runs → second graduation → Away Mode authorization → a Pocket dispatch that returns a result card.
- Corrections visibly change subsequent behaviour and appear in *things I taught it*.
- A hard-rule action always parks and asks, at every trust level, including unattended.
- Taking the desktop offline produces an honest held-instruction state in Pocket, never a silent loss.
- Returning mid-run yields control immediately and offers resume / hand over / stop.
- An installed shared routine begins supervised and says so.
- Nothing about the trust ladder can be skipped, but everything can be reversed.
- No hard borders anywhere. No hardcoded hex outside `tokens.css`.
- With reduced motion enabled the app is fully usable and the pulse holds steady.
- Every agent-authored string comes from `lib/voice.ts`.
