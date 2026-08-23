#!/usr/bin/env node
/**
 * Layout check for the Veckoschema grid.
 *
 * The whole grid exists to answer one question: can you read every block
 * without tapping it? That is easy to regress and impossible to eyeball --
 * the failure mode is a subject silently ellipsed to "S." on one screen size,
 * in one theme, on one week, for one class. So it is asserted here instead.
 *
 * For every class x week x viewport x theme it loads the app and fails on:
 *   - a lesson subject clipped by its block
 *   - two lessons in one day overlapping each other
 *   - a block escaping the grid body box
 *   - the grid not fitting its container (the app must never scroll)
 *   - any page error or console error
 *
 * Usage:
 *   node schedule/scripts/check_layout.mjs               # assert, exit 1 on failure
 *   node schedule/scripts/check_layout.mjs --shots out   # also write PNGs to out/
 *   node schedule/scripts/check_layout.mjs --verbose     # print every case
 *
 * Needs Playwright + Chromium. See "Checking the layout" in CLAUDE.md.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 8731;
const base = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const shotsIdx = args.indexOf("--shots");
const SHOTS = shotsIdx !== -1 ? path.resolve(args[shotsIdx + 1] || "layout-shots") : null;

/* ------------------------------ Playwright ------------------------------- */

async function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = ["playwright", "playwright-core", "@playwright/test"];
  for (const name of candidates) {
    try {
      return (await import(name)).chromium;
    } catch {
      /* try the next one */
    }
    // Also try a global install, which is how the CI sandbox provides it.
    for (const base of [process.env.NODE_PATH, "/opt/node22/lib/node_modules", "/usr/lib/node_modules"]) {
      if (!base) continue;
      const p = path.join(base, name, "index.mjs");
      if (fs.existsSync(p)) return (await import(p)).chromium;
    }
  }
  console.error(
    "Playwright not found. Install it with:\n" +
      "  npm i -D playwright && npx playwright install chromium\n" +
      "(In a sandbox where Chromium is preinstalled, set PLAYWRIGHT_BROWSERS_PATH instead of downloading.)"
  );
  process.exit(2);
}

