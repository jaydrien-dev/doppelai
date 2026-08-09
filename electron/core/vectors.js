const fs = require("node:fs");
const path = require("node:path");

/**
 * The vector store behind Mimic's memory.
 *
 * Memories are kept as meaning, not prose. Each episode is embedded once with a
 * small model that runs entirely on this machine — no embedding service, no
 * second vendor, nothing leaving the laptop — and the vector is what recall
 * actually searches. The English is only reconstructed when a person asks to
 * see it.
 *
 * Storage is deliberately tight, because this file grows every few minutes for
 * years:
 *
 *   vectors   384 dimensions quantised to int8 — one byte per dimension, 384
 *             bytes per memory. The model emits unit-length vectors, so the
 *             components sit in [-1,1] and quantising by 127 costs a fraction
 *             of a percent of ranking accuracy for a quarter of the size.
 *             A year of watching is about 20MB.
 *   metadata  parallel and minimal: id, timestamp, salience, sensitivity.
 *             Everything else lives in the episode files.
 *
 * Search is a brute-force dot product. For unit vectors that *is* cosine
 * similarity, and at this scale it is a few milliseconds — an index structure
 * would add dependencies and failure modes to save nothing worth saving.
 */

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIMS = 384;
const SCALE = 127;

let dir = null;
let extractor = null;
let loading = null;
let unavailable = null;

/** int8 vectors, densely packed: row i occupies [i*DIMS, (i+1)*DIMS). */
let store = new Int8Array(0);
let meta = []; // { id, at, sal, sen }
let count = 0;
let dirty = false;

const files = () => ({
  vectors: path.join(dir, "vectors.bin"),
  meta: path.join(dir, "meta.json"),
});

/* --------------------------------------------------------------- the model */

/**
 * Load the embedding model. It is fetched once (~25MB) and cached under the
 * app's own data folder; after that it is a local file read.
 *
 * If it cannot be loaded — no network on first run, a broken cache — the store
 * reports itself unavailable and the brain falls back to lexical search rather
 * than losing the ability to remember anything.
 */
async function ready() {
  if (extractor) return extractor;
  if (unavailable) return null;
  if (loading) return loading;

  loading = (async () => {
    try {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = path.join(dir, "model");
      env.allowRemoteModels = true;
      extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8", device: "cpu" });
      return extractor;
    } catch (err) {
      unavailable = err?.message ?? String(err);
      console.error("[mimic] no embedding model, memory falls back to words:", unavailable);
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** Embed a batch. Returns unit-length Float32Arrays, or null if unavailable. */
async function embed(texts) {
  const model = await ready();
  if (!model) return null;
  const list = Array.isArray(texts) ? texts : [texts];
  if (list.length === 0) return [];

  const output = await model(list, { pooling: "mean", normalize: true });
  const flat = output.data;
  return list.map((_, i) => Float32Array.from(flat.subarray(i * DIMS, (i + 1) * DIMS)));
}

/* ---------------------------------------------------------------- the store */

function init(root) {
  dir = root;
  fs.mkdirSync(dir, { recursive: true });

  const { vectors, meta: metaFile } = files();
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const raw = fs.readFileSync(vectors);
    store = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    count = Math.min(meta.length, Math.floor(store.length / DIMS));
    /* A torn write leaves the two files disagreeing; trust the shorter. */
    if (meta.length !== count) meta = meta.slice(0, count);
  } catch {
    store = new Int8Array(0);
    meta = [];
    count = 0;
  }

  return { count, dims: DIMS };
}

function grow(needed) {
  if (needed * DIMS <= store.length) return;
  const next = new Int8Array(Math.max(needed, Math.ceil(count * 1.6) + 256) * DIMS);
  next.set(store.subarray(0, count * DIMS));
  store = next;
}

/** Quantise a unit vector into the row for `index`. */
function write(index, vector) {
  const offset = index * DIMS;
  for (let d = 0; d < DIMS; d++) {
    const v = Math.round(vector[d] * SCALE);
    store[offset + d] = v > 127 ? 127 : v < -128 ? -128 : v;
  }
}

/** Add one embedded memory. */
function add({ id, at, salience = 0.5, sensitive = false }, vector) {
  if (!vector) return false;
  grow(count + 1);
  write(count, vector);
  meta[count] = { id, at, sal: Math.round(salience * 100), sen: sensitive ? 1 : 0 };
  count += 1;
  dirty = true;
  return true;
}

/**
 * Nearest memories to a query vector.
 *
 * Both sides are unit length, so the int8 dot product ranks identically to
 * cosine similarity; dividing by SCALE² returns it to a readable 0–1 score.
 */
function search(vector, { limit = 20, minScore = 0.15, before = null } = {}) {
  if (!vector || count === 0) return [];

  const q = new Int8Array(DIMS);
  for (let d = 0; d < DIMS; d++) {
    const v = Math.round(vector[d] * SCALE);
    q[d] = v > 127 ? 127 : v < -128 ? -128 : v;
  }

  const hits = [];
  const norm = SCALE * SCALE;

  for (let i = 0; i < count; i++) {
    const entry = meta[i];
    if (!entry || entry.sen) continue; // a private moment is not searchable
    if (before && entry.at > before) continue;

    let dot = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += q[d] * store[offset + d];

    const score = dot / norm;
    if (score >= minScore) hits.push({ id: entry.id, at: entry.at, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function flush() {
  if (!dirty || !dir) return;
  const { vectors, meta: metaFile } = files();
  try {
    /* Only the used prefix is written, not the growth slack. */
    const used = Buffer.from(store.buffer, store.byteOffset, count * DIMS);
    fs.writeFileSync(`${vectors}.tmp`, used);
    fs.renameSync(`${vectors}.tmp`, vectors);
    fs.writeFileSync(`${metaFile}.tmp`, JSON.stringify(meta.slice(0, count)), "utf8");
    fs.renameSync(`${metaFile}.tmp`, metaFile);
    dirty = false;
  } catch (err) {
    console.error("[mimic] could not save vectors:", err.message);
  }
}

function forget(ids) {
  const drop = new Set(ids);
  let write_ = 0;
  for (let read = 0; read < count; read++) {
    if (drop.has(meta[read]?.id)) continue;
    if (write_ !== read) {
      store.copyWithin(write_ * DIMS, read * DIMS, (read + 1) * DIMS);
      meta[write_] = meta[read];
    }
    write_ += 1;
  }
  const removed = count - write_;
  count = write_;
  meta.length = count;
  if (removed) dirty = true;
  return removed;
}

function wipe() {
  store = new Int8Array(0);
  meta = [];
  count = 0;
  dirty = false;
  try {
    fs.rmSync(files().vectors, { force: true });
    fs.rmSync(files().meta, { force: true });
  } catch {
    /* nothing there */
  }
}

const stats = () => ({
  count,
  dims: DIMS,
  bytes: count * DIMS,
  available: Boolean(extractor),
  unavailable,
});

module.exports = { init, embed, add, search, flush, forget, wipe, stats, ready, DIMS, MODEL };
