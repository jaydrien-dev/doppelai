#!/usr/bin/env node
/**
 * Exercises Mimic's core against a real sandbox folder, without launching a
 * window. Electron is stubbed out with just enough surface for db/actions to
 * run; everything else — the miner, the executor, the undo journal — is the
 * code that ships.
 *
 *   node scripts/selftest.js
 */

const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SANDBOX = path.join(os.tmpdir(), "mimic-selftest");
const STATE_DIR = path.join(SANDBOX, "appdata");
const INBOX = path.join(SANDBOX, "Inbox");
const FILED = path.join(SANDBOX, "Filed");

/* ------------------------------------------------------------ electron stub */

const stub = {
  app: { getPath: () => STATE_DIR, isPackaged: false, on() {}, whenReady: async () => {} },
  clipboard: { readText: () => "" },
  shell: { openPath: async () => "", showItemInFolder() {}, openExternal() {} },
  ipcMain: { handle() {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  net: {},
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  powerSaveBlocker: { start: () => 0, stop() {} },
};

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return stub;
  return load.call(this, request, ...rest);
};

/* ----------------------------------------------------------------- harness */

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

/** Files written a moment ago are treated as "still arriving" and skipped. */
const settle = (file) => {
  const past = new Date(Date.now() - 5000);
  fs.utimesSync(file, past, past);
};

async function main() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  for (const dir of [SANDBOX, STATE_DIR, INBOX, FILED]) fs.mkdirSync(dir, { recursive: true });

  const db = require("../electron/core/db");
  const miner = require("../electron/core/miner");
  const actions = require("../electron/core/actions");

  db.init();
  db.update((s) => {
    s.observation.roots = [SANDBOX];
    s.permissions.actFiles = true;
    s.permissions.actTrash = false;
    s.permissions.actGui = false;
  });

  /* ------------------------------------------------------- 1. the miner --- */

  section("Mining routines out of raw observations");

  const MINUTE = 60_000;
  const start = Date.now() - 40 * 24 * 60 * MINUTE;

  /** One stretch of work: a csv lands in Inbox, then gets moved to Filed. */
  const session = (index) => {
    const at = start + index * 30 * MINUTE; // well beyond the 90s idle gap
    const name = `export-${index}.csv`;
    return [
      {
        id: `e-${index}-a`,
        at,
        kind: "file.created",
        path: path.join(INBOX, name),
        root: SANDBOX,
        dir: INBOX,
        name,
        ext: ".csv",
        size: 100,
      },
      {
        id: `e-${index}-b`,
        at: at + 4000,
        kind: "file.moved",
        path: path.join(FILED, name),
        from: path.join(INBOX, name),
        fromDir: INBOX,
        dir: FILED,
        root: SANDBOX,
        name,
        ext: ".csv",
      },
    ];
  };

  const SIGHTINGS = 8;
  db.update((s) => {
    s.events = [];
    for (let i = 0; i < SIGHTINGS; i++) s.events.push(...session(i));
  });

  const sessions = miner.sessionize(db.get().events);
  check(
    "the stream splits into one session per stretch",
    sessions.length === SIGHTINGS,
    `got ${sessions.length}`,
  );

  miner.mine();
  let routines = db.get().routines;
  check("a routine is mined from the repetition", routines.length === 1, `got ${routines.length}`);

  const routine = routines[0];
  check("it has both steps", routine?.stepLibrary.length === 2, `got ${routine?.stepLibrary.length}`);
  check("repetition carried it to 100%", routine?.confidence === 100, `got ${routine?.confidence}`);
  check("100% promoted it to ready", routine?.stage === "ready", `got ${routine?.stage}`);
  check("it wrote itself an intent", Boolean(routine?.intent?.length > 10), routine?.intent);
  check(
    "the move step carries a real, executable action",
    routine?.stepLibrary.some(
      (s) => s.action.kind === "move" && s.action.from === INBOX && s.action.to === FILED,
    ),
  );
  miner.mine();
  check("mining again is idempotent", db.get().routines.length === 1);

  /* --- window flapping must not become a hundred-step routine --- */
  db.update((s) => {
    s.routines = [];
    const events = [];
    for (let i = 0; i < 4; i++) {
      const at = start + i * 30 * MINUTE;
      // Tabbing between two apps twelve times in one stretch.
      for (let k = 0; k < 12; k++) {
        events.push({
          id: `w-${i}-${k}`,
          at: at + k * 2000,
          kind: "window.focus",
          app: k % 2 === 0 ? "Code" : "chrome",
          title: k % 2 === 0 ? "mimic - VS Code" : "docs - Chrome",
        });
      }
    }
    s.events = events;
  });
  miner.mine();
  const flap = db.get().routines[0];
  check("alternating windows collapse to one step each", flap?.stepLibrary.length === 2,
    String(flap?.stepLibrary.length));
  check("so the title stays readable", flap && flap.title.length < 60, flap?.title);
  check("and names each application once", flap && !/VS Code.*VS Code/.test(flap.title), flap?.title);

  db.update((s) => {
    s.routines = [];
    s.events = [...session(0), ...session(1)];
  });
  miner.mine();
  const shy = db.get().routines[0];
  check("two sightings is not enough to be sure", shy && shy.confidence < 100, `got ${shy?.confidence}`);
  check("and it stays in learning", shy?.stage === "learning", `got ${shy?.stage}`);

  db.update((s) => {
    s.routines = [];
    const events = [];
    for (let i = 0; i < SIGHTINGS; i++) {
      const pair = session(i);
      events.push(...(i % 2 === 0 ? pair : [pair[1], { ...pair[0], at: pair[1].at + 1000 }]));
    }
    s.events = events;
  });
  miner.mine();
  const split = db.get().routines[0];
  check(
    "orderings that disagree hold confidence back",
    split && split.confidence <= 72,
    `got ${split?.confidence}`,
  );
  check("and it admits which part it's unsure of", Boolean(split?.unsure), split?.unsure);

  /* ---------------------------------------------------- 2. the executor --- */

  section("Carrying actions out for real");

  const target = path.join(INBOX, "quarterly.csv");
  fs.writeFileSync(target, "a,b,c\n1,2,3\n");
  settle(target);

  const moveAction = { kind: "move", from: INBOX, to: FILED, match: "*.csv" };
  const moved = await actions.run(moveAction, { runId: "test" });

  check("the move reported success", moved.ok === true, moved.detail);
  check("the file really left the inbox", !fs.existsSync(target));
  check("and really arrived", fs.existsSync(path.join(FILED, "quarterly.csv")));
  check("it recorded what changed", moved.changes.length === 1, JSON.stringify(moved.changes));
  check("it wrote down how to undo itself", moved.inverse.length === 1);

  const undone = actions.undo(moved.inverse);
  check("undo reported success", undone.ok === true, undone.failures.join("; "));
  check("the file is back where it started", fs.existsSync(target));
  check("and gone from where it went", !fs.existsSync(path.join(FILED, "quarterly.csv")));

  settle(target);
  const renamed = await actions.run(
    { kind: "rename", dir: INBOX, match: "*.csv" },
    { runId: "test", overrides: { pattern: "Date first, then the old name" } },
  );
  check("the rename reported success", renamed.ok === true, renamed.detail);
  const stamped = fs.readdirSync(INBOX).find((n) => /^\d{4}-\d{2}-\d{2} quarterly\.csv$/.test(n));
  check("the file is stamped with today's date", Boolean(stamped), fs.readdirSync(INBOX).join(", "));
  actions.undo(renamed.inverse);
  check("renaming can be undone too", fs.existsSync(target));

  settle(target);
  fs.writeFileSync(path.join(FILED, "quarterly.csv"), "existing");
  const collided = await actions.run(moveAction, { runId: "test" });
  check(
    "a name collision never overwrites",
    fs.readFileSync(path.join(FILED, "quarterly.csv"), "utf8") === "existing",
  );
  check(
    "the incoming file is kept alongside instead",
    fs.existsSync(path.join(FILED, "quarterly (2).csv")),
    collided.detail,
  );
  actions.undo(collided.inverse);

  /* --------------------------------------------------- 3. the hard rules --- */

  section("Rules that hold whatever the trust level");

  const outside = await actions.run(
    { kind: "move", from: os.homedir(), to: FILED, match: "*.csv" },
    { runId: "test" },
  );
  check(
    "it refuses to work outside the allowed folders",
    outside.parked === true && outside.rule === "outside",
    outside.detail,
  );

  const trashDenied = await actions.run({ kind: "trash", dir: INBOX, match: "*.csv" }, { runId: "test" });
  check("clearing away is refused while the permission is off", trashDenied.parked === true, trashDenied.detail);

  db.update((s) => {
    s.permissions.actTrash = true;
  });

  const trashParked = await actions.run({ kind: "trash", dir: INBOX, match: "*.csv" }, { runId: "test" });
  check(
    "with permission it still parks and asks",
    trashParked.parked === true && trashParked.rule === "delete",
    trashParked.detail,
  );

  fs.writeFileSync(target, "to be cleared");
  settle(target);
  const trashed = await actions.run(
    { kind: "trash", dir: INBOX, match: "*.csv" },
    { runId: "test-run", approved: true },
  );
  check("approved, it goes through", trashed.ok === true, trashed.detail);
  check("the file is out of the inbox", !fs.existsSync(target));
  const binned = path.join(db.paths.trash, "test-run", "quarterly.csv");
  check("but it is never destroyed — it's recoverable", fs.existsSync(binned), binned);
  actions.undo(trashed.inverse);
  check("and it comes back", fs.existsSync(target));

  const gui = await actions.run({ kind: "click", x: 10, y: 10 }, { runId: "test" });
  check(
    "driving other apps is refused while switched off",
    gui.parked === true && gui.rule === "gui",
    gui.detail,
  );

  db.update((s) => {
    s.permissions.actGui = true;
  });
  const guiParked = await actions.run({ kind: "click", x: 10, y: 10 }, { runId: "test" });
  check("with permission it still parks, being irreversible", guiParked.parked === true, guiParked.detail);

  const nonsense = await actions.run({ kind: "launch-missiles" }, { runId: "test" });
  check("an action it doesn't understand parks rather than guesses", nonsense.parked === true, nonsense.detail);

  /* A model can emit a well-named action with a field simply missing. */
  const headless = await actions.run({ kind: "move", to: FILED, match: "*.csv" }, { runId: "test" });
  check(
    "an action missing a folder parks instead of crashing",
    headless.parked === true,
    headless.detail,
  );
  check(
    "and says which field was missing",
    String(headless.detail).includes("from"),
    headless.detail,
  );

  /* ------------------------------------------------------------ 4. keys --- */

  section("Translating keys Claude's way into keys Windows understands");

  const keys = require("../electron/core/keys");

  check("a plain combination", keys.toSendKeys("ctrl+s") === "^s", keys.toSendKeys("ctrl+s"));
  check("two modifiers", keys.toSendKeys("ctrl+shift+s") === "^+s", keys.toSendKeys("ctrl+shift+s"));
  check("a named key", keys.toSendKeys("Return") === "{ENTER}", keys.toSendKeys("Return"));
  check("a function key with a modifier", keys.toSendKeys("alt+F4") === "%{F4}", keys.toSendKeys("alt+F4"));
  check("an arrow", keys.toSendKeys("Left") === "{LEFT}", keys.toSendKeys("Left"));
  check(
    "a character SendKeys treats as syntax is escaped",
    keys.toSendKeys("shift+^") === "+{^}",
    keys.toSendKeys("shift+^"),
  );
  check(
    "a key Windows can't send is refused rather than mistranslated",
    keys.toSendKeys("super+l") === null,
    String(keys.toSendKeys("super+l")),
  );
  check("a sequence splits", JSON.stringify(keys.toSequence("ctrl+a ctrl+c")) === '["^a","^c"]');

  /* ----------------------------------------------------------- 5. brain --- */

  section("Remembering, organising and recalling");

  const brain = require("../electron/core/brain");
  brain.init();

  const HOUR = 3_600_000;
  const base = Date.now() - 6 * HOUR;

  brain.remember({
    at: base,
    app: "Excel",
    window: "October reconciliation.xlsx",
    activity: "Reconciling the October invoices against the bank export",
    intent: "Close off the October accounts",
    entities: [
      { kind: "person", name: "Priya Nair", note: "Finance; gets the monthly summary" },
      { kind: "project", name: "October close", note: "Monthly accounting close" },
    ],
    salience: 0.9,
  });

  brain.remember({
    at: base + HOUR,
    app: "Chrome",
    window: "Cat videos",
    activity: "Watching something unrelated",
    intent: "",
    entities: [],
    salience: 0.05,
  });

  brain.remember({
    at: base + 2 * HOUR,
    app: "Outlook",
    window: "Re: October numbers",
    activity: "Writing to Priya about the October numbers",
    intent: "Get the October close signed off",
    entities: [{ kind: "person", name: "Priya Nair", note: "Finance" }],
    salience: 0.8,
  });

  check("episodes are kept", brain.stats().episodes === 3, String(brain.stats().episodes));
  check("entities are merged, not duplicated", brain.stats().entities === 2, String(brain.stats().entities));

  const priya = brain.knownEntities().find((e) => e.name === "Priya Nair");
  check("a repeated entity counts its sightings", priya?.seenCount === 2, String(priya?.seenCount));
  check("the fuller note wins", priya?.note.includes("monthly summary"), priya?.note);

  const recalled = brain.recall("October reconciliation Priya");
  check("recall finds the relevant work", recalled.episodes.length >= 2, String(recalled.episodes.length));
  check(
    "recall surfaces the people involved",
    recalled.entities.some((e) => e.name === "Priya Nair"),
  );
  check(
    "irrelevant noise is not recalled",
    !recalled.episodes.some((e) => e.activity.includes("unrelated")),
  );
  check("the pack stays inside its budget", recalled.tokens < 3000, String(recalled.tokens));
  check(
    "the pack renders as prompt text",
    brain.packToText(recalled).includes("Priya"),
  );

  const nothing = brain.recall("submarine navigation charts");
  check("an unrelated question recalls nothing", nothing.episodes.length === 0);

  /* --- the exact words and figures read off the screen --- */
  brain.remember({
    at: base + 2.5 * HOUR,
    app: "Excel",
    window: "October reconciliation.xlsx",
    location: "Excel — October reconciliation.xlsx, sheet 'Bank', row 340",
    activity: "Chasing a discrepancy on row 340",
    intent: "Find why the October totals disagree",
    changed: "The totals column now shows a variance where it was blank before",
    fragments: [
      { kind: "figure", what: "invoice number", value: "4471" },
      { kind: "figure", what: "invoice total", value: "£2,340.00" },
      { kind: "figure", what: "variance", value: "-£12.00" },
      { kind: "text", what: "error message", value: "Circular reference in D340" },
      { kind: "text", what: "column heading", value: "Net of VAT" },
    ],
    entities: [{ kind: "client", name: "Northwind", note: "The invoice is theirs" }],
    salience: 0.95,
  });

  const byNumber = brain.recall("invoice 4471");
  check(
    "an exact invoice number finds the moment it was on screen",
    byNumber.episodes.some((e) => e.activity.includes("row 340")),
    JSON.stringify(byNumber.episodes.map((e) => e.activity)),
  );

  const byError = brain.recall("circular reference D340");
  check(
    "an error message is searchable word for word",
    byError.episodes.length > 0,
    String(byError.episodes.length),
  );

  const money = brain.recall("£2,340.00");
  check(
    "an amount with punctuation is found as one identifier",
    money.episodes.some((e) => e.activity.includes("row 340")),
    JSON.stringify(money.episodes.map((e) => e.activity)),
  );
  check(
    "and a bare digit doesn't drag half the index back",
    brain.recall("3").episodes.length === 0,
  );

  const packText = brain.packToText(byNumber);
  check("the recalled pack carries the exact figure", packText.includes("£2,340.00"), packText.slice(0, 200));
  check("and the variance that mattered", packText.includes("-£12.00"));
  check("and where to go back to", packText.includes("row 340"));

  const kept = brain.recentEpisodes(1)[0];
  check("fragments are stored on the episode", kept.fragments.length === 5, String(kept.fragments?.length));

  /* --- privacy is enforced where the writing happens --- */
  brain.remember({
    at: base + 3 * HOUR,
    app: "Chrome",
    window: "Barclays — Move money",
    activity: "Typing a sort code and account number",
    intent: "Pay someone",
    detail: "Account 12345678",
    location: "Chrome — Barclays, Move money",
    changed: "A payee form appeared",
    fragments: [
      { kind: "figure", what: "sort code", value: "20-00-00" },
      { kind: "figure", what: "account number", value: "12345678" },
      { kind: "text", what: "field label", value: "Payee account number" },
    ],
    entities: [{ kind: "account", name: "Barclays current account", note: "sort 20-00-00" }],
    salience: 0.9,
    sensitive: true,
  });

  const secrets = brain.recall("Barclays sort code account");
  check("a sensitive screen records nothing about itself", secrets.episodes.length === 0);
  check(
    "and its entities never enter memory",
    !brain.knownEntities().some((e) => e.name.includes("Barclays")),
  );

  /* The whole point of reading closely is that it *could* have written these
     down. The guarantee is that it didn't. */
  const banked = brain
    .recentEpisodes(10)
    .find((e) => e.sensitive && e.at === base + 3 * HOUR);

  const account = brain.recall("12345678");
  check("an account number is not searchable afterwards", account.episodes.length === 0);
  const sortCode = brain.recall("20-00-00");
  check(
    "nor the sort code",
    !sortCode.episodes.some((e) => e.id === banked?.id) && sortCode.episodes.length === 0,
    JSON.stringify(sortCode.episodes.map((e) => e.activity)),
  );

  /* A query can legitimately match other episodes on ordinary words like
     "number" — what must never happen is the sensitive moment coming back. */
  const nearby = brain.recall("payee account number field");
  check(
    "and a near-miss query never returns the private moment itself",
    !nearby.episodes.some((e) => e.id === banked?.id),
    JSON.stringify(nearby.episodes.map((e) => e.activity)),
  );
  check("the sensitive episode holds no fragments at all", banked?.fragments.length === 0);
  check("and no location either", !banked?.location);

  check("but the moment itself is still counted", brain.stats().episodes === 5);

  brain.forgetEntity(priya.id);
  check("forgetting an entity removes it", !brain.knownEntities().some((e) => e.id === priya.id));

  /* --------------------------------------------------- 6. the vector store --- */

  section("Keeping memories as meaning");

  const vectors = require("../electron/core/vectors");

  const probe = await vectors.embed(["reconciling October invoices against the bank export"]);

  if (!probe) {
    console.log("  --   embedding model unavailable; semantic checks skipped");
    check("and the brain still recalls by words alone", brain.recall("October").episodes.length > 0);
  } else {
    check("an embedding is the expected width", probe[0].length === 384, String(probe[0].length));
    check(
      "and is unit length, which is what makes the dot product a cosine",
      Math.abs(Math.hypot(...probe[0]) - 1) < 0.01,
      String(Math.hypot(...probe[0])),
    );

    /* Round-trip through the quantiser the real store uses.

       The brain embeds in the background, so let its queue settle and start
       from a clean store — otherwise the episodes remembered earlier in this
       run land here mid-test and the counts drift. */
    await new Promise((r) => setTimeout(r, 2500));
    const scratch = path.join(SANDBOX, "vec-test");
    vectors.wipe();
    vectors.init(scratch);
    const [a, b, c] = await vectors.embed([
      "reconciling October invoices against the bank export",
      "watching videos of cats doing nothing much",
      "chasing a variance on the October ledger",
    ]);
    vectors.add({ id: "inv", at: Date.now(), salience: 0.9 }, a);
    vectors.add({ id: "cat", at: Date.now(), salience: 0.1 }, b);
    vectors.add({ id: "led", at: Date.now(), salience: 0.8 }, c);
    vectors.add({ id: "secret", at: Date.now(), salience: 0.9, sensitive: true }, a);

    const [q] = await vectors.embed(["the accounts work I was stuck on"]);
    const hits = vectors.search(q, { limit: 5, minScore: 0 });

    check("the accounting memories rank above the cat video",
      hits[0].id !== "cat" && hits.findIndex((h) => h.id === "cat") > 0,
      JSON.stringify(hits.map((h) => `${h.id}:${h.score.toFixed(2)}`)));
    check(
      "meaning is matched without a shared word",
      hits.some((h) => h.id === "led"),
      JSON.stringify(hits.map((h) => h.id)),
    );
    check("a sensitive memory is never returned", !hits.some((h) => h.id === "secret"));

    check("int8 quantising costs a byte per dimension", vectors.stats().bytes === 4 * 384,
      String(vectors.stats().bytes));

    /* Survives a restart, which is the whole point of writing it down. */
    vectors.flush();
    vectors.init(scratch);
    const again = vectors.search(q, { limit: 5, minScore: 0 });
    check("vectors survive a reload", again.length === 3, String(again.length));
    check(
      "and rank the same afterwards",
      again[0].id === hits[0].id,
      `${again[0]?.id} vs ${hits[0]?.id}`,
    );

    check("forgetting removes the vector too", vectors.forget(["inv"]) === 1);
    check("and it is gone from search", !vectors.search(q, { limit: 5, minScore: 0 }).some((h) => h.id === "inv"));
  }

  /* ------------------------------------------------------ 7. persistence --- */

  section("Remembering across restarts");

  db.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "mimic-state.json"), "utf8"));
  check("state is written to disk", Boolean(onDisk.version));
  check("watched folders survive", onDisk.observation.roots.includes(SANDBOX));
  check("there is no seed data anywhere", !JSON.stringify(onDisk).includes("Monday report"));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
