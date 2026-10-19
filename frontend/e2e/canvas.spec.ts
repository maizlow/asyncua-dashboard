// Drag from the palette, move, resize, collisions and undo on the scaled canvas (the spike's scaling
// fix). Positions are read from data-x/y/w/h on the canvas items (grid cells, 24 × 12).
import { expect, test, type Locator, type Page } from "@playwright/test";

const W = 3840;
const PAD_X = 64;
const PAD_TOP = 48;
const PAD_BOTTOM = 56;
const GAP = 48;
const COL_W = (W - 2 * PAD_X - 23 * GAP) / 24;

/** Client coordinates of the centre of grid cell (col, row) */
async function cell(area: Locator, col: number, row: number) {
  const b = (await area.boundingBox())!;
  const s = b.width / W;
  const rowH = (b.height / s - PAD_TOP - PAD_BOTTOM - 11 * GAP) / 12;
  return { x: b.x + (PAD_X + col * (COL_W + GAP) + COL_W / 2) * s, y: b.y + (PAD_TOP + row * (rowH + GAP) + rowH / 2) * s, s, rowH };
}

async function rect(item: Locator) {
  return {
    x: Number(await item.getAttribute("data-x")),
    y: Number(await item.getAttribute("data-y")),
    w: Number(await item.getAttribute("data-w")),
    h: Number(await item.getAttribute("data-h")),
  };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
  await page.mouse.up();
}

async function newGridScreen(page: Page) {
  await page.getByTestId("add-screen").click();
  await page.getByTestId("add-screen-grid").click();
  await expect(page.getByTestId("grid-area")).toContainText("Dra in element");
}

for (const [w, h] of [
  [1920, 1080],
  [1366, 768],
  [2560, 1080],
]) {
  test(`dra in, flytta, ändra storlek och ångra vid ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("editor/?layout=multi");
    await newGridScreen(page);
    const area = page.getByTestId("grid-area");

    // Drop a counter with the pointer at cell (6, 2): the 12 × 4 element is centred there -> x 0, y 0
    const at = await cell(area, 6, 2);
    await page.getByTestId("palette-counter").dragTo(area, { targetPosition: { x: at.x - (await area.boundingBox())!.x, y: at.y - (await area.boundingBox())!.y } });
    const counter = page.locator('[data-testid^="item-tv1-counter-"]');
    await expect(counter).toHaveCount(1);
    expect(await rect(counter)).toEqual({ x: 0, y: 0, w: 12, h: 4 });

    // Click-to-add puts the next one on the first free spot (x 12, y 0)
    await page.getByTestId("palette-number").click();
    const number = page.locator('[data-testid^="item-tv1-number-"]');
    expect(await rect(number)).toEqual({ x: 12, y: 0, w: 12, h: 4 });

    // Move the counter down 4 rows
    const from = await cell(area, 6, 2);
    const to = await cell(area, 6, 6);
    await drag(page, from, to);
    await expect(counter).toHaveAttribute("data-y", "4");
    expect(await rect(counter)).toEqual({ x: 0, y: 4, w: 12, h: 4 });

    // Resize it from the corner handle: +2 rows
    const handle = counter.locator(".react-resizable-handle");
    const hb = (await handle.boundingBox())!;
    const step = (at.rowH + GAP) * at.s;
    await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 + 2 * step });
    await expect(counter).toHaveAttribute("data-h", "6");

    // Dragging onto the other element never overlaps it (stops at the last free position) and
    // doesn't push it away
    await drag(page, await cell(area, 6, 6), await cell(area, 18, 2));
    const c = await rect(counter);
    const n = await rect(number);
    expect(n).toEqual({ x: 12, y: 0, w: 12, h: 4 });
    expect(c.x < n.x + n.w && n.x < c.x + c.w && c.y < n.y + n.h && n.y < c.y + c.h).toBe(false);
    if (c.x !== 0 || c.y !== 4) {
      await page.getByTestId("undo").click();
      await expect(counter).toHaveAttribute("data-x", "0");
    }

    // Past the bottom edge it stops at row 12
    await drag(page, await cell(area, 6, 6), await cell(area, 6, 30));
    expect(await rect(counter)).toEqual({ x: 0, y: 6, w: 12, h: 6 });

    // Undo the move, the resize; redo the resize
    await page.getByTestId("undo").click();
    expect(await rect(counter)).toEqual({ x: 0, y: 4, w: 12, h: 6 });
    await page.keyboard.press("Control+z");
    expect(await rect(counter)).toEqual({ x: 0, y: 4, w: 12, h: 4 });
    await page.keyboard.press("Control+y");
    expect(await rect(counter)).toEqual({ x: 0, y: 4, w: 12, h: 6 });
  });
}

test("element hamnar på samma pixlar som på TV:n", async ({ page }) => {
  await page.goto("editor/?layout=multi");
  await page.getByTestId("screen-2").click();
  const area = page.getByTestId("grid-area");
  const b = (await area.boundingBox())!;
  const s = b.width / W;
  const item = page.getByTestId("item-tv1-glasyr"); // x 0, y 6, 12 × 6
  const ib = (await item.boundingBox())!;
  const rowH = (b.height / s - PAD_TOP - PAD_BOTTOM - 11 * GAP) / 12;
  expect(Math.abs(ib.x - (b.x + PAD_X * s))).toBeLessThan(1.5);
  expect(Math.abs(ib.y - (b.y + (PAD_TOP + 6 * (rowH + GAP)) * s))).toBeLessThan(1.5);
  expect(Math.abs(ib.width - (12 * COL_W + 11 * GAP) * s)).toBeLessThan(1.5);
});

test("kopiera, klistra in, tangentbord och ta bort", async ({ page }) => {
  await page.goto("editor/?layout=multi");
  await newGridScreen(page);
  await page.getByTestId("palette-percent").click();
  const items = page.locator('[data-testid^="item-tv1-"]');
  await expect(items).toHaveCount(1);
  await page.keyboard.press("Control+d"); // duplicate = copy + paste on the next free spot
  await expect(items).toHaveCount(2);
  const copy = items.nth(1);
  expect(await rect(copy)).toEqual({ x: 0, y: 4, w: 12, h: 4 }); // nearest free spot to the original
  await page.keyboard.press("ArrowDown");
  expect(await rect(copy)).toEqual({ x: 0, y: 5, w: 12, h: 4 });
  await page.keyboard.press("Shift+ArrowDown");
  expect(await rect(copy)).toEqual({ x: 0, y: 5, w: 12, h: 5 });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp"); // would overlap the original: refused with a message
  await expect(page.getByTestId("notice")).toContainText("överlappar");
  expect(await rect(copy)).toEqual({ x: 0, y: 4, w: 12, h: 5 });
  await page.keyboard.press("Delete");
  await expect(items).toHaveCount(1);
});

test("inbyggda skärmar och skärmnummer", async ({ page }) => {
  await page.goto("editor/?layout=multi&display=tv2");
  await page.getByTestId("add-screen").click();
  await page.getByTestId("add-screen-oee").click();
  await expect(page.getByTestId("screen-3")).toContainText("Inbyggd: OEE · plc3");
  await expect(page.getByTestId("palette-number")).toBeDisabled();
  await page.getByTestId("screen-nr").fill("7");
  await page.getByTestId("screen-nr").press("Enter");
  await expect(page.getByTestId("screen-7")).toBeVisible();
  await page.getByTestId("screen-nr").fill("1");
  await page.getByTestId("screen-nr").press("Enter");
  await expect(page.getByTestId("notice")).toContainText("skärm 1 finns redan");
  await expect(page.getByTestId("screen-7")).toBeVisible();
});
