// Browsing the PLC in the demo editor (fake S7-1500 address space, no network): lazy tree, search,
// live value, data type checks and picking a node as a tag.
import { expect, test, type Page } from "@playwright/test";

const item = (page: Page, name: string) => page.locator(`[data-testid="tree-item"][data-name="${name}"]`);
async function expand(page: Page, ...names: string[]) {
  for (const n of names) {
    await item(page, n).getByTestId("tree-toggle").click();
    await expect(item(page, n).locator("xpath=..").locator('[data-testid="tree-item"]').nth(1)).toBeVisible();
  }
}

async function openBrowser(page: Page, widget: string) {
  await page.goto("editor/?layout=multi");
  await page.getByTestId("screen-2").click();
  await page.getByTestId(`item-${widget}`).click();
  await page.getByTestId("prop-tag-browse").click();
  await expect(page.getByTestId("opc-browser")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // The demo never talks to a backend or a PLC
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.includes("/api/") || u.protocol === "ws:" || u.protocol === "wss:") throw new Error(`unexpected request ${r.url()}`);
  });
});

test("bläddra lat, se datatyp och värde, skapa en tagg från noden", async ({ page }) => {
  await openBrowser(page, "tv1-oee");
  await expect(page.getByTestId("opc-plc")).toHaveValue("plc1");
  await expect(item(page, "Server")).toBeVisible();
  await expand(page, "PLC_plc1", "DataBlocksGlobal");
  // Big data blocks are capped
  await expand(page, "DB Recept");
  await expect(page.getByTestId("opc-truncated")).toContainText("Visar de första 200");
  await item(page, "DB Recept").getByTestId("tree-toggle").click();
  await expand(page, "DB Produktion", "data");
  await item(page, "oee").click();
  const detail = page.getByTestId("opc-detail");
  await expect(detail.getByTestId("opc-data-type")).toHaveText("Float");
  await expect(detail.getByTestId("opc-value")).toHaveText(/^\d+(,\d+)?$/);
  await expect(detail.getByTestId("opc-fit")).toHaveAttribute("data-level", "ok");
  // plc1 already has OEE: the suggestion is made unique
  await expect(detail.getByTestId("opc-alias")).toHaveValue("OEE2");
  await detail.getByTestId("opc-use").click();
  await expect(page.getByTestId("opc-browser")).toBeHidden();
  await expect(page.getByTestId("prop-tag")).toHaveValue("plc1.OEE2");
  await expect(page.getByTestId("props-panel")).toContainText('ns=3;s="DB Produktion"."data"."oee"');
  await expect(page.getByTestId("problem-count")).toHaveText("✔ Inga fel");
  // Undo removes both the new tag and the binding in one step
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("prop-tag")).toHaveValue("plc1.OEE");
});

test("varnar när datatypen inte passar elementet", async ({ page }) => {
  await openBrowser(page, "tv1-oee"); // a percentage
  await expand(page, "PLC_plc1", "DataBlocksGlobal", "DB Produktion", "data");
  await item(page, "recept").click();
  const fit = page.getByTestId("opc-fit");
  await expect(fit).toHaveAttribute("data-level", "error");
  await expect(fit).toContainText("En text (String) kan inte visas som Procent");
  await item(page, "kor").click();
  await expect(fit).toHaveAttribute("data-level", "error");
  await expect(fit).toContainText("Använd Status");
  await expect(fit).toContainText("Förslag: elementtypen Status");
  // Picking it anyway keeps the warning in the props panel
  await page.getByTestId("opc-use").click();
  await expect(page.getByTestId("prop-tag-fit")).toContainText("Boolean");
});

test("sök i PLC:n och välj en annan PLC; befintlig tagg återanvänds", async ({ page }) => {
  await openBrowser(page, "tv1-glasyr");
  await expect(page.getByTestId("opc-plc")).toHaveValue("plc2");
  await page.getByTestId("opc-filter").fill("niva");
  await page.getByTestId("opc-filter").press("Enter");
  const hit = page.locator('[data-testid="search-result"][data-name="niva"]');
  await expect(hit).toContainText("PLC_plc2 › DataBlocksGlobal › DB Glasyr");
  await hit.click();
  await expect(page.getByTestId("opc-alias")).toHaveValue("Niva");
  await page.getByTestId("opc-use").click();
  await expect(page.getByTestId("prop-tag")).toHaveValue("plc2.Niva");

  // A node that already is a tag: offered as that tag, no duplicate
  await page.getByTestId("prop-tag-browse").click();
  await page.getByTestId("opc-filter").fill("GlazeLevel");
  await page.getByTestId("opc-search").click();
  await page.locator('[data-testid="search-result"][data-name="GlazeLevel"]').click();
  await expect(page.getByTestId("opc-existing")).toContainText("GlazeLevel");
  await page.getByTestId("opc-use").click();
  await expect(page.getByTestId("prop-tag")).toHaveValue("plc2.GlazeLevel");

  // The local filter narrows what is loaded
  await page.getByTestId("prop-tag-browse").click();
  await page.getByTestId("opc-plc").selectOption("plc3");
  await expand(page, "PLC_plc3");
  await page.getByTestId("opc-filter").fill("input");
  await expect(item(page, "Inputs")).toBeVisible();
  await expect(item(page, "Outputs")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("opc-browser")).toBeHidden();
});

test("manuellt nod-id finns kvar", async ({ page }) => {
  await openBrowser(page, "tv1-pack");
  await page.keyboard.press("Escape");
  await page.getByTestId("prop-tag").selectOption("__new");
  await expect(page.getByTestId("new-tag").getByLabel("Nod-id")).toBeVisible();
});

test("tangenter i dialogen når inte duken", async ({ page }) => {
  await openBrowser(page, "tv1-pack");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("opc-browser")).toBeHidden();
  await expect(page.getByTestId("item-tv1-pack")).toBeVisible();
  await expect(page.getByTestId("prop-tag")).toBeVisible();
});
