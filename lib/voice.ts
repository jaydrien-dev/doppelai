
/**
 * Every string Doppel itself says lives here.
 *
 * The voice: first person, warm, understated, slightly dry. Short sentences.
 * Admits uncertainty freely. Reports what it did; never praises itself.
 * No exclamation marks. No emoji. Never "I'm just an AI".
 *
 * Doppel is a personal execution engine. It observes how you work, works
 * while you work, and works while you don't. It stores intent, not clicks.
 * It knows when you do things, not just what. It gets better while you're
 * doing nothing.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const voice = {
  /* --- First run ----------------------------------------------------------- */
  first: {
    title: "I don't know anything yet.",
    body:
      "I've started watching. Work the way you normally would — I'll learn how you work, " +
      "your rhythm, and your patterns. It takes a few goes before I'll say anything.",
    watching: (n: number) =>
      n === 0
        ? "I'm not watching any folders yet."
        : `I'm watching ${n} ${plural(n, "folder", "folders")} and whatever window you're in.`,
    teach: "Ask me to do something and I'll get started.",
    browser:
      "This is the desktop app's interface running in a browser, so there's nothing for me to watch. " +
      "Open Doppel proper and I'll be able to see your work.",
  },

  /* --- Onboarding --------------------------------------------------------- */
  onboarding: {
    welcome: "Hi. I'm Doppel.",
    welcomeBody:
      "I watch how you work and learn to help. I can organize files, look things up, " +
      "remember what you were doing, and eventually do tasks for you. Let's get me set up.",
    stepKey: "Connect to AI",
    stepKeyBody:
      "I use Gemini to understand what's on your screen. " +
      "You'll need a key from Google AI Studio — it takes about 30 seconds to get one.",
    stepKeyLink: "Get a key from aistudio.google.com",
    stepScreen: "Let me see your screen",
    stepScreenBody:
      "This is what makes me useful. Without it, I can only see file names and window titles. " +
      "With it, I actually understand what you're working on.",
    stepScreenNote:
      "Screenshots go to the AI to be described, then the screenshot is deleted. " +
      "I skip anything that looks private — passwords, bank details, personal messages.",
    stepFolder: "Pick a folder to watch",
    stepFolderBody:
      "Choose where you do your work. I'll watch for new files, moves, and renames " +
      "inside this folder. I can't see anything outside it.",
    stepDone: "You're all set.",
    stepDoneBody:
      "I'll start learning how you work. The more you use your computer normally, " +
      "the more useful I become. Try asking me something when you're ready.",
    getStarted: "Get started",
    next: "Next",
    done: "Start watching",
    skip: "Skip for now",
  },

  /* --- Suggested actions -------------------------------------------------- */
  suggestions: {
    title: "Try asking me",
    items: [
      { label: "What am I looking at?", instruction: "Look at my screen and describe what I'm working on right now." },
      { label: "Organize my desktop", instruction: "Look at my desktop and organize the files into sensible folders by type or project." },
      { label: "Summarize my day", instruction: "What have I been doing today? Give me a summary of my work." },
      { label: "Find a file I was using", instruction: "Search my memory for files I was recently working with and list them." },
      { label: "Research something", instruction: "I need you to research something for me on the web." },
    ],
  },

  /* --- Agent history ------------------------------------------------------ */
  history: {
    title: "Things I've done",
    empty: "Nothing yet. Ask me to do something and it'll show up here.",
    showMore: "Show more",
  },

  /* --- The Den ------------------------------------------------------------- */
  den: {
    watchingNow: (what: string) => `Right now I'm watching ${what}.`,
    watchingNothing: "Nothing much is happening. I'm here if that changes.",
    idle: (app: string) => `You're in ${app}. Nothing worth noting yet.`,
    paused: "I've stopped watching. Nothing is being recorded.",
    pausedSub: "Turn me back on whenever you want. I won't mind the gap.",
    lastTick: (mins: number) =>
      mins < 1 ? "Last saw something just now." : `Last saw something ${mins} ${plural(mins, "minute", "minutes")} ago.`,
    seen: (events: number, sessions: number) =>
      `${events.toLocaleString()} ${plural(events, "thing", "things")} noticed, in ${sessions} ${plural(sessions, "stretch", "stretches")} of work.`,
    inputPlaceholder: "Ask me something or tell me what to do",
    recentlyTitle: "What I've been noticing",
  },

  /* --- Permissions & memory ----------------------------------------------------- */
  permissions: {
    intro: "Here's what I can see and what I can do without asking first.",
    localTitle: "What stays here, and what doesn't",
    localBody:
      "Everything happens on this machine, in your own windows and your own logged-in sessions. " +
      "No service has to agree to let me in. I work with software that has no API and never will — " +
      "legacy portals, government systems, industry tools from 2009. Nothing about your files, " +
      "windows or clipboard ever leaves.",
    localScreen:
      "The exception is reading the screen. To understand what I'm looking at I send the " +
      "screenshot to Google's Gemini API to be described, and keep only the description. That happens " +
      "solely while you have it switched on, and never for a screen I judge to be private. " +
      "Everything else here is local.",
    localScreenOff:
      "Reading the screen is switched off, so nothing at all is leaving this machine right now.",
    watchTitle: "What I watch",
    actTitle: "What I may do without asking",
    displayTitle: "Which screen I watch",
    displayNote: "I only look at one display at a time. Pick the one where you do most of your work.",
    displayPrimary: "Primary",
    displayAuto: "Auto (primary display)",
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
        "This is what makes me useful rather than merely observant — the difference " +
        "between knowing you opened Excel and knowing you were reconciling October invoices " +
        "and got stuck on a formula. Screenshots go to Claude to be described, and only the " +
        "description is kept. Anything that looks private is skipped without being written down.",
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

    renameTitle: "Rename this machine",
    renameBody: "The name other devices see for this one.",
    renamed: "Renamed.",

    serverTitle: "Identity server",
    serverBody:
      "Where your account lives. The default is your own machine. " +
      "Change this only if you're running the server somewhere else.",
    serverUpdated: "Server updated.",
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
      "and the memory it all goes into. I remember why, not just what.",

    keyTitle: "Where my intelligence comes from",
    keyBody:
      "I use Gemini 3.6 Flash to understand what I'm looking at. That needs a key from " +
      "aistudio.google.com. It's kept on this machine and used for nothing else.",
    keyPlaceholder: "AIza…",
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

  /* --- Patterns — things you do repeatedly ------------------------------------------ */
  patterns: {
    title: "Things you do",
    empty: "I haven't spotted any patterns yet. Keep working and I'll notice.",
    count: (n: number) => `${n} ${plural(n, "time", "times")}`,
  },

  /* --- Morning Brief ----------------------------------------------------------------- */
  brief: {
    title: "Your morning brief",
    generating: "Writing your brief",
    notReady: "I haven't watched enough yet to write a brief. Give me a few days.",
    noKey: "I need a key before I can write a brief.",
    yesterday: "Yesterday",
    patterns: "Patterns I've noticed",
    connections: "Dots I've connected",
    openThreads: "Open threads",
    suggestion: "My suggestion for today",
    refresh: "Write a new one",
  },

  /* --- Timeline search -------------------------------------------------------------- */
  timeline: {
    title: "Timeline",
    intro: "Everything I've seen, day by day. Search by words, numbers, or meaning.",
    empty: "Nothing recorded yet.",
    searchPlaceholder: "Search what I remember",
    today: "Today",
    noResults: "Nothing matches that search.",
    sensitive: "Something private was on screen.",
    dateLabel: (date: string) => {
      const d = new Date(date + "T12:00:00");
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const isYesterday =
        d.toDateString() === new Date(Date.now() - 86400000).toDateString();
      if (isToday) return "Today";
      if (isYesterday) return "Yesterday";
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    },
    count: (n: number) => `${n} ${n === 1 ? "moment" : "moments"}`,
  },

  /* --- Security — biometric lock ---------------------------------------------------- */
  security: {
    title: "Biometric lock",
    body:
      "Require biometric authentication (face, fingerprint, or PIN) to access Doppel. " +
      "Your brain data is already encrypted at rest — this adds a second barrier.",
    enable: "Turn on",
    disable: "Turn off",
    locked: "Locked",
    unlock: "Unlock with biometrics",
    unlocking: "Verifying",
    lockNow: "Lock now",
    unavailable:
      "Biometric authentication isn't set up on this machine. " +
      "Set it up in your system settings, then come back.",
    failed: "Verification failed. Try again.",
    timeout: "Auto-lock after inactivity",
    timeoutNone: "Only when I restart",
    timeoutMinutes: (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`,
  },

  /* --- Nudges — proactive suggestions ----------------------------------------------- */
  nudge: {
    memory: "I've seen this before.",
    stuck: "You've been here a while.",
    taskEnd: "Looks like that's done.",
    openThread: "Something was left unfinished.",
    offer: "I could do this for you.",
    dismiss: "Dismiss",
    showMe: "Show me",
    doIt: "Do it",
    tellMore: "Tell me more",
  },

  /* --- The whisper panel -------------------------------------------------------------- */
  whisper: {
    title: "Voice hotkey",
    body:
      "Press the hotkey anywhere and ask me something. I'll answer from what I remember.",
    idle: "Ask me anything",
    listening: "Listening",
    transcribing: "Transcribing",
    thinking: "Thinking",
    noSpeech: "I didn't catch that.",
    needsKey: "Add an OpenAI key in Permissions to use voice",
    dismiss: "Got it",
    home: "Move back to the top",
    openaiTitle: "Voice transcription",
    openaiBody:
      "I use OpenAI Whisper to turn your speech into text. That needs a key from " +
      "platform.openai.com. It's kept on this machine and used for nothing else.",
    openaiPlaceholder: "sk-…",
    openaiSave: "Use this key",
    openaiGood: (hint: string) => `Working. Using the key ending ${hint}.`,
    openaiClear: "Forget the key",
    openaiMissing: "Without this key I can still take typed questions, but I can't listen.",
  },

  /* --- Add-ons ------------------------------------------------------------------- */
  store: {
    title: "Add-ons",
    intro: "More tools for me to work with. Each one gives me a new capability.",
    installed: "Installed",
    available: "Available",
    enable: "Enable",
    disable: "Disable",
    install: "Install",
    configure: "Configure",
    configSave: "Save",
    connect: "Connect",
    connected: "Connected",
    disconnect: "Disconnect",
    connecting: "Connecting\u2026",
    connectError: "Couldn't connect. Try again.",
    noConfig: "Nothing to configure.",
    noAddons: "Nothing here yet.",
    builtin: "Built-in",
    tools: (n: number) => `${n} ${n === 1 ? "tool" : "tools"}`,
    permissions: (perms: string[]) => perms.length ? `Needs: ${perms.join(", ")}` : "",
  },

  /* --- Diagnostics ------------------------------------------------------------------- */
  panel: {
    title: "Under the bonnet",
    note: "Not part of the product. A window onto what I'm actually seeing.",
    windows: "List open windows",
    trash: "Open my trash",
    state: "Show my memory file",
    reset: "Forget everything",
    resetConfirm: "Forget everything and start again?",
    hide: "Press D to hide.",
  },

  /* --- Shared bits ------------------------------------------------------------------------ */
  common: {
    confidence: "Confidence",
    steps: (n: number) => `${n} ${plural(n, "step", "steps")}`,
  },
};

export type Voice = typeof voice;