/** Preinstalled Chromium lives under a versioned directory, so glob for it
 * rather than hard-coding a version that will drift. */
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !fs.existsSync(base)) return undefined;
  for (const entry of fs.readdirSync(base)) {
    if (!entry.startsWith("chromium-")) continue;
    const exe = path.join(base, entry, "chrome-linux", "chrome");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

/* -------------------------------- Server --------------------------------- */

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/* ------------------------------ Assertions ------------------------------- */

/** Runs in the page. Everything here is a "you cannot read this" condition. */
function auditPage() {
  const out = { clipped: [], overlaps: [], escapes: [], fits: true };
  const blocks = [...document.querySelectorAll(".lesson")];

  for (const b of blocks) {
    const subject = b.querySelector(".lesson__subject");
    if (subject && subject.scrollHeight > subject.clientHeight + 1) {
      out.clipped.push(subject.textContent.trim());
    }
    if (b.scrollHeight > b.clientHeight + 1) {
      out.clipped.push((b.querySelector(".lesson__subject")?.textContent || "?").trim() + " (block overflow)");
    }
  }

  for (const col of document.querySelectorAll(".day-col")) {
    const rects = [...col.querySelectorAll(".lesson")].map((e) => ({
      t: e.querySelector(".lesson__subject")?.textContent.trim(),
      r: e.getBoundingClientRect(),
    }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r;
        const b = rects[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 0.5 && oy > 0.5) out.overlaps.push(`${rects[i].t} x ${rects[j].t}`);
      }
    }
  }

  const body = document.querySelector(".day-grid__body")?.getBoundingClientRect();
  if (body) {
    for (const b of blocks) {
      const r = b.getBoundingClientRect();
      if (r.bottom > body.bottom + 0.5 || r.top < body.top - 0.5 || r.right > body.right + 0.5) {
        out.escapes.push(b.querySelector(".lesson__subject")?.textContent.trim());
      }
    }
  }

  const grid = document.querySelector(".day-grid");
  const inner = document.getElementById("stage-inner");
  if (grid && inner) out.fits = grid.getBoundingClientRect().bottom <= inner.getBoundingClientRect().bottom + 1;

  out.blocks = blocks.length;
  out.label = `${document.getElementById("chrome-class").textContent} / ${document.getElementById("chrome-period").textContent}`;
  // Not fonts.check(): with the Google Fonts stylesheet blocked there is no
  // @font-face rule at all, and check() then trivially answers true for the
  // fallback. Ask the FontFaceSet what it actually holds.
  out.webfont = false;
  if (document.fonts) {
    document.fonts.forEach((f) => {
      if (f.family.replace(/["']/g, "") === "Archivo Narrow" && f.status === "loaded") out.webfont = true;
    });
  }
  return out;
}

/* --------------------------------- Run ----------------------------------- */

const VIEWPORTS = [
  // The tightest landscape a phone realistically gives us is the worst case
  // for vertical room; the widest is the worst case for a half-width block
  // needing to justify its type step.
  { name: "landscape-844", w: 844, h: 390 },
  { name: "landscape-1000", w: 1000, h: 462 },
  { name: "landscape-1366", w: 1366, h: 620 },
  { name: "portrait-390", w: 390, h: 844 },
  { name: "portrait-360", w: 360, h: 740 },
];
const THEMES = ["light", "dark"];
// A weekday inside the data's range, so "today" and the now-line actually render.
const CLOCKS = [null, "2026-08-26T11:20:00"];

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "schedule/data/schedule.json"), "utf8"));
const nClasses = data.schools.length;
const nWeeks = data.weeks.length;

const chromium = await loadChromium();
const server = await serve();
const browser = await chromium.launch({ executablePath: findChromium() });

let checks = 0;
let webfontSeen = false;
const failures = [];

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const clock of CLOCKS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        colorScheme: theme,
        deviceScaleFactor: 2,
      });
      if (clock) await ctx.clock.setFixedTime(new Date(clock));
      const page = await ctx.newPage();
      const jsErrors = [];
      page.on("pageerror", (e) => jsErrors.push(e.message));
      // Judge failed loads by origin, not by the console message. A sandbox
      // that cannot reach Google Fonts is a documented condition the app
      // handles; a same-origin file that fails to load is a real break, and
      // both print the same unhelpful "Failed to load resource".
      page.on("requestfailed", (r) => {
        if (r.url().startsWith(base)) jsErrors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
      });
      page.on("response", (r) => {
        if (r.url().startsWith(base) && r.status() >= 400) jsErrors.push(`HTTP ${r.status()}: ${r.url()}`);
      });
      page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text());
      });
      await page.goto(`${base}/schedule/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      await page.focus("#stage");

      // A horizontal swipe steps weeks in the week grid but single days in
      // portrait, so the sweep length differs: five weekdays per week there.
      const portrait = vp.h > vp.w;
      const steps = portrait ? nWeeks * 5 : nWeeks;

      // Walk back to the first class and first position, then sweep forward.
      for (let i = 0; i < nClasses; i++) await page.keyboard.press("ArrowUp");
      for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(200);

      for (let c = 0; c < nClasses; c++) {
        for (let w = 0; w < steps; w++) {
          await page.waitForTimeout(160);
          const r = await page.evaluate(auditPage);
          checks++;
          if (r.webfont) webfontSeen = true;
          const tag = `${vp.name} ${theme}${clock ? " @wed11:20" : ""} — ${r.label}`;
          const problems = [];
          if (r.clipped.length) problems.push(`clipped: ${[...new Set(r.clipped)].join(" | ")}`);
          if (r.overlaps.length) problems.push(`overlap: ${[...new Set(r.overlaps)].join(" | ")}`);
          if (r.escapes.length) problems.push(`escapes grid: ${[...new Set(r.escapes)].join(" | ")}`);
          if (!r.fits) problems.push("grid does not fit its container");
          if (jsErrors.length) problems.push(`js: ${jsErrors.splice(0).join(" | ")}`);

          if (problems.length) failures.push(`${tag}\n    ${problems.join("\n    ")}`);
          if (VERBOSE) console.log(`${problems.length ? "FAIL" : "ok  "}  ${tag} (${r.blocks} blocks)`);

          if (SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true });
            const slug = `${vp.name}-${theme}${clock ? "-now" : ""}-c${c}-w${w}`;
            await page.screenshot({ path: path.join(SHOTS, `${slug}.png`) });
          }
          if (w < steps - 1) await page.keyboard.press("ArrowRight");
        }
        for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowLeft");
        if (c < nClasses - 1) await page.keyboard.press("ArrowDown");
      }
      await ctx.close();
    }
  }
}

// The static pages share the look but not the grid; the thing that breaks
// them is sideways scroll on a narrow phone.
for (const url of ["/", "/schedule/links.html"]) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: theme });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("requestfailed", (r) => {
      if (r.url().startsWith(base)) errs.push(`request failed: ${r.url()}`);
    });
    page.on("response", (r) => {
      if (r.url().startsWith(base) && r.status() >= 400) errs.push(`HTTP ${r.status()}: ${r.url()}`);
    });
    await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    checks++;
    if (overflow) failures.push(`${url} ${theme} — page scrolls sideways at 360px`);
    if (errs.length) failures.push(`${url} ${theme} — js: ${errs.join(" | ")}`);
    if (VERBOSE) console.log(`${overflow || errs.length ? "FAIL" : "ok  "}  ${url} ${theme}`);
    await ctx.close();
  }
}

await browser.close();
server.close();

console.log(
  `\n${checks} checks across ${nClasses} class(es) x ${nWeeks} week(s) ` +
    `(every weekday individually in single-day mode) x ${VIEWPORTS.length} viewports x ${THEMES.length} themes.`
);
if (!webfontSeen) {
  console.log(
    "NOTE: Archivo Narrow never loaded, so text was measured against the fallback face.\n" +
      "      That is the wider, worst case — a pass here still holds with the webfont."
  );
}
if (SHOTS) console.log(`Screenshots: ${SHOTS}`);

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):\n`);
  for (const f of failures) console.error("  " + f + "\n");
  process.exit(1);
}
console.log("PASS — every lesson is fully readable in every case.");
