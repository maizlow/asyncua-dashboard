// Draft -> validate -> publish -> versions/restore -> YAML export, on the demo build (localStorage).
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function publish(page: Page, comment: string) {
  await page.getByTestId("publish-open").click();
  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog.getByTestId("publish-summary")).toContainText("Inga fel", { timeout: 20_000 });
  await dialog.getByTestId("publish-comment").fill(comment);
  await dialog.getByTestId("publish-confirm").click();
  await expect(dialog).toBeHidden();
}

test("publicera, TV-demon visar versionen, återställ en äldre version", async ({ page, context }) => {
  await page.goto("editor/");
  await expect(page.getByTestId("changes")).toHaveText("Publicerad version 1");
  await expect(page.getByTestId("publish-open")).toBeDisabled();
  await page.getByTestId("screen-2").click();
  await page.getByTestId("item-s2-1").click();
  await page.getByTestId("prop-label").fill("Pannor idag");
  await publish(page, "Ny etikett");
  await expect(page.getByTestId("notice")).toContainText("Publicerad som version 2");
  await expect(page.getByTestId("changes")).toHaveText("Publicerad version 2");

  // The TV demo in the same browser shows the published version
  const tv = await context.newPage();
  await tv.goto("?screen=2");
  await expect(tv.getByText("Pannor idag")).toBeVisible();

  // Restore version 1: loaded as a draft, published as version 3
  await page.getByTestId("versions-open").click();
  const versions = page.getByTestId("versions-dialog");
  await expect(versions.getByTestId("version-2")).toContainText("Ny etikett");
  await expect(versions.getByTestId("version-2")).toContainText("publicerad");
  await versions.getByTestId("restore-1").click();
  await expect(page.getByTestId("item-s2-1")).toContainText("Produktion");
  await expect(page.getByTestId("changes")).toContainText("Ändrat, inte publicerat");
  await publish(page, "Tillbaka till version 1");
  await expect(page.getByTestId("changes")).toHaveText("Publicerad version 3");
  // The TV tab reloads when the demo publishes
  await expect(tv.getByText("Produktion").first()).toBeVisible();
  await expect(tv.getByText("Pannor idag")).toHaveCount(0);
});

test("utkastet sparas och finns kvar efter omladdning", async ({ page }) => {
  await page.goto("editor/");
  await page.getByTestId("screen-2").click();
  await page.getByTestId("item-s2-1").click();
  await page.getByTestId("prop-label").fill("Utkastetikett");
  await expect(page.getByTestId("changes")).toContainText("utkast sparat");
  await page.reload();
  await expect(page.getByTestId("notice")).toContainText("Fortsätter på utkastet");
  await page.getByTestId("screen-2").click();
  await expect(page.getByTestId("item-s2-1")).toContainText("Utkastetikett");
  // Undoing back to the published version removes the draft
  await page.getByTestId("item-s2-1").click();
  await page.getByTestId("prop-label").fill("Produktion");
  await expect(page.getByTestId("changes")).toHaveText("Publicerad version 1");
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId("notice")).not.toContainText("utkastet");
});

test("fel stoppar publicering (läsbarhet i värsta fallet)", async ({ page }) => {
  // The stress layout: s2-2 doesn't fit 12 × 4 with worst-case values
  await page.goto("editor/?layout=stress");
  await page.getByTestId("screen-2").click();
  await page.getByTestId("item-s2-1").click();
  await page.getByTestId("prop-label").fill("Ändrad");
  await page.getByTestId("publish-open").click();
  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog.getByTestId("publish-summary")).toContainText("fel måste rättas", { timeout: 20_000 });
  await expect(dialog.getByTestId("publish-issues")).toContainText("s2-2");
  await expect(dialog.getByTestId("publish-confirm")).toHaveCount(0);
  // Clicking the problem selects the element
  await dialog.getByTestId("publish-issues").getByRole("button").filter({ hasText: "s2-2" }).first().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("item-s2-2")).toHaveClass(/aud-selected/);
});

test("YAML-export av utkastet", async ({ page }) => {
  await page.goto("editor/?layout=multi");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-draft").click()]);
  expect(download.suggestedFilename()).toBe("layout-utkast.yaml");
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("schema_version: 2");
  expect(text).toContain("plc2:");
  expect(text).not.toContain("customerLogo");
});
