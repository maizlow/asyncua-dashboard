// Chart/KPI elements in the demo editor: palette, default and minimum sizes, the props panel's
// chart fields, the legibility check, and publishing to the TV demo.
import { expect, test, type Locator, type Page } from "@playwright/test";

const W = 3840;
const PAD_X = 64;
const PAD_TOP = 48;
const PAD_BOTTOM = 56;
const GAP = 48;
const COL_W = (W - 2 * PAD_X - 23 * GAP) / 24;

async function cellPos(area: Locator, col: number, row: number) {
  const b = (await area.boundingBox())!;
  const s = b.width / W;
  const rowH = (b.height / s - PAD_TOP - PAD_BOTTOM - 11 * GAP) / 12;
  return { x: (PAD_X + col * (COL_W + GAP) + COL_W / 2) * s, y: (PAD_TOP + row * (rowH + GAP) + rowH / 2) * s };
}

async function rect(item: Locator) {
  return Object.fromEntries(await Promise.all(["x", "y", "w", "h"].map(async (k) => [k, Number(await item.getAttribute(`data-${k}`))])));
}

async function screenNrs(page: Page) {
  return (await page.locator('[data-testid^="screen-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!)))
    .map((t) => Number(t.slice("screen-".length)))
    .filter((n) => Number.isInteger(n));
}

test("lägg till KPI och stapeldiagram, ändra egenskaper och publicera till TV:n", async ({ page, context }) => {
  await page.goto("editor/");
  const before = await screenNrs(page);
  await page.getByTestId("add-screen").click();
  await page.getByTestId("add-screen-grid").click();
  const nr = (await screenNrs(page)).find((n) => !before.includes(n))!;
  const area = page.getByTestId("grid-area");
  await expect(area).toContainText("Dra in element");

  // Drag a KPI tile in with the pointer at cell (3, 2): its default 6 × 4 is centred there -> x 0, y 0
  await page.getByTestId("palette-kpi").dragTo(area, { targetPosition: await cellPos(area, 3, 2) });
  const kpi = page.locator('[data-testid^="item-tv1-kpi-"]');
  await expect(kpi).toHaveCount(1);
  expect(await rect(kpi)).toEqual({ x: 0, y: 0, w: 6, h: 4 });

  // Click-to-add a bar chart: the default 24 × 12 has no room, so it gets its minimum 12 × 6
  await page.getByTestId("palette-bars").click();
  const bars = page.locator('[data-testid^="item-tv1-bars-"]');
  await expect(bars).toHaveCount(1);
  expect(await rect(bars)).toEqual({ x: 6, y: 0, w: 12, h: 6 });
  // The canvas renders the chart with the simulated history: one column per day
  await expect(bars.locator("[data-week-count]")).toHaveCount(3);

  // KPI props: calculated value "good today" against the target so far, label
  await kpi.click();
  const panel = page.getByTestId("props-panel");
  await expect(panel).toContainText("KPI-ruta");
  await panel.getByTestId("prop-metric").selectOption("good");
  await panel.getByTestId("prop-period").selectOption("today");
  await panel.getByTestId("prop-target_metric").selectOption("target");
  await panel.getByTestId("prop-label").fill("Idag e2e");
  await expect(kpi).toContainText("IDAG E2E", { ignoreCase: true });
  // Switching to a live tag swaps metric/period for the tag picker
  await panel.getByTestId("prop-source").selectOption("tag");
  await expect(panel.getByTestId("prop-metric")).toHaveCount(0);
  await expect(panel.getByTestId("prop-tag")).toBeVisible();
  await panel.getByTestId("prop-source").selectOption("");
  await expect(panel.getByTestId("prop-metric")).toBeVisible();
  await panel.getByTestId("prop-metric").selectOption("good");
  await panel.getByTestId("prop-period").selectOption("today");

  // The panel shows the size (the grid refuses anything under the 6 × 4 minimum)
  await expect(page.getByTestId("item-rect")).toContainText("6×4");

  // Legibility with six-digit worst-case values: no errors on either chart
  await expect(page.getByTestId(`audit-${await kpi.getAttribute("data-testid").then((t) => t!.slice(5))}`)).not.toHaveAttribute("data-level", "error");
  await expect(page.getByTestId(`audit-${await bars.getAttribute("data-testid").then((t) => t!.slice(5))}`)).not.toHaveAttribute("data-level", "error");

  // Publish and look at the TV demo
  await page.getByTestId("publish-open").click();
  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog.getByTestId("publish-summary")).toContainText("Inga fel", { timeout: 20_000 });
  await dialog.getByTestId("publish-comment").fill("Diagram");
  await dialog.getByTestId("publish-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("notice")).toContainText("Publicerad som version 2");

  const tv = await context.newPage();
  await tv.goto(`?screen=${nr}`);
  await expect(tv.getByText("Idag e2e", { exact: false })).toBeVisible();
  await expect(tv.locator("[data-chart] [data-week-count]")).toHaveCount(3);
  // Swedish number format on the TV: grouped digits, no decimals for counts
  await expect(tv.locator("[data-item] [data-fit-value]").first()).toHaveText(/\d{1,3}(\s\d{3})+/);
});

test("diagramfel i egenskapspanelen och läsbarheten spärrar publicering", async ({ page }) => {
  await page.goto("editor/?layout=diagram");
  await page.getByTestId("screen-1").click();
  await page.getByTestId("item-d-oee7").click();
  const panel = page.getByTestId("props-panel");
  // A shift-only value (prognosis) is offered for the current shift; switching to 7 days is an error at the field
  await panel.getByTestId("prop-period").selectOption("");
  await panel.getByTestId("prop-metric").selectOption("prognosis");
  await panel.getByTestId("prop-period").selectOption("7d");
  await expect(panel).toContainText("finns bara för pågående skift");
  await page.getByTestId("publish-open").click();
  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog.getByTestId("publish-summary")).toContainText("fel måste rättas", { timeout: 20_000 });
  await expect(dialog.getByTestId("publish-issues")).toContainText("'prognosis' finns bara för pågående skift (inte 7 dagar)");
  await expect(dialog.getByTestId("publish-confirm")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Back to OEE: no field error. A 7-day table with 8 shift rows on 12 x 6 doesn't fit -> legibility error
  await panel.getByTestId("prop-metric").selectOption("oee");
  await expect(panel).not.toContainText("finns bara för pågående skift");
  await page.getByTestId("screen-2").click();
  await page.getByTestId("item-d-table").click();
  await page.getByTestId("prop-count").fill("14");
  await expect(page.getByTestId("audit-d-table")).toHaveAttribute("data-level", "error");
});

test("exempellayouterna klarar läsbarheten i värsta fallet (kan publiceras från editorn)", async ({ page }) => {
  for (const [layout, screens] of [["diagram", [1, 2, 3, 4]], ["oee-element", [1]], ["7dagar-element", [1]]] as const) {
    await page.goto(`editor/?layout=${layout}`);
    for (const nr of screens) {
      await page.getByTestId(`screen-${nr}`).click();
      await expect(page.locator('[data-testid^="audit-"]').first()).toBeVisible();
      const levels = await page.locator('[data-testid^="audit-"][data-level]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")}:${e.getAttribute("data-level")}`));
      expect(levels.filter((l) => l.endsWith(":error")), `${layout} skärm ${nr}`).toEqual([]);
    }
  }
});
