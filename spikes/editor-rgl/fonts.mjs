// Font metrics in em for the stacks the app uses: font-sans = 'Geist Variable' (bundled via
// @fontsource-variable/geist, needs `npm ci` in frontend/), font-mono = Tailwind's system stack.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const geist = fileURLToPath(new URL("../../frontend/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2", import.meta.url));
const page = join(tmpdir(), "spike-fonts.html");
writeFileSync(page, `<style>@font-face{font-family:'Geist Variable';font-weight:100 900;src:url(${pathToFileURL(geist)}) format('woff2')}</style><body></body>`);

const stacks = {
  "sans (Geist Variable)": "'Geist Variable', sans-serif",
  "mono (system)": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
const p = await b.newPage();
await p.goto(pathToFileURL(page).href);
const r = await p.evaluate(async (stacks) => {
  for (const w of [400, 700]) await document.fonts.load(`${w} 100px 'Geist Variable'`);
  const c = document.createElement("canvas").getContext("2d");
  const out = {};
  for (const [k, fam] of Object.entries(stacks)) for (const w of [400, 700]) {
    c.font = `${w} 1000px ${fam}`;
    const H = c.measureText("H"), d = c.measureText("0");
    const span = document.createElement("span");
    span.style.font = `${w} 1000px ${fam}`; span.style.lineHeight = "normal"; span.textContent = "H0";
    document.body.appendChild(span);
    out[`${k} ${w}`] = { capH: Math.round(H.actualBoundingBoxAscent) / 1000, digit0: Math.round(d.actualBoundingBoxAscent) / 1000, digitW: Math.round(d.width) / 1000, lineBox: span.getBoundingClientRect().height / 1000 };
    span.remove();
  }
  out.geistLoaded = document.fonts.check("400 100px 'Geist Variable'");
  return out;
}, stacks);
console.table(r);
await b.close();
