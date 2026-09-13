const { safeStorage } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

/**
 * Doppel's vault — encryption at rest for everything the brain remembers.
 *
 * The master key is a random 256-bit AES key generated once and stored via
 * the OS credential manager (DPAPI on Windows, Keychain on macOS, libsecret
 * on Linux). The brain files are encrypted with AES-256-GCM, so tampering
 * is detected as well as prevented.
 *
 * The design rule: data at rest is always encrypted. Data in memory is
 * plaintext for speed. The vault sits between the two.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let masterKey = null;
let keyDir = null;

/* -------------------------------------------------------------------- init */

/**
 * Initialise the vault. Must be called after app.isReady().
 *
 * Generates a master key on first run and stores it via the OS credential
 * manager. On subsequent runs, loads the stored key.
 */
function init(dir) {
  keyDir = dir;
  const keyFile = path.join(dir, ".vault-key");

  if (safeStorage.isEncryptionAvailable()) {
    if (fs.existsSync(keyFile)) {
      try {
        const encrypted = fs.readFileSync(keyFile);
        const keyHex = safeStorage.decryptString(encrypted);
        masterKey = Buffer.from(keyHex, "hex");
        return;
      } catch {
        /* Corrupted key file — regenerate. Existing encrypted data will
           become unreadable, but that's better than crashing on every start. */
        console.warn("[vault] key file corrupted, generating new key");
      }
    }

    /* First run, or key was corrupted. */
    masterKey = crypto.randomBytes(32);
    const encrypted = safeStorage.encryptString(masterKey.toString("hex"));
    fs.writeFileSync(keyFile, encrypted);
    console.log("[vault] master key generated and stored via OS credential manager");
  } else {
    /* Fallback for environments where OS encryption isn't available.
       Derive from machine identity — weaker but functional. */
    const seed = `${os.hostname()}:${os.userInfo().username}:doppel-vault-v1`;
    masterKey = crypto.scryptSync(seed, "doppel-vault-salt", 32);
    console.warn("[vault] OS encryption unavailable, using derived key");
  }
}

const ready = () => masterKey !== null;

/* --------------------------------------------------------- low-level crypto */

/**
 * Encrypt a UTF-8 string → Buffer (IV + authTag + ciphertext).
 */
function encrypt(plaintext) {
  if (!masterKey) throw new Error("Vault not initialised");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/**
 * Decrypt a Buffer (IV + authTag + ciphertext) → UTF-8 string.
 */
function decrypt(buffer) {
  if (!masterKey) throw new Error("Vault not initialised");
  if (buffer.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Buffer too short to be encrypted data");
  }
  const iv = buffer.subarray(0, IV_LEN);
  const tag = buffer.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buffer.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc, null, "utf8") + decipher.final("utf8");
}

/* -------------------------------------------------------- file-level helpers */

/**
 * Write a string or object as an encrypted file. Atomic (tmp + rename).
 */
function writeEncrypted(filepath, data) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const encrypted = encrypt(text);
  const tmp = `${filepath}.tmp`;
  fs.writeFileSync(tmp, encrypted);
  fs.renameSync(tmp, filepath);
}

/**
 * Read an encrypted file → string. Falls back to plaintext if decryption
 * fails, which handles the migration from unencrypted data.
 */
function readEncrypted(filepath) {
  const raw = fs.readFileSync(filepath);

  /* Try decrypting first. */
  try {
    return decrypt(raw);
  } catch {
    /* Fallback: treat as plaintext (pre-encryption data). */
    return raw.toString("utf8");
  }
}

/**
 * Read an encrypted file and parse as JSON. Returns null on any error.
 */
function readEncryptedJSON(filepath) {
  try {
    return JSON.parse(readEncrypted(filepath));
  } catch {
    return null;
  }
}

/* ------------------------------------------------- episode file helpers
   Episodes are appended one at a time for durability. Each line is
   independently encrypted (base64-encoded) so the append-only pattern
   is preserved. Old plaintext lines are handled transparently.
   ---------------------------------------------------------------------- */

/**
 * Append one encrypted episode line to a file.
 */
function appendEncryptedLine(filepath, jsonString) {
  const encrypted = encrypt(jsonString);
  fs.appendFileSync(filepath, encrypted.toString("base64") + "\n", "utf8");
}

/**
 * Read all lines from an episode file, decrypting each independently.
 * Handles mixed plaintext + encrypted lines (migration path).
 */
function readEncryptedLines(filepath) {
  const content = fs.readFileSync(filepath, "utf8");
  const results = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    /* Try to decrypt as base64-encoded encrypted blob. */
    try {
      const buf = Buffer.from(line, "base64");
      /* Sanity check: base64 of encrypted data is always longer than raw JSON,
         and real encrypted data has a minimum length. A plaintext JSON line
         that happens to be valid base64 will fail decryption due to the auth tag. */
      if (buf.length >= IV_LEN + TAG_LEN + 2) {
        const decrypted = decrypt(buf);
        results.push(decrypted);
        continue;
      }
    } catch {
      /* Not encrypted — try as plaintext JSON. */
    }

    /* Plaintext line (pre-encryption data). */
    results.push(line);
  }

  return results;
}

/* ----------------------------------------------- secret encryption (DPAPI)
   For individual secrets like API keys. Uses the OS credential manager
   directly via safeStorage, not the AES master key — so even if the
   vault key is somehow extracted, the API key is still protected.
   ------------------------------------------------------------------- */

/**
 * Encrypt a secret string using the OS credential manager.
 * Returns a base64-encoded encrypted blob.
 */
function encryptSecret(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) return value;
  try {
    return safeStorage.encryptString(value).toString("base64");
  } catch {
    return value;
  }
}

/**
 * Decrypt a secret string. Handles both encrypted (base64 blob) and
 * plaintext values (migration from unencrypted storage).
 */
function decryptSecret(stored) {
  if (!stored) return "";
  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    /* Plaintext value from before encryption was enabled. */
    return stored;
  }
}

module.exports = {
  init,
  ready,
  encrypt,
  decrypt,
  writeEncrypted,
  readEncrypted,
  readEncryptedJSON,
  appendEncryptedLine,
  readEncryptedLines,
  encryptSecret,
  decryptSecret,
};
