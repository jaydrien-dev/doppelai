const fs = require("fs");
const path = require("path");
const brain = require("./brain");
const claude = require("./claude");

/**
 * Document ingestion — parse PDF, DOCX, TXT, images, and other files into
 * brain episodes so they become searchable via recall.
 *
 * Text-based documents are split into chunks of ~800 words. Image-heavy
 * documents (scanned PDFs, image files, DOCX with embedded images) are
 * sent through Claude vision to extract descriptions of visual content.
 *
 * The brain handles tokenization, embedding, and storage.
 */

const CHUNK_WORDS = 800;
const CHUNK_OVERLAP = 100;

/** Minimum average chars per page to consider a PDF "text-rich". */
const SPARSE_THRESHOLD = 150;

/** Supported extensions and their parsers. */
const PARSERS = {
  ".pdf": parsePdf,
  ".docx": parseDocx,
  ".doc": parseDocx,
  ".txt": parsePlain,
  ".md": parsePlain,
  ".csv": parsePlain,
  ".json": parsePlain,
  ".log": parsePlain,
  ".rtf": parsePlain,
  ".xml": parsePlain,
  ".html": parseHtml,
  ".htm": parseHtml,
  /* images — described by vision */
  ".png": parseImage,
  ".jpg": parseImage,
  ".jpeg": parseImage,
  ".gif": parseImage,
  ".webp": parseImage,
  ".bmp": parseImage,
  ".svg": parseImage,
};

const IMAGE_MEDIA = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

function supportedExtensions() {
  return Object.keys(PARSERS);
}

/**
 * Ingest a document file into the brain.
 *
 * @param {string} filePath — absolute path to the file
 * @returns {{ ok: boolean, episodes?: number, title?: string, detail?: string }}
 */
async function ingest(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const parser = PARSERS[ext];
  if (!parser) {
    return {
      ok: false,
      detail: `Unsupported file type: ${ext}. Supported: ${Object.keys(PARSERS).join(", ")}`,
    };
  }

  if (!fs.existsSync(filePath)) {
    return { ok: false, detail: "File not found." };
  }

  let text;
  try {
    text = await parser(filePath);
  } catch (err) {
    return { ok: false, detail: `Failed to parse: ${err.message}` };
  }

  if (!text || text.trim().length < 10) {
    return { ok: false, detail: "Document appears empty or unreadable." };
  }

  const title = path.basename(filePath, ext);
  const chunks = chunkText(text);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const section = chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : "";

    brain.remember({
      kind: "document",
      app: null,
      window: null,
      activity: `${title}${section}`,
      intent: `Ingested document: ${path.basename(filePath)}`,
      detail: chunk,
      location: filePath,
      changed: "",
      fragments: extractFragments(chunk),
      salience: 0.7,
      sensitive: false,
      boundary: "none",
    });
  }

  return { ok: true, episodes: chunks.length, title };
}

/* ---------------------------------------------------------------------------
   Vision helper — describe an image via Claude
   --------------------------------------------------------------------------- */

async function describeImageBuffer(buffer, mediaType) {
  if (!claude.configured()) return null;
  const base64 = buffer.toString("base64");
  const result = await claude.ask({
    system:
      "You are describing the contents of an image for a personal memory system. " +
      "Describe everything visible: text, diagrams, charts, tables, handwriting, " +
      "photos, screenshots, UI elements, and any other visual content. Be thorough " +
      "and specific — this description will be the only searchable record of this image.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: "Describe everything in this image." },
        ],
      },
    ],
    thinking: false,
    fast: true,
    maxTokens: 2000,
  });
  return result.ok ? result.text : null;
}

/* ---------------------------------------------------------------------------
   Parsers
   --------------------------------------------------------------------------- */

/**
 * PDF parser with vision fallback.
 *
 * 1. Extract text with pdf-parse.
 * 2. If text is sparse (< 150 chars/page on average), the PDF is likely
 *    scanned or image-heavy — send the whole file to Claude as a document.
 * 3. Return whichever yields more content.
 */
