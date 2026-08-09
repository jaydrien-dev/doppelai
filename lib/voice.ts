import type { HardRuleKind } from "./types";

/**
 * Every string Mimic itself says lives here.
 *
 * The voice: first person, warm, understated, slightly dry. Short sentences.
 * Admits uncertainty freely. Reports what it did; never praises itself.
 * No exclamation marks. No emoji. Never "I'm just an AI".
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const voice = {
  /* --- First run ----------------------------------------------------------- */
  first: {
    title: "I don't know anything yet.",
    body:
      "I've started watching. Work the way you normally would and I'll begin to notice " +
      "the things you repeat. It takes a few goes before I'll say anything.",
    watching: (n: number) =>
      n === 0
        ? "I'm not watching any folders yet."
        : `I'm watching ${n} ${plural(n, "folder", "folders")} and whatever window you're in.`,
    teach: "If you'd rather not wait, show me something once.",
    noRoutines: "Nothing yet. I'll speak up when something starts repeating.",
    browser:
      "This is the desktop app's interface running in a browser, so there's nothing for me to watch. " +
      "Open Mimic proper and I'll be able to see your work.",
  },

  /* --- The Den ------------------------------------------------------------- */
  den: {
    watchingNow: (what: string) => `Right now I'm watching ${what}.`,
    watchingNothing: "Nothing much is happening. I'm here if that changes.",
    idle: (app: string) => `You're in ${app}. Nothing worth noting yet.`,
    paused: "I've stopped watching. Nothing is being recorded.",
    pausedSub: "Turn me back on whenever you want. I won't mind the gap.",
    nothingWaiting: "Nothing needs you. I'll say something when that changes.",
    somethingWaiting: (n: number) =>
      n === 1 ? "One thing is waiting on you." : `${n} things are waiting on you.`,
    lastTick: (mins: number) =>
      mins < 1 ? "Last saw something just now." : `Last saw something ${mins} ${plural(mins, "minute", "minutes")} ago.`,
    seen: (events: number, sessions: number) =>
      `${events.toLocaleString()} ${plural(events, "thing", "things")} noticed, in ${sessions} ${plural(sessions, "stretch", "stretches")} of work.`,
    away: "You're out. I'm working quietly.",
    awaySub: (mins: number, n: number) =>
      `${n} ${plural(n, "routine", "routines")} authorised, ${mins} ${plural(mins, "minute", "minutes")} of authority left.`,
  },

  /* --- Learning & teaching ------------------------------------------------- */
  learning: {
    seen: (n: number) => `Seen it ${n} ${plural(n, "time", "times")}.`,
    stillUnsure: (what: string) => `Still unsure: ${what}`,
    waysSeen: (n: number) =>
      n === 1 ? "I've only seen you do it one way." : `I've seen you do it ${n} different ways.`,
    pathLabel: (n: number) => `${n} ${plural(n, "time", "times")}`,
  },

  teach: {
    cta: "Watch this",
    title: "Show me once",
    body:
      "Go and do the thing. I'll pay proper attention. " +
      "One deliberate run teaches me more than six accidental ones.",
    arm: "I'm watching now",
    armed: "Watching. Take your time.",
    armedSub: "Do the whole thing, then tell me you're done and I'll work out what I saw.",
    done: "That's it, I'm finished",
    cancel: "Not now",
    learned: (title: string) => `Right. I think I have ${title}.`,
    learnedSub: "I'll still want to prove it under supervision before I do it alone.",
    jump: (to: number) => `That puts me at ${to}%.`,
    nothing: "I didn't see enough to go on.",
    nothingSub:
      "I need at least two things I can act on — a file moving, a window changing. Try once more, a bit slower.",
    pausedWarning: "I'm not watching anything at the moment. Turn observation back on first.",
  },

  /* --- Ready --------------------------------------------------------------- */
  ready: {
    prompt: "I think I have this one. Want me to try it while you watch?",
    cta: "Let Mimic try it",
    intentLabel: "What this is for",
    criteriaLabel: "How I'll know it worked",
    pathsLabel: "What I'd do, in order",
    guessCount: (n: number) =>
      n === 0
        ? "I'm confident about all of it."
        : `${n} of these ${plural(n, "step is", "steps are")} a guess.`,
    consent: "I won't run anything until you say so.",
    realWarning: "This does the real thing to real files. You can put any of it back afterwards.",
  },

  /* --- Run Theatre --------------------------------------------------------- */
  run: {
    tracker: (n: number, of: number) => `Run ${n} of ${of}`,
    trackerRule:
      "A run with no corrections moves me one step closer. If you correct me, that run starts over.",
    paused: "Held. Nothing is moving.",
    steppedBack: "Back a step. I've undone what I did and I'll do it again.",
    correctionAck: (lesson: string) => `Got it — ${lesson}`,
    correctionResets:
      "That correction means this run starts over. I'd rather earn it than be handed it.",
    summaryTitle: "That's the run.",
    nothingToDo: "There was nothing to do this time.",
    remaining: (n: number) =>
      n === 0 ? "That's the last one I needed." : `${n} clean ${plural(n, "run", "runs")} to go.`,
    close: "Close",
    changesLabel: "What actually changed",
    completedLabel: "What I finished",
    notCompletedLabel: "What I didn't",
    noChanges: "Nothing changed on disk.",

    stoppedTitle: "I stopped cleanly.",
    stoppedSub: "Nothing is half-done. Tell me what you'd like me to do about it.",
    stoppedRetry: "Try it again",
    stoppedHandBack: "I'll do it myself",

    parkedTitle: "I've parked this one.",
    parkedApprove: "Go ahead",
    parkedSkip: "Skip that bit",
    parkedStop: "Stop here",

    yieldedTitle: "You're back.",
    yielded: (step: string) => `I was part-way through ${step}. I've stopped touching things.`,
    yieldedResume: "Carry on",
    yieldedHandOver: "I'll take it from here",
    yieldedStop: "Stop and put it down",
  },

  /* --- Judgment & limits ---------------------------------------------------- */
  rules: {
    title: "What I'll never do quietly",
    body:
      "These stop and ask every time, whatever you've trusted me with. " +
      "Being allowed to run alone doesn't change them.",
    list: [
      "Anything that clears a file away, even into my own trash",
      "Anything I can't undo afterwards",
      "Anything outside the folders you've allowed",
      "Anything I don't recognise",
    ],
    reassure: (trash: string) =>
      `Nothing is ever really deleted. It goes to ${trash}, and stays there until you empty it.`,
    none: "Nothing in this one trips a hard rule.",
  },

  /* --- Drift ---------------------------------------------------------------- */
  drift: {
    flag: "This hasn't gone cleanly twice.",
    ask: "Can I watch you do it once more?",
    body:
      "Something about it has changed and I'd rather learn it again than keep guessing. " +
      "I'll keep everything you've already taught me.",
    accept: "Show me again",
    dismiss: "It's fine, carry on",
    relearning: "Learning this one again. Everything you taught me is still here.",
  },

  /* --- Graduation one ------------------------------------------------------- */
  graduation: {
    eyebrow: "Proven",
    ask: "I think I can take this one from here.",
    body:
      "You've watched me do this enough times that I'm no longer guessing. " +
      "If you let me, I'll run it myself and tell you afterwards.",
    reassure: "You can take it back at any point. One click, no argument.",
    scope: "This is while you're at the machine. Running it while you're out is a separate ask.",
    grant: "Let it run on its own",
    notYet: "Not yet",
    granted: (title: string) => `Thank you. ${title} is mine now.`,
    grantedSub: "You'll find it in the ledger each time it runs.",
  },

  /* --- Graduation two ------------------------------------------------------- */
  unattended: {
    eyebrow: "The second ask",
    ask: "May I do this one while you're out?",
    body: (n: number) =>
      `I've run it ${n} ${plural(n, "time", "times")} on my own with you at the machine, and nothing needed you. ` +
      "Running it while you're away is a different kind of trust, so I'm asking separately.",
    caveats:
      "The hard rules don't change. Anything that clears a file away, or that I can't undo, " +
      "still stops and waits for you — even with nobody here.",
    grant: "Let it run while I'm out",
    notYet: "Not yet",
    granted: (title: string) => `Understood. ${title} can run while you're out.`,
    grantedSub: "You still have to authorise a session before I use it. It isn't a standing pass.",
    marker: "Can run while you're out",
    progress: (passed: number, of: number) => `${passed} of ${of} clean runs with you here.`,
  },

  /* --- Trusted / demotion ---------------------------------------------------- */
  trusted: {
    marker: "Runs on its own",
    lastRun: (when: string) => `Last ran ${when}.`,
    never: "Hasn't run yet.",
    demote: "Watch this one again",
    demoted: "Back under supervision. I'll show you my working.",
    revokeUnattended: "Only while I'm here",
    revoked: "Fine. I'll wait for you.",
    runNow: "Run it now",
  },

  /* --- Things I taught it ---------------------------------------------------- */
  lessons: {
    title: "Things you taught me",
    empty: "You haven't had to correct me on this one yet.",
    count: (n: number) => `${n} ${plural(n, "thing", "things")}`,
    viaCorrection: "you corrected me",
    viaAnswer: "you told me",
    viaRule: "you set a rule",
  },

  /* --- Routine detail --------------------------------------------------------- */
  detail: {
    intentTitle: "What this is for",
    criteriaTitle: "How I know it worked",
    pathsTitle: "How I've seen you do it",
    pathsNote: "Steps are evidence, not a script. I follow the intent.",
    planTitle: "What I'd do next time",
    planNote: "Each of these is something I can actually carry out.",
    historyTitle: "How sure I've become",
    runsTitle: "Every time I've run it",
    noRuns: "I haven't run this one yet.",
    sourceLabel: "Where I picked this up",
    stageTitle: "Where it stands",
    forget: "Forget this routine",
  },

  /* --- Ledger ----------------------------------------------------------------- */
  ledger: {
    title: "The week",
    intro: (runs: number, mins: number) =>
      runs === 0
        ? "I haven't run anything yet."
        : `I ran ${runs} ${plural(runs, "thing", "things")} and gave you back about ${mins} ${plural(mins, "minute", "minutes")}.`,
    trendUp: (n: number) => `${n} more than last week.`,
    trendDown: (n: number) => `${n} fewer than last week.`,
    trendFlat: "About the same as last week.",
    empty: "Nothing to report yet.",
    emptySub: "Once I've run something, everything I did will be listed here, with a way to put it back.",
    correctionsNote: (n: number) =>
      n === 0 ? "You didn't need to correct me." : `You corrected me ${n} ${plural(n, "time", "times")}. Each one stuck.`,
    why: "Why did you do that?",
    whySaw: "What I saw",
    whyInferred: "What I took from it",
    whyApplied: "What you'd taught me",
    rollback: "Put it back",
    rolledBack: "Put back. It's as it was.",
    notReversible: "I can't undo this one",
    undoWindow: "Anything from the last day",
    undoEmpty: "Nothing from the last day.",
    exportBody: "A plain file of every run this week, with times.",
    exportCta: "Export the week",
    exported: (file: string) => `Saved to ${file}.`,
    recording: "Watch the recording",
    recordingNote: "A clean clip of me doing it, if you want to show someone.",
    trash: "Open my trash",
  },

  /* --- Permissions & memory ----------------------------------------------------- */
  permissions: {
    intro: "Here's what I can see and what I can do without asking first.",
    localTitle: "What stays here, and what doesn't",
    localBody:
      "The work happens on this machine, in your own windows and your own logged-in sessions. " +
      "No service has to agree to let me in, and nothing about your files, windows or clipboard " +
      "ever leaves.",
    localScreen:
      "The exception is reading the screen. To understand what I'm looking at I send the " +
      "screenshot to Anthropic to be described, and keep only the description. That happens " +
      "solely while you have it switched on, and never for a screen I judge to be private. " +
      "Everything else here is local.",
    localScreenOff:
      "Reading the screen is switched off, so nothing at all is leaving this machine right now.",
    watchTitle: "What I watch",
    actTitle: "What I may do without asking",
    foldersTitle: "Folders I may watch and work in",
    foldersNote:
      "This is the whole of my world. I don't read, move or change anything outside these.",
    addFolder: "Add a folder",
    removeFolder: "Remove",
    foldersEmpty: "You haven't given me anywhere to look yet.",
    feedTitle: "What I'm seeing",
    feedNote: "The last few things I noticed. This is the raw material everything else comes from.",
    feedEmpty: "Nothing yet.",
    pause: "Pause observation",
    resume: "Resume observation",
    guiWarning:
      "Driving other applications means moving your pointer and typing into whatever is in front. " +
      "I can't undo any of it, so it always stops and asks first.",
    labels: {
      windows: "Which windows you have open",
      windowsDetail: "The name of the program and its title bar. Not what's inside it.",
      files: "Files appearing, moving and being renamed",
      filesDetail: "Only in the folders below. Names and locations, never contents.",
      clipboard: "What you copy",
      clipboardDetail:
        "I keep a fingerprint and how long it was, never the text. It's how I learn the middle of things.",
      screen: "Read the screen",
      screenDetail:
        "This is the one that makes me useful rather than merely observant — it's the difference " +
        "between knowing you opened Excel and knowing you were reconciling October. Screenshots go " +
        "to Claude to be described, and only the description is kept. Anything that looks private is " +
        "skipped without being written down.",
      actFiles: "Move, rename and copy files",
      actFilesDetail: "Only inside the folders below. Every one can be put back.",
      actWrite: "Create folders and archives",
      actWriteDetail: "Only inside the folders below.",
      actTrash: "Clear files away",
      actTrashDetail: "Into my own trash, never really deleted. Always stops and asks first.",
      actLaunch: "Open applications and documents",
      actLaunchDetail: "Open a file or start a program. It can't close anything or throw work away.",
      actGui: "Drive any application",
      actGuiDetail:
        "Move the pointer, click, type, press keys — anything you can do at this keyboard, in any " +
        "program. This is what lets me finish real work rather than just tidy files. Nothing I do " +
        "this way can be undone, so hard rules still stop and ask.",
    },
  },

  memory: {
    title: "What I know about your world",
    body: "Names, places and things I've worked out from watching. Delete anything that shouldn't be here.",
    forget: "Forget this",
    empty: "I haven't worked anything out yet.",
    learned: (when: string) => `Learned ${when}`,
  },

  /* --- Away Mode ------------------------------------------------------------------ */
  away: {
    title: "Going out",
    intro:
      "This is authority for one stretch of time, not a setting. " +
      "Pick what I may do, how far I may go, and when it lapses.",
    routinesLabel: "What I may run",
    routinesNote: "Only routines you've allowed to run while you're out.",
    routinesEmpty:
      "Nothing has passed the second graduation yet, so there's nothing I can do while you're out.",
    actionsLabel: "How many things I may do",
    durationLabel: "How long this lasts",
    keepAliveLabel: "Keep this machine awake",
    keepAliveNote: "Otherwise it may sleep and nothing will run until you're back.",
    summaryTitle: "So, to be clear",
    summary: (routines: number, actions: number, hours: number) =>
      `For the next ${hours} ${plural(hours, "hour", "hours")} I may run ${routines} ${plural(routines, "routine", "routines")} ` +
      `and do at most ${actions} things. After that I stop on my own.`,
    hardRules: "Anything that clears a file away, or that I can't undo, still waits for you.",
    grant: "Hand over the keys",
    active: "Away Mode is on",
    remaining: (mins: number) =>
      mins <= 0 ? "Authority has lapsed." : `${mins} ${plural(mins, "minute", "minutes")} of authority left.`,
    used: (actions: number, cap: number) => `${actions} of ${cap} things done.`,
    end: "I'm back",
    sinceTitle: "Since you left",
    sinceEmpty: "Nothing yet.",
  },

  /* --- Pocket ------------------------------------------------------------------------ */
  pocket: {
    title: "Pocket",
    dispatchTitle: "Send something to the machine",
    dispatchEmpty: "Nothing is authorised to run while you're out.",
    confirmBiometric: "Confirm it's you",
    confirmBody: "Hold to send",
    holding: "Keep holding",
    queued: "Waiting its turn",
    running: "Running now",
    needsYou: "Needs you",
    done: "Done",
    stopped: "Stopped cleanly",
    held: "Held",
    heldBody: "I'm paused, so I've kept your instruction. It'll go the moment you start me again.",
    empty: "Nothing in the queue.",
    emptySub: "Send something and it'll appear here.",
    approve: "Go ahead",
    skip: "Skip that bit",
    later: "I'll deal with it later",
    presenceOnline: "Your machine is awake",
    presenceOnlineSub: "Ready when you are.",
    presencePaused: "I'm paused",
    presencePausedSub: "Nothing is lost. Anything you send is held until you start me again.",
    presenceAway: "Away Mode is on",
    stopAll: "Stop everything",
    stopAllConfirm: "Stop everything and put back what you can?",
    resultTitle: "What I did",
    clear: "Clear the finished ones",
    custodyNote: "This window is paired to the machine it's running on. No password, no account.",
  },

  /* --- The account ------------------------------------------------------------------- */
  account: {
    title: "Your account",
    intro:
      "This holds who you are and which machines are yours. It doesn't hold what I've learned " +
      "about you — that lives on the machines themselves, and it stays there.",

    localTitle: "What is kept where",
    localBody:
      "The account is identity and a list of your devices. Everything I've actually learned — " +
      "your routines, the things you've taught me, what I remember of your work — sits on this " +
      "machine, in your own files. Signing out doesn't take it. Deleting the account doesn't " +
      "reach it.",

    signInTitle: "Sign in",
    signInBody:
      "Give me an email address and I'll send a link. No password unless you want one.",
    emailPlaceholder: "you@example.com",
    sendLink: "Send me a link",
    sending: "Sending",
    linkSent: (email: string) => `Sent to ${email}. The link is good for fifteen minutes.`,
    noMailProvider:
      "Nothing is actually sending email yet, so here's the link. Paste it below to sign in.",
    linkPlaceholder: "paste the link here",
    useLink: "Sign in",
    usePassword: "I'd rather use a password",
    useLinkInstead: "Send me a link instead",
    passwordPlaceholder: "your password",
    signInWithPassword: "Sign in",
    linkFailed: (why: string) =>
      why === "link_expired"
        ? "That link has expired. I'll send another."
        : why === "link_used"
          ? "That link has already been used."
          : "I didn't recognise that link.",
    unreachable:
      "I couldn't reach the account server. It runs alongside the app — start it with npm run server.",

    devicesTitle: "Your machines",
    devicesBody:
      "Each one is paired to the account and can be cut off from any of the others.",
    thisDevice: "this one",
    pairedWhen: (when: string) => `Paired ${when}`,
    lastSeen: (when: string) => `last seen ${when}`,
    revoke: "Cut this one off",
    revokeConfirm: "Cut it off? It stops being signed in immediately.",
    revokeThisConfirm: "That's the machine you're on. You'll be signed out here. Sure?",
    revokeCancel: "Leave it",
    revoked: "Done. It's no longer signed in.",

    sessionsTitle: "Signed in elsewhere",
    signOutAll: "Sign out everywhere else",
    signOutAllConfirm: "Sign out every other machine?",
    signedOutAll: (n: number) =>
      n === 0 ? "Nothing else was signed in." : `${n} signed out.`,
    signOutHere: "Sign out on this machine",

    exportTitle: "Take it with you",
    exportBody:
      "Everything the account holds, as a file. Your trained self is exported separately, " +
      "from the app itself — this is only the identity part.",
    exportCta: "Export my account",
    exported: (file: string) => `Saved to ${file}.`,

    deleteTitle: "Delete the account",
    deleteBody:
      "This removes your identity and every device pairing, permanently and immediately. " +
      "There's no grace period and I can't undo it. What I've learned stays on this machine " +
      "until you clear it separately.",
    deleteExportFirst: "Export it first",
    deleteCta: "Delete my account",
    deleteConfirm: "Delete the account and every pairing? This cannot be undone.",
    deleted: "Gone. Nothing of your identity is left on the server.",

    passwordTitle: "Add a password",
    passwordBody: "Optional. Ten characters or more.",
    passwordSet: "Password saved.",
    passwordTooShort: "That needs to be at least ten characters.",
  },

  /* --- The overlay ------------------------------------------------------------------- */
  overlay: {
    title: "The little one in the corner",
    body:
      "I sit in the bottom-right corner above everything else. Click me to start or stop " +
      "watching; right-click for everything else. Drag me somewhere better if I'm in the way.",
    home: "Put it back in the corner",
    watching: "watching",
    notWatching: "not watching",
    needsKey: "needs a key",
    working: "working",
    needsYou: "needs you",
    saw: "saw that",
    lookedAway: "looked away",
  },

  /* --- The mind ---------------------------------------------------------------------- */
  mind: {
    title: "What I'm thinking",
    intro:
      "This is the part of me that looks at your screen and works out what's going on, " +
      "and the memory it all goes into.",

    keyTitle: "Where my intelligence comes from",
    keyBody:
      "I use Claude Opus 5 to understand what I'm looking at. That needs a key from " +
      "platform.claude.com. It's kept on this machine and used for nothing else.",
    keyPlaceholder: "sk-ant-…",
    keySave: "Use this key",
    keyChecking: "Checking it works",
    keyGood: (hint: string) => `Working. Using the key ending ${hint}.`,
    keyFromEnv: "Using the key from your environment.",
    keyBad: (why: string) => `That didn't work: ${why}`,
    keyClear: "Forget the key",
    keyMissing: "Without a key I can still watch files and windows, but I can't understand a screen.",

    watchTitle: "Looking at the screen",
    watchBody:
      "When this is on I take a look every so often — when you change window, and " +
      "occasionally while you stay in one. I describe what I see, and that description " +
      "is what I remember.",
    autoWatch: "Look on my own",
    autoWatchOff: "Only when I ask",

    detailTitle: "How closely I read",
    detailThorough: "Every word",
    detailThoroughBody:
      "I read the screen properly — the headings, the row you're on, field values, error " +
      "messages word for word, and every figure I can make out. It costs perhaps three times " +
      "as much per look, and it's the difference between remembering that you did some invoice " +
      "work and remembering that invoice 4471 was £2,340 and short by twelve pounds.",
    detailLight: "The gist",
    detailLightBody: "A smaller picture and a shorter description. Cheaper, and much vaguer.",
    detailCost: (looks: number, tokens: number) =>
      looks === 0
        ? "I haven't looked at anything yet."
        : `${looks} looks so far, about ${tokens.toLocaleString()} tokens.`,

    privacyTitle: "What I refuse to write down",
    privacyBody:
      "Reading this closely means I could copy down things you'd never want kept. So a screen " +
      "with a password, card or account number, medical or legal detail, someone's private " +
      "messages, or an identity document is recorded as nothing but a moment that happened — " +
      "no description, no words, no entities. When I'm unsure I skip it rather than risk it.",
    lookNow: "Take a look now",
    looking: "Looking",
    lookFailed: (why: string) => `Couldn't: ${why}`,

    feedTitle: "What I've been seeing",
    feedEmpty: "I haven't looked at anything yet.",
    private: "Something private was on screen. I looked away.",

    brainTitle: "What I've kept",
    brainBody:
      "Everything I notice goes in here — the moments, the people and projects behind them, " +
      "and a summary of each hour so the old detail doesn't have to be kept forever.",
    brainStats: (episodes: number, entities: number, digests: number) =>
      `${episodes.toLocaleString()} moments, ${entities} things I know about, ${digests} summaries.`,
    brainEmpty: "Nothing in here yet.",
    consolidate: "Sum up the last hour",
    consolidating: "Thinking it over",
    consolidated: "Done. That hour is folded in.",
    consolidateThin: "Not enough happened in the last hour to be worth summarising.",
    forget: "Forget this",
    wipe: "Empty my memory",
    wipeConfirm: "Forget every moment, every summary, everything I know about your world?",

    recallTitle: "Ask what I remember",
    recallPlaceholder: "the invoice work, or Priya, or what was I doing on Tuesday",
    recallSearch: "Ask me",
    recallThinking: "Remembering",
    recallEmpty: "Nothing in memory matches that.",
    recallShowRaw: "Show me what that came from",
    recallRawTitle: "The records behind that answer",
    recallNote: (tokens: number) =>
      `This is what I'd hand myself before starting a task about it — about ${tokens} tokens of context.`,

    storageTitle: "How I keep it",
    storageBody:
      "I don't keep my memories as English. Each one is embedded into a 384-number vector by a " +
      "small model running on this machine, squeezed to a byte per number, and searched by " +
      "meaning — so asking about \"the reconciliation\" finds the right moment even when I never " +
      "used that word. A year of watching is about twenty megabytes. The English you're reading " +
      "is written back out only when you ask.",
    storageStats: (count: number, bytes: number) =>
      count === 0
        ? "Nothing embedded yet."
        : `${count.toLocaleString()} memories embedded, ${(bytes / 1024 / 1024).toFixed(1)}MB of vectors.`,
    storageOffline:
      "The embedding model isn't loaded, so I'm searching by words alone for now. It downloads " +
      "itself once, the first time I have something to remember.",
  },

  /* --- The agent --------------------------------------------------------------------- */
  agent: {
    title: "Ask me to do something",
    intro:
      "Tell me what you want done and I'll do it on this machine — your applications, " +
      "your files, your logged-in sessions. I'll show you every step as I go.",
    placeholder: "Tidy the screenshots on my desktop into a folder for this month",
    go: "Do it",
    running: (step: number) => `Working — step ${step}`,
    needsGui:
      "I can't drive applications yet. Switch that on in Permissions and I'll be able to " +
      "do anything you can do at the keyboard.",
    needsKey: "I need a key before I can do this.",
    stop: "Stop",
    stopping: "Stopping",
    parkedTitle: "I've stopped to ask.",
    approve: "Go ahead",
    skip: "Skip that bit",
    abandon: "Stop here",
    doneTitle: "That's done.",
    stoppedTitle: "I stopped.",
    changedLabel: "What changed",
    incompleteLabel: "What I didn't finish",
    nothingChanged: "Nothing changed.",
    irreversible: "Some of this drove your applications directly, so I can't undo it.",
    recalled: (n: number) => `I started with ${n} things I already knew.`,
    empty: "Nothing running.",
    emptySub: "Ask me for something and you'll see every step here.",
    history: "Things I've done",
  },

  /* --- Diagnostics ------------------------------------------------------------------- */
  panel: {
    title: "Under the bonnet",
    note: "Not part of the product. A window onto what I'm actually seeing.",
    mine: "Work out routines now",
    windows: "List open windows",
    trash: "Open my trash",
    state: "Show my memory file",
    reset: "Forget everything",
    resetConfirm: "Forget every routine, run and observation, and start again?",
    hide: "Press D to hide.",
  },

  /* --- Shared bits ------------------------------------------------------------------------ */
  common: {
    confidence: "Confidence",
    steps: (n: number) => `${n} ${plural(n, "step", "steps")}`,
  },
};

export const HARD_RULE_SENTENCE: Record<HardRuleKind, string> = {
  delete: "This clears something away. I never do that quietly.",
  irreversible: "I can't undo this one afterwards, so I'd rather you said.",
  outside: "This is outside the folders you've allowed me.",
  gui: "This drives another application, which I can't undo.",
  files: "This changes files, and that isn't switched on yet.",
  unknown: "I don't understand this one well enough to do it.",
};

export type Voice = typeof voice;
