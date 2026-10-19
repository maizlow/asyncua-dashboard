/**
 * Editor end-to-end tests (drag, resize, publish) against the demo build, in the installed Chrome:
 *   VITE_DEMO=true VITE_BASE=/asyncua-dashboard/ npm run build
 *   CHROME=/usr/bin/google-chrome npm run test:e2e
 * The demo editor needs no backend (it saves in localStorage), so the tests never touch a PLC.
 */
import { defineConfig } from "@playwright/test";

const PORT = 4180;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}/asyncua-dashboard/`,
    viewport: { width: 1920, height: 1080 },
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort${process.env.E2E_DIST ? ` --outDir ${process.env.E2E_DIST}` : ""}`,
    url: `http://localhost:${PORT}/asyncua-dashboard/editor/`,
    env: { VITE_BASE: "/asyncua-dashboard/", VITE_DEMO: "true" },
    reuseExistingServer: !process.env.CI,
  },
});