async function parsePdf(filePath) {
  const pdfParse = require("pdf-parse");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  const extractedText = (data.text ?? "").trim();
  const pageCount = data.numpages ?? 1;
  const charsPerPage = extractedText.length / Math.max(pageCount, 1);

  /* Text-rich PDF — use the extracted text directly. */
  if (charsPerPage >= SPARSE_THRESHOLD) {
    /* Still try to describe images if there are few pages and we have a key. */
    if (pageCount <= 20 && claude.configured()) {
      const visionText = await describePdfVision(buffer, pageCount);
      if (visionText && visionText.length > extractedText.length * 0.3) {
        return extractedText + "\n\n--- Visual content ---\n\n" + visionText;
      }
    }
    return extractedText;
  }

  /* Sparse text — likely scanned / image-heavy. Try vision. */
  if (claude.configured()) {
    const visionText = await describePdfVision(buffer, pageCount);
    if (visionText && visionText.length > 10) {
      /* Combine any extracted text with vision descriptions. */
      return extractedText
        ? extractedText + "\n\n--- Visual content ---\n\n" + visionText
        : visionText;
    }
  }

  /* No API key or vision failed — return whatever text we got. */
  return extractedText;
}

/**
 * Send PDF pages as images to Claude vision.
 * Uses sharp to convert raw page renders, but falls back to sending the
 * first page as an image if full rendering isn't available.
 */
async function describePdfVision(buffer, pageCount) {
  /* Try sending the PDF buffer directly as a document. The Anthropic API
     supports PDF content blocks (media_type "application/pdf"). */
  const base64 = buffer.toString("base64");

  /* For very large PDFs, only describe the first 30 pages to stay under
     API limits. The user is told how many pages were processed. */
  const pageCap = Math.min(pageCount, 30);
  const pageNote =
    pageCount > pageCap
      ? ` (only the first ${pageCap} of ${pageCount} pages were analyzed)`
      : "";

  const result = await claude.ask({
    system:
      "You are describing a document for a personal memory system. Describe all " +
      "content including text, images, diagrams, charts, tables, and any visual " +
      "elements. Be thorough — this is the only searchable record of this document.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          {
            type: "text",
            text: `Describe all content in this document${pageNote}. Include text, images, diagrams, and any visual elements.`,
          },
        ],
      },
    ],
    thinking: false,
    fast: true,
    maxTokens: 4000,
  });

  return result.ok ? result.text : null;
}

/**
 * DOCX parser with embedded image extraction.
 *
 * Uses mammoth for text, and its convertImage handler to capture embedded
 * images. Each image is described via Claude vision and its description
 * is interleaved with the extracted text.
 */
async function parseDocx(filePath) {
  const mammoth = require("mammoth");

  /* Collect embedded images during conversion. */
  const images = [];
  const options = {
    path: filePath,
    convertImage: mammoth.images.imgElement(function (image) {
      return image.read("base64").then(function (base64) {
        const mediaType = image.contentType || "image/png";
        images.push({ base64, mediaType });
        /* Return an inline placeholder so we know where the image was. */
        return { src: `[IMAGE_${images.length}]` };
      });
    }),
  };

  const result = await mammoth.convertToHtml(options);

  /* Strip HTML to plain text, keeping image placeholders. */
  let text = result.value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  /* Describe each image and replace placeholders. */
  if (images.length > 0 && claude.configured()) {
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const buf = Buffer.from(img.base64, "base64");
      const description = await describeImageBuffer(buf, img.mediaType);
      const placeholder = `[IMAGE_${i + 1}]`;
      const replacement = description
        ? `\n[Image: ${description}]\n`
        : "\n[Image: could not be described]\n";
      text = text.replace(placeholder, replacement);
    }
  }

  return text;
}

async function parsePlain(filePath) {
  return fs.readFileSync(filePath, "utf-8");
}

async function parseHtml(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Image parser — describe the image via Claude vision.
 * Falls back to a basic "[Image file]" tag if no API key is configured.
 */
async function parseImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = IMAGE_MEDIA[ext] || "image/png";
  const buffer = fs.readFileSync(filePath);

  const description = await describeImageBuffer(buffer, mediaType);
  if (description) return description;

  /* No key — store a minimal record so the file is at least indexed. */
  return `[Image file: ${path.basename(filePath)}]`;
}

/* ---------------------------------------------------------------------------
   Chunking
   --------------------------------------------------------------------------- */

function chunkText(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= CHUNK_WORDS) return [text.trim()];

  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    chunks.push(words.slice(start, end).join(" "));
    start = end - CHUNK_OVERLAP;
    if (start >= words.length) break;
    if (end === words.length) break;
  }
  return chunks;
}

function extractFragments(text) {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && s.length < 300);

  return sentences.slice(0, 8).map((s) => ({
    kind: "text",
    what: "excerpt",
    value: s.slice(0, 400),
  }));
}

module.exports = { ingest, supportedExtensions };
