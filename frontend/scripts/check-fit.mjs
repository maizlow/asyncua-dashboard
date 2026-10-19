// Fit check for the TV screens: no screen may ever overflow or scroll, in X or Y.
//
// Loads the demo build at several TV resolutions, pins each screen (?screen=1..6, plus the alarm
// screen with many very long alarms: ?alarms=many, 6-digit counts: ?count=999999, and the worst-case
// layout docs/examples/stress.yaml: ?layout=stress) and asserts that
//   1. the document never scrolls (scrollWidth/Height <= clientWidth/Height on html and body),
//   2. every element inside the 3840x2160 canvas stays within the canvas bounds,
//   3. no clipping element (overflow != visible) inside the canvas has hidden content
//      (scrollWidth/Height > clientWidth/Height), except intentional clamps: text-overflow: ellipsis
//      (X) or -webkit-line-clamp (Y), which are reported, not failed - on the alarm screen only.
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
// [name, query, clamping allowed?] Only alarm texts may be ellipsized; on the other screens a
// clamped label or number means the layout is too tight and fails the check.
const CASES = [
  ["alarm", "screen=1", true],
  ["alarm-many", "screen=1&alarms=many", true],
  ["dashboard", "screen=2"],
  ["shift", "screen=3"],
  ["oee", "screen=4"],
  // 6-digit counts (production, good count, targets, prognosis) must fit too
  ["dashboard-6digit", "screen=2&count=999999"],
  // ... together with a stopped line and a 3-digit stop count (worst case for the Stopp tile)
  ["oee-6digit", "screen=4&count=999999&stopped=1"],
  // Worst-case dashboard.yaml (docs/examples/stress.yaml): max item count, 20-char labels,
  // 6-char units, negative/6-digit values, status texts, 1 and 3 item grids, built-in screens
  ["stress-grid6", "layout=stress&screen=2"],
  ["stress-grid1", "layout=stress&screen=3"],
  ["stress-grid3", "layout=stress&screen=4"],
  ["stress-shift", "layout=stress&screen=5"],
  ["stress-oee", "layout=stress&screen=6"],
  // 7-day screen: normal demo week, 6-digit counts + "100,0 %" on every day, and the stress layout
  ["week", "screen=5"],
  ["week-6digit", "screen=5&count=999999"],
  ["stress-week", "layout=stress&screen=7"],
  // Highscore screen: demo records (one in the current shift + the ongoing run), 3-digit hours and
  // "A→B" teams everywhere (?count), and the stress layout
  ["highscore", "screen=6"],
  ["highscore-3digit", "screen=6&count=999999"],
  ["stress-highscore", "layout=stress&screen=8"],
  // Layout document with three PLCs shared by two displays (docs/examples/flera-displayer.yaml): tv1 reads
  // all three, tv2 (no left logo) two of them
  ["multi-tv1", "layout=multi&display=tv1&screen=2"],
  ["multi-tv2", "layout=multi&display=tv2&screen=1"],
  // One of the three PLCs down: its elements show "–" with ⚠, the others keep their values
  ["multi-plc2-down", "layout=multi&display=tv1&screen=2&down=plc2"],
];
// Screen switch = 2 s fade out + 3 s fade in
// ONLY=regex limits the run to matching case names, e.g. ONLY=highscore
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
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
    for (const [name, query, allowClamp = false] of CASES) {
      if (ONLY && !ONLY.test(name)) continue;
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
        // Grid item values (ItemCard sets the fitted font size inline): smallest one, in canvas px.
        // Their box is not clipping, so check explicitly that the value + unit fit (no overlap with the trend/target).
        const heroEls = [...canvas.querySelectorAll("[data-hero]")];
        for (const el of heroEls)
          if (el.scrollWidth > el.clientWidth + 1)
            problems.push(`item value too wide: ${label(el)} ${el.scrollWidth} > ${el.clientWidth}`);
        const heroes = heroEls.map((e) => parseFloat(e.style.fontSize));
        const hero = heroes.length ? Math.min(...heroes) : null;
        // 7-day screen numbers (font shrinks only if a value would not fit its column)
        const weekEls = [...canvas.querySelectorAll("[data-week-oee], [data-week-count]")];
        for (const el of weekEls)
          if (el.scrollWidth > el.clientWidth + 1)
            problems.push(`week value too wide: ${label(el)} ${el.scrollWidth} > ${el.clientWidth}`);
        const weekSizes = weekEls.map((e) => parseFloat(e.style.fontSize));
        const week = weekSizes.length ? Math.min(...weekSizes) : null;
        // Highscore values (duration, team, stamp shrink only if they would not fit their column)
        const hsEls = [...canvas.querySelectorAll("[data-hs-value]")];
        for (const el of hsEls)
          if (el.scrollWidth > el.clientWidth + 1)
            problems.push(`highscore value too wide: ${label(el)} ${el.scrollWidth} > ${el.clientWidth}`);
        const hsSizes = hsEls.map((e) => parseFloat(e.style.fontSize || getComputedStyle(e).fontSize));
        const hs = hsSizes.length ? Math.min(...hsSizes) : null;
        return { problems, clamped, count: els.length, hero, week, hs };
      });
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}-${w}x${h}.png` });
      if (!allowClamp) r.problems.push(...r.clamped.map((c) => `not allowed on this screen: ${c}`));
      const ok = r.problems.length === 0;
      if (!ok) failures++;
      const hero =
        (r.hero === null ? "" : `, smallest item value ${r.hero}px`) +
        (r.week === null ? "" : `, smallest week number ${r.week}px`) +
        (r.hs === null ? "" : `, smallest highscore value ${r.hs}px`);
      console.log(`${ok ? "PASS" : "FAIL"} ${name} ${w}x${h} (${r.count} elements, ${r.clamped.length} clamped${hero})`);
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
