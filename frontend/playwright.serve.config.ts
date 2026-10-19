/**
 * Smoke test of the production setup: the real FastAPI backend serves the normal (non-demo) build, TV view
 * at / and editor at /editor/, on one port next to /api and /ws. Needs Python with backend/requirements.txt:
 *   npm run build && CHROME=/usr/bin/google-chrome npm run test:serve
 * No PLC is needed (the backend points at an unreachable address).
 */
import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

// Throwaway editor login, made once per run in the main process; the backend script and the test
// workers inherit it through the environment.
process.env.E2E_LOGIN ??= randomBytes(12).toString("base64url");

const PORT = Number(process.env.SERVE_PORT ?? 8010);

export default defineConfig({
  testDir: "e2e-serve",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one backend, one database
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1920, height: 1080 },
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bash e2e-serve/start-backend.sh",
    url: `http://localhost:${PORT}/api/health`,
    env: { SERVE_PORT: String(PORT), E2E_LOGIN: process.env.E2E_LOGIN },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
