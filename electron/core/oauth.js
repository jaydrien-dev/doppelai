/**
 * Generic OAuth 2.0 PKCE flow for add-ons.
 *
 * Works with any provider (Microsoft, Google, etc.) — the add-on manifest
 * declares the endpoints and scopes, this module handles the dance:
 *
 *   1. Generate PKCE code_verifier + code_challenge
 *   2. Open the user's browser to the consent page
 *   3. Spin up a one-shot local HTTP server to catch the redirect
 *   4. Exchange the auth code for tokens
 *   5. Return the tokens to be stored in add-on config
 *
 * No npm dependencies. Uses Node's built-in crypto and http.
 */

const crypto = require("node:crypto");
const http = require("node:http");
const { URL, URLSearchParams } = require("node:url");
const { shell } = require("electron");

const CALLBACK_PATH = "/oauth/callback";
const TIMEOUT_MS = 120_000; // 2 minutes to complete the flow

/**
 * Start an OAuth PKCE flow.
 *
 * @param {object} auth - The auth config from the add-on manifest.
 * @param {string} auth.authUrl - Authorization endpoint.
 * @param {string} auth.tokenUrl - Token endpoint.
 * @param {string} auth.clientId - OAuth client ID.
 * @param {string[]} auth.scopes - Requested scopes.
 * @returns {Promise<{ ok: boolean, tokens?: object, error?: string }>}
 */
async function authorize(auth) {
  if (!auth?.authUrl || !auth?.tokenUrl || !auth?.clientId) {
    return { ok: false, error: "Add-on is missing OAuth configuration." };
  }

  /* PKCE: generate a random verifier and its S256 challenge. */
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  /* Find a free port and start a one-shot callback server. */
  const { port, waitForCode, close } = await startCallbackServer();
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;

  /* Build the authorization URL. */
  const params = new URLSearchParams({
    client_id: auth.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: (auth.scopes || []).join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    response_mode: "query",
  });

  const url = `${auth.authUrl}?${params}`;

  /* Open the user's default browser. */
  shell.openExternal(url);

  try {
    /* Wait for the callback with the auth code. */
    const code = await waitForCode();

    /* Exchange the code for tokens. */
    const tokens = await exchangeCode({
      tokenUrl: auth.tokenUrl,
      clientId: auth.clientId,
      code,
      redirectUri,
      verifier,
    });

    return { ok: true, tokens };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    close();
  }
}

/**
 * Refresh an access token using a refresh token.
 */
async function refresh(auth, refreshToken) {
  const body = new URLSearchParams({
    client_id: auth.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: (auth.scopes || []).join(" "),
  });

  const res = await fetch(auth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/* --------------------------------------------------------- internal helpers */

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let resolveCode, rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url, `http://localhost`);
      if (parsed.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = parsed.searchParams.get("code");
      const error = parsed.searchParams.get("error");
      const errorDesc = parsed.searchParams.get("error_description");

      /* Send a nice page back to the browser. */
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (error) {
        res.end(resultPage(false, errorDesc || error));
        rejectCode(new Error(errorDesc || error));
      } else if (code) {
        res.end(resultPage(true));
        resolveCode(code);
      } else {
        res.end(resultPage(false, "No authorization code received."));
        rejectCode(new Error("No authorization code received."));
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectCode(new Error("OAuth timed out — no response within 2 minutes."));
        server.close();
      }
    }, TIMEOUT_MS);

    /* Listen on port 0 so the OS picks a free one. */
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        waitForCode: () => codePromise,
        close: () => {
          clearTimeout(timer);
          server.close();
        },
      });
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function exchangeCode({ tokenUrl, clientId, code, redirectUri, verifier }) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/** The HTML page shown in the browser after OAuth completes. */
function resultPage(success, error) {
  const color = success ? "#22c55e" : "#ef4444";
  const title = success ? "Connected" : "Something went wrong";
  const body = success
    ? "Doppel is connected. You can close this tab."
    : `${error || "Unknown error"}. Go back to Doppel and try again.`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Doppel</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
  .card { text-align: center; max-width: 400px; padding: 48px 32px; }
  h1 { font-size: 24px; font-weight: 600; margin: 0 0 12px; color: ${color}; }
  p { font-size: 15px; color: #64748b; line-height: 1.5; margin: 0; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

module.exports = { authorize, refresh };
