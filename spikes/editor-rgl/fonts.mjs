import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setContent("<html><body></body></html>");
const stacks = {
  sans: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};
const r = await p.evaluate((stacks) => {
  const c = document.createElement("canvas").getContext("2d");
  const out = {};
  for (const [k, fam] of Object.entries(stacks)) for (const w of [400, 700]) {
    c.font = `${w} 1000px ${fam}`;
    const H = c.measureText("H"), d = c.measureText("0");
    const span = document.createElement("span"); span.style.font = `${w} 1000px ${fam}`; span.style.lineHeight = "normal"; span.textContent = "H0"; document.body.appendChild(span);
    out[`${k} ${w}`] = { capH: Math.round(H.actualBoundingBoxAscent) / 1000, digit0: Math.round(d.actualBoundingBoxAscent) / 1000, digitW: Math.round(d.width) / 1000, lineBox: span.getBoundingClientRect().height / 1000 };
    span.remove();
  }
  return out;
}, stacks);
console.table(r);
await b.close();
