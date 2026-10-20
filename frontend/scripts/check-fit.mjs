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
// SIZES=1536x864,1440x900 overrides the list (the canvas scales uniformly, so other sizes only letterbox)
const SIZES = process.env.SIZES
  ? process.env.SIZES.split(",").map((s) => s.split("x").map(Number))
  : [
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
  // Chart/KPI elements (docs/examples/*-element.yaml, diagram.yaml): the OEE and 7-day screens rebuilt from
  // elements, every element type, and every element at its minimum size, with 6-digit counts, 100,0 %,
  // a stopped line and 3-digit stop counts (?count=999999&stopped=1)
  ["oee-element-6digit", "layout=oee-element&screen=1&count=999999&stopped=1"],
  ["week-element-6digit", "layout=7dagar-element&screen=1&count=999999"],
  ["diagram", "layout=diagram&screen=1"],
  ["diagram-6digit", "layout=diagram&screen=1&count=999999&stopped=1"],
  ["diagram-shifts-6digit", "layout=diagram&screen=2&count=999999"],
  ["diagram-min1-6digit", "layout=diagram&screen=3&count=999999&stopped=1"],
  ["diagram-min2-6digit", "layout=diagram&screen=4&count=999999&stopped=1"],
  // Trend lines (docs/examples/trend.yaml): 24 x 12, 12 x 6 and the 8 x 4 minimum, with 30 days, 14 shifts,
  // one point, a flat and a negative tag, a missing tag, days without production and 6-digit counts
  ["trend-big", "layout=trend&screen=1"],
  ["trend-12x6", "layout=trend&screen=2"],
  ["trend-12x6-6digit", "layout=trend&screen=2&count=999999"],
  ["trend-min", "layout=trend&screen=3"],
  ["trend-min-6digit", "layout=trend&screen=3&count=999999&stopped=1"],
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
        // Chart/KPI elements (src/charts): fitted numbers must fit, and every label and number is at least
        // 104 px on the canvas (≥ 37 px cap height at 1080p, the same floor as the rest of the TV)
        const fitEls = [...canvas.querySelectorAll("[data-chart] [data-fit-value]")];
        for (const el of fitEls)
          if (el.scrollWidth > el.clientWidth + 1)
            problems.push(`chart value too wide: ${label(el)} ${el.scrollWidth} > ${el.clientWidth}`);
        // ... and, like the editor's audit (src/editor/audit.ts), a cap height of at least 37 px at 1080p
        // measured from the real font: the monospace digits are smaller per px than the sans labels
        let chartMin = null;
        const capCtx = document.createElement("canvas").getContext("2d");
        const capRatio = new Map();
        for (const el of canvas.querySelectorAll("[data-chart], [data-chart] *")) {
          if (el instanceof SVGElement) continue;
          if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
          const cs = getComputedStyle(el);
          const px = parseFloat(cs.fontSize);
          chartMin = chartMin === null ? px : Math.min(chartMin, px);
          if (px < 104) problems.push(`chart text below 104 px: ${label(el)} ${px}px`);
          const key = `${cs.fontWeight} ${cs.fontFamily}`;
          if (!capRatio.has(key)) {
            capCtx.font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
            capRatio.set(key, capCtx.measureText("H").actualBoundingBoxAscent / 100 || 0.72);
          }
          const cap1080 = Math.round(px * capRatio.get(key) * 0.5);
          if (cap1080 < 37) problems.push(`chart text cap height ${cap1080} px at 1080p (< 37): ${label(el)} ${px}px`);
        }
        // SVG shapes in charts: the shape's box including half the stroke width (line caps, the end dot)
        // must lie inside the SVG's viewport and inside every clipping ancestor up to the chart card, so no
        // line, marker or target line is cut at an edge.
        for (const svg of canvas.querySelectorAll("[data-chart] svg")) {
          const W = svg.width.baseVal.value;
          const H = svg.height.baseVal.value;
          const vb = svg.viewBox.baseVal;
          const [vx, vy, vw, vh] = vb && vb.width ? [vb.x, vb.y, vb.width, vb.height] : [0, 0, W, H];
          const card = svg.closest("[data-chart]");
          let clip = card.getBoundingClientRect();
          for (let a = svg.parentElement; a && a !== card.parentElement; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
            const r = a.getBoundingClientRect();
            clip = { left: Math.max(clip.left, r.left), top: Math.max(clip.top, r.top), right: Math.min(clip.right, r.right), bottom: Math.min(clip.bottom, r.bottom) };
          }
          const m = svg.getScreenCTM();
          for (const el of svg.querySelectorAll("path, line, circle, rect, polyline, polygon, ellipse")) {
            const bb = el.getBBox();
            if (bb.width === 0 && bb.height === 0 && el.tagName !== "circle") continue;
            const cs = getComputedStyle(el);
            const sw = cs.stroke === "none" ? 0 : parseFloat(cs.strokeWidth) || 0;
            // a straight line with butt caps only grows across its direction (a grid line from 0 to the width fits)
            const butt = el.tagName === "line" && cs.strokeLinecap === "butt";
            const hx = butt && bb.width > 0 && bb.height === 0 ? 0 : sw / 2;
            const hy = butt && bb.height > 0 && bb.width === 0 ? 0 : sw / 2;
            const x0 = bb.x - hx, y0 = bb.y - hy, x1 = bb.x + bb.width + hx, y1 = bb.y + bb.height + hy;
            const where = [x0 < vx - 0.5 && "left", y0 < vy - 0.5 && "top", x1 > vx + vw + 0.5 && "right", y1 > vy + vh + 0.5 && "bottom"].filter(Boolean);
            // ... and on screen, against the clipping ancestors (the viewport scale m.a, m.d)
            const L = m.e + x0 * m.a, T = m.f + y0 * m.d, R = m.e + x1 * m.a, B = m.f + y1 * m.d;
            if (L < clip.left - 1 || T < clip.top - 1 || R > clip.right + 1 || B > clip.bottom + 1) where.push("container");
            if (where.length) problems.push(`chart svg ${el.tagName} cut (${[...new Set(where)].join(", ")}): in "${(card.textContent ?? "").trim().slice(0, 30)}"`);
          }
        }
        // Chart labels must not overlap each other (e.g. a y-axis label running into the x-axis labels)
        for (const card of canvas.querySelectorAll("[data-chart]")) {
          const leaves = [...card.querySelectorAll("*")].filter(
            (el) => !(el instanceof SVGElement) && [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()),
          );
          const boxes = leaves.map((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return { el, r: range.getBoundingClientRect() };
          });
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i], b = boxes[j];
              if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
              const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
              const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
              // the line boxes include the fonts' ascent/descent around the glyphs: only overlaps over a
              // third of the smaller box's height are glyphs running into each other
              if (ox > 4 && oy > 0.35 * Math.min(a.r.height, b.r.height)) problems.push(`chart labels overlap: ${label(a.el)} / ${label(b.el)}`);
            }
        }
        return { problems, clamped, count: els.length, hero, week, hs, chartMin };
      });
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}-${w}x${h}.png` });
      if (!allowClamp) r.problems.push(...r.clamped.map((c) => `not allowed on this screen: ${c}`));
      const ok = r.problems.length === 0;
      if (!ok) failures++;
      const hero =
        (r.hero === null ? "" : `, smallest item value ${r.hero}px`) +
        (r.week === null ? "" : `, smallest week number ${r.week}px`) +
        (r.hs === null ? "" : `, smallest highscore value ${r.hs}px`) +
        (r.chartMin === null ? "" : `, smallest chart text ${r.chartMin}px`);
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
