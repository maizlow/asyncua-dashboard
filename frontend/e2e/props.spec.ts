// Props panel from the element schema, tag picker grouped by PLC, new tag by node id, validation
// messages and the live legibility check.
import { expect, test } from "@playwright/test";

test("etikett, ångra som ett steg och fel när den saknas", async ({ page }) => {
  await page.goto("editor/");
  await page.getByTestId("screen-2").click();
  await page.getByTestId("item-s2-1").click();
  const label = page.getByTestId("prop-label");
  await label.fill("Pannor idag");
  await expect(page.getByTestId("item-s2-1")).toContainText("Pannor idag");
  await expect(page.getByTestId("changes")).toContainText("Ändrat, inte publicerat");
  await label.fill("");
  await expect(page.getByTestId("problem-count")).toHaveText("✖ 1 fel");
  await expect(page.getByTestId("props-panel")).toContainText("saknas (obligatorisk)");
  // Typing in one field is one undo step
  await page.getByTestId("undo").click();
  await expect(label).toHaveValue("Produktion");
  await expect(page.getByTestId("problem-count")).toHaveText("✔ Inga fel");
});

test("taggväljaren grupperar per PLC och skriver korta namn för standard-PLC:n", async ({ page }) => {
  await page.goto("editor/?layout=multi");
  await page.getByTestId("screen-2").click();
  await page.getByTestId("item-tv1-oee").click();
  const picker = page.getByTestId("prop-tag");
  const groups = await picker.locator("optgroup").evaluateAll((gs) => gs.map((g) => g.getAttribute("label")));
  expect(groups).toEqual(["plc1 · Linje 3 press (standard)", "plc2 · Glasyr", "plc3 · Packning"]);
  await picker.selectOption("plc2.GlazeLevel");
  await expect(picker).toHaveValue("plc2.GlazeLevel");
  await expect(page.getByTestId("props-panel")).toContainText("ns=1;s=Demo.plc2.GlazeLevel");
  await picker.selectOption("plc1.OEE");
  await expect(page.getByTestId("problem-count")).toHaveText("✔ Inga fel");
});

test("ny tagg från nod-id", async ({ page }) => {
  await page.goto("editor/?layout=multi");
  await page.getByTestId("screen-2").click();
  await page.getByTestId("item-tv1-pack").click();
  await page.getByTestId("prop-tag").selectOption("__new");
  const form = page.getByTestId("new-tag");
  await form.getByLabel("PLC").selectOption("plc3");
  await form.getByLabel("Taggnamn").fill("Pallar");
  await form.getByLabel("Nod-id").fill('ns=3;s="DB Pack"."pallets"');
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(page.getByTestId("prop-tag")).toHaveValue("plc3.Pallar");
  await expect(page.getByTestId("problem-count")).toHaveText("✔ Inga fel");
});

test("läsbarhetskontrollen mäter värsta fallet", async ({ page }) => {
  // Today's dashboard: no errors (at most warnings for heroes under 90 px)
  await page.goto("editor/");
  for (const nr of [2]) {
    await page.getByTestId(`screen-${nr}`).click();
    const chips = page.locator('[data-testid^="audit-"][data-level]');
    await expect(chips).toHaveCount(6);
    expect(await chips.evaluateAll((els) => els.map((e) => e.getAttribute("data-level")))).not.toContain("error");
  }
  // Stress layout: -99 999,9 with a 6-letter unit and a trend doesn't fit 12 × 4 in the worst case
  await page.goto("editor/?layout=stress");
  await page.getByTestId("screen-2").click();
  await expect(page.getByTestId("audit-s2-2")).toHaveAttribute("data-level", "error");
  await page.getByTestId("item-s2-2").click();
  await expect(page.getByTestId("audit-box")).toContainText("värdet får inte plats i rutan");
  await expect(page.getByTestId("problem-count")).toHaveText("✖ 1 fel");
});

test("status: tillstånd och regler", async ({ page }) => {
  await page.goto("editor/?layout=multi&display=tv2");
  await page.getByTestId("item-tv2-glasyr").click();
  await expect(page.getByTestId("props-panel")).toContainText("Tillstånd");
  await page.getByLabel("Text").first().fill("ALLDELES FÖR LÅNG");
  await expect(page.getByLabel("Text").first()).toHaveValue("ALLDELES F"); // maxLength 10
});
