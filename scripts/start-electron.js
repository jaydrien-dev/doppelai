#!/usr/bin/env node
/**
 * Launch Electron with a clean environment.
 *
 * VS Code's extension host exports ELECTRON_RUN_AS_NODE=1, and any Electron
 * process started from a VS Code terminal inherits it — which makes Electron
 * boot as plain Node, so `app` is undefined and nothing renders. Stripping it
 * here means `npm run dev` works the same from any terminal.
 */

const { spawn } = require("node:child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(electron, [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("close", (code) => process.exit(code ?? 0));
