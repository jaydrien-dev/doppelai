const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/** The whole surface the interface gets. Nothing else crosses. */
contextBridge.exposeInMainWorld("doppel", {
  isDesktop: true,
  platform: process.platform,

  /* windows */
  closeWindow: () => invoke("doppel:close-window"),

  /* the overlay */
  overlayOpen: (route) => invoke("overlay:open", route),
  overlayMenu: () => invoke("overlay:menu"),
  overlayToggleWatch: () => invoke("overlay:toggleWatch"),
  overlayToggleWhisper: () => invoke("overlay:toggleWhisper"),
  overlayShowTasks: () => invoke("task:show"),
  overlaySetEnabled: (on) => invoke("overlay:setEnabled", on),
  overlaySetBarHeight: (h) => invoke("overlay:setBarHeight", h),
  overlayHome: () => invoke("overlay:home"),
  onOverlayMode: (fn) => {
    const handler = (_e, mode) => fn(mode);
    ipcRenderer.on("doppel:overlay-mode", handler);
    return () => ipcRenderer.removeListener("doppel:overlay-mode", handler);
  },

  /* live state */
  getState: () => invoke("state:get"),
  onState: (fn) => {
    const handler = (_e, state) => fn(state);
    ipcRenderer.on("doppel:state", handler);
    return () => ipcRenderer.removeListener("doppel:state", handler);
  },
  onNarration: (fn) => {
    const handler = (_e, line) => fn(line);
    ipcRenderer.on("doppel:narration", handler);
    return () => ipcRenderer.removeListener("doppel:narration", handler);
  },
  onNudge: (fn) => {
    const handler = (_e, nudges) => fn(nudges);
    ipcRenderer.on("doppel:nudge", handler);
    return () => ipcRenderer.removeListener("doppel:nudge", handler);
  },
  onAnswerStream: (fn) => {
    const handler = (_e, delta) => fn(delta);
    ipcRenderer.on("doppel:answer-stream", handler);
    return () => ipcRenderer.removeListener("doppel:answer-stream", handler);
  },
  onThinkingStream: (fn) => {
    const handler = (_e, delta) => fn(delta);
    ipcRenderer.on("doppel:thinking-stream", handler);
    return () => ipcRenderer.removeListener("doppel:thinking-stream", handler);
  },

  /* the mind */
  setApiKey: (key) => invoke("ai:setKey", key),
  clearApiKey: () => invoke("ai:clearKey"),
  setOpenAIKey: (key) => invoke("ai:setOpenAIKey", key),
  clearOpenAIKey: () => invoke("ai:clearOpenAIKey"),
  setTypeSafeKey: (key) => invoke("ai:setTypeSafeKey", key),
  clearTypeSafeKey: () => invoke("ai:clearTypeSafeKey"),
  transcribeAudio: (buffer, prompt) => invoke("whisper:transcribe", buffer, prompt),
  whisperAsk: (buffer, history) => invoke("whisper:ask", buffer, history),
  classifyIntent: (text) => invoke("ai:classifyIntent", text),
  routeVoice: (text) => invoke("ai:routeVoice", text),
  isHallucination: (text) => invoke("ai:isHallucination", text),
  setAutoWatch: (on) => invoke("ai:setAutoWatch", on),
  setDetail: (level) => invoke("ai:setDetail", level),
  lookNow: () => invoke("vision:look"),

  /* the brain */
  recall: (query) => invoke("brain:recall", query),
  askBrain: (question, history) => invoke("brain:ask", question, history),
  askBrainFast: (question, history) => invoke("brain:ask-fast", question, history),
  forgetMoments: (ids) => invoke("brain:forgetMoments", ids),
  brainEntities: () => invoke("brain:entities"),
  brainEpisodes: (limit) => invoke("brain:episodes", limit),
  brainAvailableDates: () => invoke("brain:availableDates"),
  brainEpisodesForDate: (date) => invoke("brain:episodesForDate", date),
  brainStats: () => invoke("brain:stats"),
  brainForget: (id) => invoke("brain:forget", id),
  consolidate: (scope) => invoke("brain:consolidate", scope),
  brainPatterns: () => invoke("brain:patterns"),
  morningBrief: () => invoke("brain:morningBrief"),
  morningBriefCached: () => invoke("brain:morningBriefCached"),
  exportBrain: () => invoke("brain:export"),
  importBrain: () => invoke("brain:import"),
  wipeBrain: () => invoke("brain:wipe"),
  userProfile: () => invoke("profile:get"),
  generateProfile: () => invoke("profile:generate"),
  ingestDocument: (filePath) => invoke("brain:ingest", filePath),
  ingestSupported: () => invoke("brain:ingestSupported"),

  /* observation */
  setPaused: (paused) => invoke("obs:pause", paused),
  setPermissions: (patch) => invoke("obs:permissions", patch),
  addRoot: () => invoke("obs:addRoot"),
  removeRoot: (root) => invoke("obs:removeRoot", root),
  listDisplays: () => invoke("obs:displays"),
  setDisplay: (displayId) => invoke("obs:setDisplay", displayId),

  /* the account */
  requestLink: (email) => invoke("account:requestLink", email),
  verifyLink: (token) => invoke("account:verifyLink", token),
  register: (email, password) => invoke("account:register", { email, password }),
  resetPassword: (token, password) => invoke("account:resetPassword", { token, password }),
  signInWithPassword: (email, password) => invoke("account:password", { email, password }),
  setAccountPassword: (password) => invoke("account:setPassword", password),
  accountOverview: () => invoke("account:overview"),
  revokeAccountDevice: (id) => invoke("account:revokeDevice", id),
  signOutEverywhere: (keep) => invoke("account:signOutEverywhere", keep),
  signOut: () => invoke("account:signOut"),
  setAccountServer: (url) => invoke("account:setServer", url),
  renameDevice: (name) => invoke("account:renameDevice", name),
  exportAccount: () => invoke("account:export"),
  deleteAccount: () => invoke("account:delete"),

  /* the whisper panel */
  whisperSetEnabled: (on) => invoke("whisper:setEnabled", on),
  whisperHome: () => invoke("whisper:home"),
  whisperSetAutoDismiss: (sec) => invoke("whisper:setAutoDismiss", sec),
  whisperHide: () => invoke("whisper:hide"),
  whisperSetMicSensitivity: (level) => invoke("whisper:setMicSensitivity", level),
  whisperSaveChat: (question, answer) => invoke("whisper:saveChat", question, answer),
  whisperChatHistory: () => invoke("whisper:chatHistory"),

  /* add-ons */
  listAddons: () => invoke("addons:list"),
  installAddon: (id) => invoke("addons:install", id),
  uninstallAddon: (id) => invoke("addons:uninstall", id),
  enableAddon: (id) => invoke("addons:enable", id),
  disableAddon: (id) => invoke("addons:disable", id),
  setAddonConfig: (id, key, value) => invoke("addons:setConfig", id, key, value),
  addonAuth: (id) => invoke("addons:auth", id),
  addonDisconnect: (id) => invoke("addons:disconnect", id),

  /* nudges */
  getNudges: () => invoke("nudge:active"),
  dismissNudge: (id) => invoke("nudge:dismiss", id),
  actOnNudge: (id) => invoke("nudge:act", id),
  nudgeSetEnabled: (on) => invoke("nudge:setEnabled", on),

  /* inbox — task queue for external agents */
  workflowList: () => invoke("workflow:list"),
  workflowCreate: (title, steps, onFailure) => invoke("workflow:create", title, steps, onFailure),
  workflowAbort: (id) => invoke("workflow:abort", id),

  inboxList: () => invoke("inbox:list"),
  inboxCreate: (instruction, autoApprove, target) => invoke("inbox:create", instruction, autoApprove, target),
  inboxApprove: (id) => invoke("inbox:approve", id),
  inboxReject: (id) => invoke("inbox:reject", id),
  inboxRetry: (id) => invoke("inbox:retry", id),
  inboxClear: () => invoke("inbox:clear"),

  /* security / biometric */
  securityAvailable: () => invoke("security:available"),
  securityStatus: () => invoke("security:status"),
  securityVerify: () => invoke("security:verify"),
  securitySetBiometric: (on) => invoke("security:setBiometric", on),
  securitySetLockTimeout: (min) => invoke("security:setLockTimeout", min),
  securityLock: () => invoke("security:lock"),
  onUnlocked: (fn) => {
    const handler = (_e, unlocked) => fn(unlocked);
    ipcRenderer.on("doppel:unlocked", handler);
    return () => ipcRenderer.removeListener("doppel:unlocked", handler);
  },

  /* resume */
  resumeLast: () => invoke("app:resumeLast"),

  /* MCP integration */
  mcpSnippet: () => invoke("mcp:snippet"),
  relayStatus: () => invoke("relay:status"),
  onRelay: (fn) => {
    const handler = (_e, status) => fn(status);
    ipcRenderer.on("doppel:relay", handler);
    return () => ipcRenderer.removeListener("doppel:relay", handler);
  },

  /* memory + misc */
  forgetEntity: (id) => invoke("memory:forget", id),
  listWindows: () => invoke("windows:list"),
  reset: () => invoke("app:reset"),
  appPaths: () => invoke("app:paths"),
  revealPath: (target) => invoke("app:revealPath", target),

  /* guide — Clicky-style walkthroughs */
  guideFindElement: (desc) => invoke("guide:findElement", desc),
  guidePointAt: (x, y, instruction) => invoke("guide:pointAt", x, y, instruction),
  guideClearPointer: () => invoke("guide:clearPointer"),
  guideStartWalkthrough: (goal) => invoke("guide:startWalkthrough", goal),
  guideNextStep: () => invoke("guide:nextStep"),
  guidePrevStep: () => invoke("guide:prevStep"),
  guideEndWalkthrough: () => invoke("guide:endWalkthrough"),
  guideDoStep: () => invoke("guide:doStep"),
  guideGetState: () => invoke("guide:getState"),
  onGuidePoint: (fn) => {
    const handler = (_e, data) => fn(data);
    ipcRenderer.on("guide:point", handler);
    return () => ipcRenderer.removeListener("guide:point", handler);
  },
  onGuideClear: (fn) => {
    const handler = (_e, data) => fn(data);
    ipcRenderer.on("guide:clear", handler);
    return () => ipcRenderer.removeListener("guide:clear", handler);
  },
  onGuideWalkthrough: (fn) => {
    const handler = (_e, data) => fn(data);
    ipcRenderer.on("guide:walkthrough", handler);
    return () => ipcRenderer.removeListener("guide:walkthrough", handler);
  },
  onGuideInstruction: (fn) => {
    const handler = (_e, data) => fn(data);
    ipcRenderer.on("guide:instruction", handler);
    return () => ipcRenderer.removeListener("guide:instruction", handler);
  },

  /* task popup */
  taskPopupEmpty: () => invoke("task:empty"),

  /* computer bots */
  computerCreate: (goal) => invoke("computer:create", goal),
  computerRespond: (id, answer) => invoke("computer:respond", id, answer),
  computerStop: (id) => invoke("computer:stop", id),
  computerList: () => invoke("computer:list"),
  computerStatus: (id) => invoke("computer:status", id),
  computerClear: (id) => invoke("computer:clear", id),
  computerConfigured: () => invoke("computer:configured"),
  onBotUpdate: (fn) => {
    const handler = (_e, bot) => fn(bot);
    ipcRenderer.on("doppel:bot-update", handler);
    return () => ipcRenderer.removeListener("doppel:bot-update", handler);
  },

  /* license gates */
  gatesFeatures: () => invoke("gates:features"),

  /* billing */
  billingStatus: () => invoke("billing:status"),
  billingPlans: () => invoke("billing:plans"),
  billingCosts: () => invoke("billing:costs"),
  billingHistory: (limit) => invoke("billing:history", limit),
  billingTokenPacks: () => invoke("billing:tokenPacks"),
  billingSetPlan: (plan) => invoke("billing:setPlan", plan),
  billingAddTokens: (amount) => invoke("billing:addTokens", amount),
  billingCheckout: (priceId) => invoke("billing:checkout", priceId),
  billingVerifyPurchase: (sessionId) => invoke("billing:verifyPurchase", sessionId),

  /* updates */
  getUpdateStatus: () => invoke("update:status"),
  checkForUpdate: () => invoke("update:check"),
  installUpdate: () => invoke("update:install"),
  onUpdate: (fn) => {
    const handler = (_e, status) => fn(status);
    ipcRenderer.on("doppel:update", handler);
    return () => ipcRenderer.removeListener("doppel:update", handler);
  },
});
