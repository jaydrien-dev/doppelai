const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/** The whole surface the interface gets. Nothing else crosses. */
contextBridge.exposeInMainWorld("mimic", {
  isDesktop: true,
  platform: process.platform,

  /* windows */
  openPocket: () => invoke("mimic:open-pocket"),
  closeWindow: () => invoke("mimic:close-window"),

  /* the overlay */
  overlayOpen: (route) => invoke("overlay:open", route),
  overlayMenu: () => invoke("overlay:menu"),
  overlayToggleWatch: () => invoke("overlay:toggleWatch"),
  overlaySetEnabled: (on) => invoke("overlay:setEnabled", on),
  overlayHome: () => invoke("overlay:home"),

  /* live state */
  getState: () => invoke("state:get"),
  getRun: () => invoke("run:get"),
  onState: (fn) => {
    const handler = (_e, state) => fn(state);
    ipcRenderer.on("mimic:state", handler);
    return () => ipcRenderer.removeListener("mimic:state", handler);
  },
  onRun: (fn) => {
    const handler = (_e, run) => fn(run);
    ipcRenderer.on("mimic:run", handler);
    return () => ipcRenderer.removeListener("mimic:run", handler);
  },
  onAgent: (fn) => {
    const handler = (_e, task) => fn(task);
    ipcRenderer.on("mimic:agent", handler);
    return () => ipcRenderer.removeListener("mimic:agent", handler);
  },
  onNarration: (fn) => {
    const handler = (_e, line) => fn(line);
    ipcRenderer.on("mimic:narration", handler);
    return () => ipcRenderer.removeListener("mimic:narration", handler);
  },

  /* the mind */
  setApiKey: (key) => invoke("ai:setKey", key),
  clearApiKey: () => invoke("ai:clearKey"),
  setAutoWatch: (on) => invoke("ai:setAutoWatch", on),
  setDetail: (level) => invoke("ai:setDetail", level),
  lookNow: () => invoke("vision:look"),

  /* the brain */
  recall: (query) => invoke("brain:recall", query),
  askBrain: (question) => invoke("brain:ask", question),
  forgetMoments: (ids) => invoke("brain:forgetMoments", ids),
  brainEntities: () => invoke("brain:entities"),
  brainEpisodes: (limit) => invoke("brain:episodes", limit),
  brainStats: () => invoke("brain:stats"),
  brainForget: (id) => invoke("brain:forget", id),
  consolidate: (scope) => invoke("brain:consolidate", scope),
  wipeBrain: () => invoke("brain:wipe"),

  /* the agent */
  getAgent: () => invoke("agent:get"),
  runAgent: (input) => invoke("agent:run", input),
  answerAgent: (choice) => invoke("agent:answer", choice),
  abortAgent: () => invoke("agent:abort"),

  /* observation */
  setPaused: (paused) => invoke("obs:pause", paused),
  setPermissions: (patch) => invoke("obs:permissions", patch),
  addRoot: () => invoke("obs:addRoot"),
  removeRoot: (root) => invoke("obs:removeRoot", root),

  /* teaching */
  armTeaching: () => invoke("teach:arm"),
  cancelTeaching: () => invoke("teach:cancel"),
  finishTeaching: () => invoke("teach:finish"),
  mineNow: () => invoke("mine:now"),

  /* routines */
  setProvingRuns: (id, n) => invoke("routine:setProvingRuns", id, n),
  graduate: (id) => invoke("routine:graduate", id),
  grantUnattended: (id) => invoke("routine:grantUnattended", id),
  revokeUnattended: (id) => invoke("routine:revokeUnattended", id),
  demote: (id) => invoke("routine:demote", id),
  relearn: (id) => invoke("routine:relearn", id),
  dismissDrift: (id) => invoke("routine:dismissDrift", id),
  forgetRoutine: (id) => invoke("routine:forget", id),

  /* runs */
  startRun: (id, opts) => invoke("run:start", id, opts),
  pauseRun: () => invoke("run:pause"),
  resumeRun: () => invoke("run:resume"),
  stepBack: () => invoke("run:stepBack"),
  openCorrection: () => invoke("run:openCorrection"),
  closeCorrection: () => invoke("run:closeCorrection"),
  correct: (patch) => invoke("run:correct", patch),
  resolvePark: (choice) => invoke("run:resolvePark", choice),
  yieldRun: () => invoke("run:yield"),
  resolveYield: (choice) => invoke("run:resolveYield", choice),
  abortRun: () => invoke("run:abort"),

  /* ledger */
  rollback: (runId) => invoke("ledger:rollback", runId),
  exportWeek: () => invoke("ledger:export"),
  revealTrash: () => invoke("ledger:revealTrash"),

  /* away + pocket */
  grantAway: (input) => invoke("away:grant", input),
  endAway: () => invoke("away:end"),
  dispatch: (routineId) => invoke("pocket:dispatch", routineId),
  answerJob: (jobId, choice) => invoke("pocket:answer", jobId, choice),
  stopAll: () => invoke("pocket:stopAll"),
  clearJobs: () => invoke("pocket:clear"),

  /* the account */
  requestLink: (email) => invoke("account:requestLink", email),
  verifyLink: (token) => invoke("account:verifyLink", token),
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

  /* memory + misc */
  forgetEntity: (id) => invoke("memory:forget", id),
  listWindows: () => invoke("windows:list"),
  reset: () => invoke("app:reset"),
  appPaths: () => invoke("app:paths"),
  revealPath: (target) => invoke("app:revealPath", target),
});
