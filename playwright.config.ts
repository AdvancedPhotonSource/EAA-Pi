import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(import.meta.dirname, ".runtime/browsers");
const workspace = mkdtempSync(join(tmpdir(), "eaa-pi-browser-"));
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 90000,
  use: { baseURL: "http://127.0.0.1:8037", headless: true, trace: "retain-on-failure" },
  webServer: {
    command: `node bin/eaa-pi.mjs demo --workspace ${workspace} --port 8037`,
    url: "http://127.0.0.1:8037/api/health",
    timeout: 180000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
