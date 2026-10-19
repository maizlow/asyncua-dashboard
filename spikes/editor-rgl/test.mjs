// Drags and resizes items with a real mouse at several viewport sizes and checks the grid result.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE ?? "http://localhost:4180/";
const W = 3840, H = 2160, HEADER = 300, GAP = 48, PADX = 64, PADY = 48;
const COLW = (W - 2 * PADX - 23 * GAP) / 24, ROWH = (H - HEADER - 2 * PADY - 11 * GAP) / 12;
const PX = COLW + GAP, PY = ROWH + GAP;
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results = [];
for (const strategy of (process.env.STRATEGIES ?? "canvas,scaled,none").split(",")) for (const [vw, vh] of [[1280, 720], [1366, 768], [1920, 1080], [2560, 1080], [3840, 2160], [1600, 1200]]) {
  const p = await b.newPage();
  await p.setViewport({ width: vw, height: vh });
  await p.goto(`${BASE}?strategy=${strategy}`);
  await p.waitForSelector("[data-item=c]");
  const s = await p.evaluate(() => window.__scale);
  const get = (i) => p.evaluate((i) => { const l = window.__layout.find((x) => x.i === i); return { x: l.x, y: l.y, w: l.w, h: l.h }; }, i);
  async function drag(sel, dx, dy) {
    const r = await (await p.$(sel)).boundingBox();
    const sx = r.x + r.width / 2, sy = r.y + r.height / 2;
    await p.mouse.move(sx, sy); await p.mouse.down();
    for (let k = 1; k <= 10; k++) await p.mouse.move(sx + (dx * k) / 10, sy + (dy * k) / 10);
    await p.mouse.up(); await new Promise((r) => setTimeout(r, 150));
  }
  const checks = [];
  await drag("[data-item=c]", 3 * PX * s, 0);
  checks.push(["drag +3 kol", await get("c"), { x: 3, y: 4, w: 6, h: 4 }]);
  await drag("[data-item=c] .react-resizable-handle-se", 2 * PX * s, 1 * PY * s);
  checks.push(["storlek +2 kol +1 rad", await get("c"), { x: 3, y: 4, w: 8, h: 5 }]);
  await drag("[data-item=c]", 0, -4 * PY * s);
  checks.push(["kollision med A spärras", await get("c"), { x: 3, y: 4, w: 8, h: 5 }]);
  await drag("[data-item=b]", 10 * PX * s, 0);
  checks.push(["gräns höger", await get("b"), { x: 12, y: 0, w: 12, h: 4 }]);
  await drag("[data-item=c]", 0, 10 * PY * s);
  checks.push(["gräns nederkant (12 rader)", await get("c"), { x: 3, y: 7, w: 8, h: 5 }]);
  for (const [name, got, want] of checks) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    results.push({ strategy, vp: `${vw}x${vh}`, scale: +s.toFixed(3), name, ok, got: ok ? "" : JSON.stringify(got) });
  }
  await p.close();
}
await b.close();
console.table(results);
for (const st of new Set(results.map((r) => r.strategy))) console.log(st, results.filter((r) => r.strategy === st && r.ok).length + "/" + results.filter((r) => r.strategy === st).length);
