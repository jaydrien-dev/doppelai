# Claude Code Prompt — **Mimic**

> Paste everything below into Claude Code as the initial prompt.

---

Build a high-fidelity, interactive front-end prototype for a desktop product called **Mimic**.

**Stack:** Next.js (App Router) + TypeScript + Tailwind + Framer Motion. No backend, no auth, no database. All agent behaviour is simulated with mock data and a controllable fake clock so the entire product story can be demoed end-to-end in the browser. Prioritise the feel of the interface over architectural completeness.

---

## 1. WHAT MIMIC IS

Mimic is a small agent that lives on your computer. It watches how you actually work, notices the sequences you repeat, learns them, and then — once you trust it — performs them for you.

The product is not a chatbot and not a macro recorder. There is no scripting, no setup wizard, no "build an automation" flow. The user never configures anything. Mimic observes, proposes, proves itself, and takes over.

**The emotional arc the UI must deliver:** *curiosity → recognition ("it noticed that?") → supervision → trust → relief.*

---

## 2. THE CORE LOOP (this is the product — get this exactly right)

Every routine Mimic knows moves through four stages. Stage is the single most important piece of state in the app, and the UI must make a routine's stage legible at a glance.

**Stage 1 — LEARNING**
Mimic has spotted a repeated sequence and is still watching. Each learning routine shows a **progress bar** representing learning confidence (0–100%), which advances each time it observes another repetition. The card shows what it thinks it's watching in plain, humble language ("Something you do most Mondays — I'm still working out the middle bit"), how many times it's seen it, and what it's still unsure about. Confidence rises in visible jumps when a new observation lands, never by smooth ticking.

**Stage 2 — READY**
At 100%, the routine surfaces a single primary action: **"Let Mimic try it."** Before the user commits, they can expand a plain-language playback of the steps Mimic believes it learned, and the bot states honestly which steps it's confident about and which it's guessing at. Nothing runs without explicit user consent here.

**Stage 3 — SUPERVISED** (the heart of the prototype)
Mimic runs the routine while the user watches, for a set number of proving runs (default 4, user can change to 3–5). The **Run Theatre** view is a stepped, cinematic walkthrough:
- Steps render as a vertical timeline; the active step is highlighted with the agent's blue pulse.
- Each step executes with a deliberate, watchable delay (~1.2–2s) — never instant. The user must be able to follow along.
- Persistent controls: **Pause**, **Step back**, and **Correct this step**.
- **Correct this step** opens an inline panel where the user can edit the step's parameters, skip it, or reorder it. Corrections are the product's learning signal: after a correction, show a small acknowledgement in the agent's voice ("Got it — I'll always check the date column first"), and the routine's accuracy reflects it on subsequent runs.
- Mimic pauses *itself* when genuinely unsure and asks a single, specific question rather than guessing.
- Each run ends with a run summary: what it did, what changed, time taken, corrections received.
- A **proving-run tracker** (e.g. "Run 2 of 4") is always visible. Uncorrected runs advance trust; a corrected run resets that run and requires it to be re-proven — make this rule explicit in the UI so the ladder feels earned rather than arbitrary.

**Stage 4 — TRUSTED**
After the proving runs pass clean, present a deliberate, ceremonial **graduation moment** — the emotional peak of the app. Mimic asks for autonomy in its own voice; the user grants it. Trusted routines then run on their own and appear only as entries in the ledger. The user can always demote a routine back to supervised in one click, and that escape hatch must be visible, not buried — the whole trust ladder depends on it feeling reversible.

---

## 3. SCREENS

**Home — "The Den"**
The bot's home. Calm, mostly empty, dominated by negative space and the agent's presence. Contains: the ambient pulse (see design system), a single line in the agent's voice about what it's currently noticing, the count of routines by stage, and anything awaiting the user's decision. Anything needing attention appears here first; nothing else competes for it.

**Routines**
The main list. Sectioned by stage — Learning / Ready / Supervised / Trusted. Learning routines show their progress bars; Ready routines show their call to action; Supervised routines show their proving-run tracker; Trusted routines show last-run time and a small autonomy marker. This screen should read as a quiet inventory, not a dashboard.

**Routine Detail**
Everything about one routine: the plain-language step list, where it was learned from, confidence history, corrections the user has made (as a visible list — "things I taught it"), run history, and stage controls including demote.

