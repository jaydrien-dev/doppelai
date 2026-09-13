const { spawn } = require("node:child_process");
const path = require("node:path");
const db = require("./db");

/**
 * Windows Hello biometric gating.
 *
 * When enabled, Doppel starts locked. The user verifies via Windows Hello
 * (face, fingerprint, or PIN) to unlock. The lock state is in-memory only —
 * restarting the app re-locks it.
 *
 * The PowerShell script uses the UWP UserConsentVerifier API, which works
 * on any Windows 10+ machine with Windows Hello configured.
 */

const PS = "powershell.exe";
const SCRIPT = path.join(__dirname, "ps", "verify-identity.ps1");
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

const supported = process.platform === "win32";

/** In-memory lock state — never persisted. */
let locked = false;
let lastVerified = 0;

/* -------------------------------------------------------------------- init */

/**
 * Call once at startup. If biometric lock is enabled, start locked.
 */
function init() {
  const s = db.get();
  if (s.security?.biometric) {
    locked = true;
  }
}

/* ---------------------------------------------------------- availability */

/**
 * Check whether Windows Hello is available on this machine.
 * Spawns the PS script in check-only mode by reading its output.
 */
function checkAvailable() {
  if (!supported) {
    return Promise.resolve({ available: false, detail: "Only supported on Windows." });
  }

  return new Promise((resolve) => {
    /* We spawn the full script — it checks availability first and if not
       available, returns immediately without prompting. To avoid prompting
       just for a check, we use a separate lightweight approach: spawn the
       script and if it prompts, kill it. But simpler: the script always
       checks availability first, so we can read from it. However, if the
       device IS available, it will prompt. So we need a check-only path.

       Simpler: just run a quick PowerShell one-liner that only checks. */
    const check = spawn(PS, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command",
      `try {
        Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'
        [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime] | Out-Null
        $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
        $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1).MakeGenericMethod($op.GetType().GetInterfaces()[0].GenericTypeArguments[0])
        $t = $asTask.Invoke($null, @($op)); $t.Wait()
        Write-Output ((@{ available = ($t.Result -eq [Windows.Security.Credentials.UI.UserConsentVerifierAvailability]::Available); detail = [string]$t.Result } | ConvertTo-Json -Compress))
      } catch {
        Write-Output ((@{ available = $false; detail = $_.Exception.Message } | ConvertTo-Json -Compress))
      }`,
    ], { windowsHide: true });

    let out = "";
    check.stdout.on("data", (c) => (out += c));
    check.on("close", () => {
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        resolve({ available: false, detail: out.trim() || "Check failed." });
      }
    });
    check.on("error", () => resolve({ available: false, detail: "Could not run PowerShell." }));
  });
}

/* ---------------------------------------------------------- verification */

/**
 * Prompt Windows Hello. Resolves { ok, method, detail }.
 */
function verify() {
  if (!supported) {
    return Promise.resolve({ ok: false, method: "none", detail: "Only supported on Windows." });
  }

  return new Promise((resolve) => {
    const child = spawn(PS, [...PS_ARGS, SCRIPT], { windowsHide: true });

    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));

    child.on("close", () => {
      const line = out.trim().split("\n").filter(Boolean).pop();
      if (!line) {
        resolve({ ok: false, method: "none", detail: err.trim() || "No response." });
        return;
      }
      try {
        const result = JSON.parse(line);
        if (result.ok) {
          locked = false;
          lastVerified = Date.now();
        }
        resolve(result);
      } catch {
        resolve({ ok: false, method: "none", detail: line.slice(0, 200) });
      }
    });

    child.on("error", (e) => {
      resolve({ ok: false, method: "none", detail: e.message });
    });
  });
}

/* ------------------------------------------------------------ lock state */

function isLocked() {
  const s = db.get();
  if (!s.security?.biometric) return false;

  /* Auto-relock after timeout (if set). */
  const timeout = s.security.lockTimeout ?? 0;
  if (timeout > 0 && lastVerified > 0) {
    const elapsed = (Date.now() - lastVerified) / 60_000;
    if (elapsed >= timeout) locked = true;
  }

  return locked;
}

function lock() {
  locked = true;
  lastVerified = 0;
}

/**
 * Enable or disable biometric lock. Requires verification to enable.
 */
async function setEnabled(on) {
  if (on) {
    /* Verify before enabling, so we know the hardware works. */
    const result = await verify();
    if (!result.ok) return { ok: false, detail: result.detail };

    db.update((s) => {
      if (!s.security) s.security = {};
      s.security.biometric = true;
    });
    locked = false; // just verified, stay unlocked
    return { ok: true };
  }

  db.update((s) => {
    if (!s.security) s.security = {};
    s.security.biometric = false;
  });
  locked = false;
  return { ok: true };
}

function setLockTimeout(minutes) {
  db.update((s) => {
    if (!s.security) s.security = {};
    s.security.lockTimeout = Math.max(0, Number(minutes) || 0);
  });
}

function status() {
  const s = db.get();
  return {
    available: supported,
    enabled: Boolean(s.security?.biometric),
    locked: isLocked(),
    lockTimeout: s.security?.lockTimeout ?? 0,
  };
}

module.exports = {
  init,
  checkAvailable,
  verify,
  isLocked,
  lock,
  setEnabled,
  setLockTimeout,
  status,
  supported,
};
