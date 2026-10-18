// Fit check for the TV screens: no screen may ever overflow or scroll, in X or Y.
//
// Loads the demo build at several TV resolutions, pins each screen (?screen=1..4, plus the alarm
// screen with many very long alarms: ?alarms=many) and asserts that
//   1. the document never scrolls (scrollWidth/Height <= clientWidth/Height on html and body),
//   2. every element inside the 3840x2160 canvas stays within the canvas bounds,
//   3. no clipping element (overflow != visible) inside the canvas has hidden content
//      (scrollWidth/Height > clientWidth/Height), except intentional clamps: text-overflow: ellipsis
//      (X) or -webkit-line-clamp (Y), which are reported, not failed.
//
// Usage: build the demo (VITE_DEMO=true npm run build), serve it (npx vite preview --port 4173),
// then: CHROME=/usr/bin/google-chrome BASE_URL=http://localhost:4173/ node scripts/check-fit.mjs
// Optional: SCREENSHOT_DIR=... saves a PNG per case.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4173/";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const SHOT_DIR = process.env.SCREENSHOT_DIR;
const SIZES = [
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [2560, 1080],
  [3840, 2160],
];
const CASES = [
  ["alarm", "screen=1"],
  ["alarm-many", "screen=1&alarms=many"],
  ["dashboard", "screen=2"],
  ["shift", "screen=3"],
  ["oee", "screen=4"],
];
// Screen switch = 2 s fade out + 3 s fade in
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 5600);

if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let failures = 0;
try {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    for (const [name, query] of CASES) {
      await page.goto(`${BASE_URL}?${query}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const r = await page.evaluate(() => {
        const problems = [];
        const clamped = [];
        for (const el of [document.documentElement, document.body]) {
          if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)
            problems.push(`${el.tagName} scrolls: ${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight}`);
        }
        const canvas = [...document.querySelectorAll("div")].find((d) => d.style.transform.includes("scale("));
        if (!canvas) return { problems: ["canvas not found"], clamped, count: 0 };
        const cr = canvas.getBoundingClientRect();
        if (cr.left < -0.5 || cr.top < -0.5 || cr.right > innerWidth + 0.5 || cr.bottom > innerHeight + 0.5)
          problems.push(`canvas outside viewport: ${JSON.stringify(cr)}`);
        const label = (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(" ").slice(0, 3).join(".")} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
        const els = canvas.querySelectorAll("*");
        for (const el of els) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) continue;
          if (getComputedStyle(el).position === "fixed") continue;
          const tol = 1;
          if (b.left < cr.left - tol || b.top < cr.top - tol || b.right > cr.right + tol || b.bottom > cr.bottom + tol)
            problems.push(`outside canvas: ${label(el)}`);
          if (el instanceof SVGElement) continue;
          // Overflow only matters where it is clipped (overflow != visible) or would scroll. Glyph
          // extents of a leading-none line box inside a padded card are not clipped and not counted.
          const cs = getComputedStyle(el);
          const clipX = cs.overflowX !== "visible";
          const clipY = cs.overflowY !== "visible";
          const overX = clipX && el.scrollWidth > el.clientWidth + 1;
          const overY = clipY && el.scrollHeight > el.clientHeight + 1;
          if (!overX && !overY) continue;
          const ellipsis = cs.textOverflow === "ellipsis";
          const lineClamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
          const msg = `${label(el)} scroll ${el.scrollWidth}x${el.scrollHeight} > client ${el.clientWidth}x${el.clientHeight}`;
          if ((overX && !ellipsis) || (overY && !lineClamp)) problems.push(`clipped overflow: ${msg}`);
          else clamped.push(`clamped (${overX ? "ellipsis" : "line-clamp"}): ${msg}`);
        }
        return { problems, clamped, count: els.length };
      });
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}-${w}x${h}.png` });
      const ok = r.problems.length === 0;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"} ${name} ${w}x${h} (${r.count} elements, ${r.clamped.length} clamped)`);
      for (const p of r.problems) console.log(`   ✗ ${p}`);
      for (const c of r.clamped) console.log(`   · ${c}`);
    }
    if (errors.length) {
      failures++;
      console.log(`FAIL console errors at ${w}x${h}:\n   ${errors.join("\n   ")}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? "All fit checks passed" : `${failures} fit check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
