const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

/**
 * Doppel's browser — a headless Chromium instance the background agent uses
 * to browse the web without showing a window.
 *
 * Uses puppeteer-extra with stealth plugin, user-agent rotation, retry logic,
 * and DuckDuckGo fallback when Google blocks automated searches.
 */

let browser = null;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function ensure() {
  if (browser && browser.connected) return browser;

  /* In production, use Electron's bundled Chromium instead of Puppeteer's
     separate download — saves ~300MB from the installer. */
  const opts = {
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  };

  try {
    const { app } = require("electron");
    if (app.isPackaged) {
      /* Electron's Chromium lives next to the main binary. On Windows it's
         the electron.exe path; on macOS it's inside the .app framework. */
      const chromePath = process.platform === "darwin"
        ? require("path").join(
            require("path").dirname(process.execPath),
            "..", "Frameworks", "Chromium Embedded Framework.framework",
            "Helpers", "Chromium Helper.app", "Contents", "MacOS", "Chromium Helper",
          )
        : process.execPath;
      opts.executablePath = chromePath;
    }
  } catch {
    /* Not in Electron context (e.g. tests) — use Puppeteer's default. */
  }

  browser = await puppeteer.launch(opts);
  return browser;
}

async function shutdown() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }
}

/* ------------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry an async fn with exponential backoff. */
async function retry(fn, { attempts = 3, delayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

/**
 * Create a page with stealth settings and request interception.
 * Blocks images/fonts/media for speed — we only need text.
 */
async function makePage() {
  const b = await ensure();
  const page = await b.newPage();
  await page.setUserAgent(randomUA());
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  page.setDefaultTimeout(20_000);

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (["image", "font", "media", "stylesheet"].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
}

/* --------------------------------------------------------------- extraction */

/**
 * Extract clean readable text from a page with preserved structure.
 * Smarter than innerText — strips noise, preserves headings and lists.
 */
async function extractText(page, { maxChars = 20_000 } = {}) {
  const text = await page.evaluate(() => {
    /* Remove noise elements */
    const remove = document.querySelectorAll(
      "script, style, noscript, nav, footer, header, aside, " +
      "[role='banner'], [role='navigation'], [role='complementary'], " +
      ".ad, .ads, .sidebar, .cookie-banner, #cookie-banner, " +
      ".social-share, .comments, .related-posts, [data-ad], " +
      ".popup, .modal, .overlay, .newsletter"
    );
    remove.forEach((el) => el.remove());

    /* Try to find the main content */
    const main =
      document.querySelector("article") ??
      document.querySelector("[role='main']") ??
      document.querySelector("main") ??
      document.querySelector(".post-content, .article-content, .entry-content") ??
      document.body;

    /* Walk the DOM to get structured text */
    const parts = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;

    while (node) {
      const tag = node.tagName;
      if (tag === "H1" || tag === "H2" || tag === "H3") {
        const t = node.textContent?.trim();
        if (t) parts.push(`\n## ${t}\n`);
      } else if (tag === "P") {
        const t = node.textContent?.trim();
        if (t && t.length > 10) parts.push(t);
      } else if (tag === "LI") {
        const t = node.textContent?.trim();
        if (t) parts.push(`- ${t}`);
      } else if (tag === "PRE" || tag === "CODE") {
        const t = node.textContent?.trim();
        if (t) parts.push(`\`\`\`\n${t}\n\`\`\``);
      } else if (tag === "TABLE") {
        const t = node.textContent?.trim();
        if (t) parts.push(t);
      } else if (tag === "BLOCKQUOTE") {
        const t = node.textContent?.trim();
        if (t) parts.push(`> ${t}`);
      }
      node = walker.nextNode();
    }

    /* If structured extraction got very little, fall back to innerText */
    const structured = parts.join("\n\n");
    if (structured.length < 200) {
      return main?.innerText ?? "";
    }
    return structured;
  });

  return text.trim().slice(0, maxChars);
}

/**
 * Extract links from a page — lets the agent follow references.
 */
async function extractLinks(page, { max = 30 } = {}) {
  return page.evaluate((max) => {
    const links = [];
    const seen = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      if (!href || href.startsWith("javascript:") || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (seen.has(href)) return;
      seen.add(href);
      const text = a.textContent?.trim().slice(0, 80) || "";
      if (text.length > 2) links.push({ text, url: href });
    });
    return links.slice(0, max);
  }, max);
}

/* ------------------------------------------------------------------ actions */

/**
 * Execute a browser action. Returns { ok, text } or { ok, error }.
 */
async function run(action) {
  const page = await makePage();

  try {
    switch (action.kind) {
      case "navigate":
        return await doNavigate(page, action);
      case "search":
        return await doSearch(page, action);
      case "read":
        return await doRead(page, action);
      case "extract_links":
        return await doExtractLinks(page, action);
      default:
        return { ok: false, error: `Unknown browser action '${action.kind}'.` };
    }
  } catch (err) {
    return { ok: false, error: `Browser error: ${err.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}

async function doNavigate(page, action) {
  const url = action.url;
  if (!url) return { ok: false, error: "No URL given." };

  await retry(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  }, { attempts: 2 });

  const text = await extractText(page);
  const title = await page.title();
  const finalUrl = page.url();
  const links = await extractLinks(page, { max: 15 });

  let result = `# ${title}\nURL: ${finalUrl}\n\n${text}`;
  if (links.length > 0) {
    result += "\n\n## Links on this page\n";
    result += links.map((l) => `- [${l.text}](${l.url})`).join("\n");
  }
  return { ok: true, text: result };
}

async function doSearch(page, action) {
  const query = action.query;
  if (!query) return { ok: false, error: "No search query given." };

  /* Try Google first, fall back to DuckDuckGo if blocked. */
  let results = await tryGoogleSearch(page, query);
  if (!results) {
    results = await tryDDGSearch(page, query);
  }

  if (!results || results.length === 0) {
    const text = await extractText(page);
    return { ok: true, text: `Search for "${query}" — no structured results, raw page:\n\n${text.slice(0, 5000)}` };
  }

  const formatted = results
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
  return { ok: true, text: `Search results for "${query}":\n\n${formatted}` };
}

async function tryGoogleSearch(page, query) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=10`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });

    /* Detect captcha/block */
    const blocked = await page.evaluate(() => {
      const body = document.body?.innerText ?? "";
      return body.includes("unusual traffic") || body.includes("captcha") || body.includes("not a robot");
    });
    if (blocked) return null;

    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll("div.g, div[data-sokoban-container]").forEach((el) => {
        const a = el.querySelector("a[href]");
        const h = el.querySelector("h3");
        const s = el.querySelector("[data-sncf], .VwiC3b, .st, [data-snc]");
        if (a && h) {
          items.push({
            title: h.textContent?.trim() ?? "",
            url: a.href,
            snippet: s?.textContent?.trim() ?? "",
          });
        }
      });
      return items.slice(0, 10);
    });

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

async function tryDDGSearch(page, query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });

    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll(".result").forEach((el) => {
        const a = el.querySelector("a.result__a");
        const s = el.querySelector(".result__snippet");
        if (a) {
          items.push({
            title: a.textContent?.trim() ?? "",
            url: a.href,
            snippet: s?.textContent?.trim() ?? "",
          });
        }
      });
      return items.slice(0, 10);
    });

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

async function doRead(page, action) {
  const url = action.url;
  if (!url) return { ok: false, error: "No URL given." };

  await retry(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  }, { attempts: 2 });

  const text = await extractText(page);
  const title = await page.title();
  const links = await extractLinks(page, { max: 20 });

  let result = `# ${title}\n\n${text}`;
  if (links.length > 0) {
    result += "\n\n## Links on this page\n";
    result += links.map((l) => `- [${l.text}](${l.url})`).join("\n");
  }
  return { ok: true, text: result };
}

async function doExtractLinks(page, action) {
  const url = action.url;
  if (!url) return { ok: false, error: "No URL given." };

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });

  const links = await extractLinks(page, { max: 50 });
  const title = await page.title();

  if (links.length === 0) {
    return { ok: true, text: `No links found on ${title}.` };
  }

  const formatted = links
    .map((l, i) => `${i + 1}. [${l.text}](${l.url})`)
    .join("\n");
  return { ok: true, text: `Links on "${title}":\n\n${formatted}` };
}

module.exports = { run, shutdown, ensure };