**Run Theatre**
The supervised-run experience described above. Give this screen the most design attention. It should feel like watching something work, calmly — closer to observing a machine through glass than monitoring a progress dialog.

**Ledger**
The receipt. A weekly summary the user can screenshot: routines run, time returned, corrections given, plus a simple week-over-week trend. This is the "why am I paying for this" answer, so it must feel substantial and concrete — real counts and durations, never vague praise.

**Permissions**
What Mimic can watch and what it may act on without asking, expressed in plain language with simple toggles. Include a global **Pause observation** control that is reachable from every screen — the product's trustworthiness depends on the stop button never being hard to find.

---

## 4. AGENT VOICE

First person, warm, understated, slightly dry. Short sentences. Admits uncertainty freely. Never enthusiastic, never salesy, never uses exclamation marks, never says "I'm just an AI." It reports what it did rather than praising itself.

Good: *"Ran the Monday report. The client column was empty again — I left it alone rather than guess."*
Wrong: *"Task completed successfully! 🎉 I've automated your workflow!"*

Centralise all agent copy in a single `lib/voice.ts` module so the personality is editable in one place.

---

## 5. MOCK DATA & SIMULATION

Seed the app with ~9 routines spread across all four stages so every state is demonstrable on first load. Draw them from ordinary, universally recognisable computer work — assembling a recurring report, filing and renaming incoming documents, chasing an unpaid invoice, prepping a weekly summary from a folder, cleaning up a spreadsheet export. Deliberately include one routine that is only partially learned and one that Mimic gets *wrong* during a supervised run, so the correction flow can be demonstrated rather than described.

Build a **Demo Controls** panel (floating, dismissible, keyboard-toggled with `D`):
- Advance the fake clock
- Force an observation (bumps a learning routine's confidence)
- Trigger a new routine discovery
- Force the next supervised run to make a mistake
- Reset all state to seed

State lives in a single store (Zustand or Context + reducer) persisted to memory only. Simulated runs must be deterministic and interruptible.

---

## 6. UI / DESIGN SYSTEM (locked — implement exactly)

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

## 7. DESIGN SYSTEM — MIMIC-SPECIFIC EXTENSIONS

**Progress bars** are the most-repeated component in the app; make them exceptional. The track is an inset (`.pressed`) channel; the fill is `--primary` with a soft inner glow, animating in slow eased steps. Percentage is a small `--slate` numeral, never inside the bar. No stripes, no gradients, no shimmer.

**The pulse** is a soft, slowly breathing blue radial glow, roughly 4-second cycle. It lives in the Den at large scale and appears at small scale beside the active step in the Run Theatre. It never spins, never bounces. When observation is paused it dims to `--slate` and holds still — that stillness should be immediately noticeable.

**Stage is communicated by elevation and treatment, not by coloured badges.** Learning routines sit slightly inset, as if still forming; Ready routines are raised with a single blue accent; Supervised routines are raised and carry the pulse; Trusted routines sit flattest and calmest, with only a small blue mark. The user should be able to read a routine's stage from across the room without reading a word.

Avoid: coloured status pills, icon-heavy toolbars, dark chrome, gradient hero sections, dense tables, emoji.

---

## 8. BUILD ORDER

1. Tokens, Tailwind theme, Figtree, and the `.raised` / `.pressed` primitives.
2. Shared shell: nav, the pulse component, layout.
3. Store, seed data, and the simulation engine.
4. Routines list with all four stage treatments and the progress bars.
5. Run Theatre, including pause, step-back, and the correction flow.
6. Graduation moment and demotion.
7. Den, Ledger, Permissions.
8. Demo Controls, `prefers-reduced-motion` pass, responsive pass.

Work through these in order and pause after step 4 to show me the routines list before continuing — the stage treatments need to be right before the rest gets built on top of them.

---

## 9. ACCEPTANCE CRITERIA

- A visitor can, without instruction, take a routine from 60% learning → 100% → four supervised runs (correcting a mistake in at least one) → graduation → an autonomous entry in the ledger.
- Corrections visibly change subsequent behaviour and appear in the routine's "things I taught it" list.
- Nothing about the trust ladder can be skipped, but everything can be reversed.
- No hard borders anywhere in the app. No hardcoded hex outside `tokens.css`.
- With reduced motion enabled, the app is fully usable and the pulse holds steady.
- Every agent-authored string comes from `lib/voice.ts`.
