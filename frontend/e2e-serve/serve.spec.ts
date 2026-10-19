/** The FastAPI-served production build: TV view, editor login and API/WS on the same port. */
import { expect, test, type Page } from "@playwright/test";

const USER = "e2e";
const PASSWORD = process.env.SERVE_PASSWORD!; // set by playwright.serve.config.ts

async function login(page: Page, password = PASSWORD) {
  await page.getByLabel("Namn").fill(USER);
  await page.getByLabel("Lösenord").fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
}

test("TV-vyn på / hämtar sina filer och kopplar upp /ws på samma port", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const assets: { url: string; cache: string | undefined }[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/assets/")) assets.push({ url: r.url(), cache: r.headers()["cache-control"] });
  });
  const socket = page.waitForEvent("websocket");
  const snapshot = socket.then((ws) => ws.waitForEvent("framereceived", { predicate: (f) => String(f.payload).includes("full_snapshot") }));

  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  expect(res?.headers()["cache-control"]).toBe("no-cache");
  expect((await socket).url()).toBe(baseURL!.replace("http", "ws") + "ws");
  await snapshot;

  // The PLC is unreachable, but the TV is connected to the backend: screens render, no "connection lost" banner
  await expect(page.getByText("Anslutningen bröts")).toHaveCount(0);
  await expect(page.locator("img").first()).toBeVisible();
  expect(assets.length).toBeGreaterThan(0);
  for (const a of assets) expect(a.cache, a.url).toBe("public, max-age=31536000, immutable");
  expect(errors).toEqual([]);
});

test("editorn kräver inloggning, och sessionen klarar omladdning och djuplänk", async ({ page, context }) => {
  await page.goto("/editor");
  await expect(page).toHaveURL(/\/editor\/$/);
  await expect(page.getByRole("heading", { name: "Layout-editor" })).toBeVisible();

  await login(page, `${PASSWORD}x`);
  await expect(page.getByText(/fel namn eller lösenord/i)).toBeVisible();

  await login(page);
  await expect(page.getByText(`Inloggad som ${USER}`)).toBeVisible();
  await expect(page.getByTestId("screen-2")).toBeVisible(); // the published layout from dashboard.yaml

  // The session cookie: HttpOnly, SameSite=Strict, only sent to /api/editor. Not Secure: plain HTTP (docs/DRIFT.md)
  const cookie = (await context.cookies()).find((c) => c.path === "/api/editor");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", secure: false });

  await page.reload();
  await expect(page.getByText(`Inloggad som ${USER}`)).toBeVisible();
  await page.goto("/editor/nagot/annat?display=tv1"); // SPA fallback
  await expect(page.getByText(`Inloggad som ${USER}`)).toBeVisible();

  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page.getByRole("heading", { name: "Layout-editor" })).toBeVisible();
  const after = await page.request.get("/api/editor/document");
  expect(after.status()).toBe(401);
});

test("API och okända sökvägar ger JSON, inte en HTML-sida", async ({ request }) => {
  expect((await (await request.get("/api/health")).json()).frontend).toBe(true);
  for (const url of ["/api/finns-inte", "/assets/gammal-AbC.js"]) {
    const r = await request.get(url);
    expect(r.status(), url).toBe(404);
    expect(r.headers()["content-type"] ?? "", url).not.toContain("html");
  }
  const layout = await request.get("/api/layout");
  expect(layout.status()).toBe(200);
  expect((await layout.json()).screens).toBeTruthy();
});
