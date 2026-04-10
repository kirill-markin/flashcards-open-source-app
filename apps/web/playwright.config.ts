import { defineConfig } from "@playwright/test";
import {
  getLocalE2eEnvironmentDefaults,
  resolveE2eEnvironment,
  validateE2eEnvironment,
} from "./e2e/e2eEnvironment";

const e2eEnvironment = resolveE2eEnvironment(process.env);
validateE2eEnvironment(e2eEnvironment);

const localEnvironmentDefaults = getLocalE2eEnvironmentDefaults();
const appBaseUrl = e2eEnvironment.appBaseUrl;
const traceMode = process.env.FLASHCARDS_E2E_TRACE === "true" ? "on" : "off";
const videoMode = process.env.FLASHCARDS_E2E_VIDEO === "true" ? "on" : "off";
const shouldUseManagedLocalWebServer = e2eEnvironment.target === "local";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  testIgnore: ["**/*.test.ts"],
  timeout: 10 * 60 * 1000,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/e2e-results.xml" }],
  ],
  use: {
    baseURL: appBaseUrl,
    actionTimeout: 10_000,
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    navigationTimeout: 30_000,
    trace: traceMode,
    screenshot: "on",
    video: videoMode,
  },
  webServer: shouldUseManagedLocalWebServer ? {
    command: [
      `VITE_APP_BASE_URL=${localEnvironmentDefaults.appBaseUrl}`,
      `VITE_API_BASE_URL=${localEnvironmentDefaults.apiBaseUrl}`,
      `VITE_AUTH_BASE_URL=${localEnvironmentDefaults.authBaseUrl}`,
      "npm run build",
      "&&",
      "npx vite preview --host 127.0.0.1 --port 3000 --strictPort",
    ].join(" "),
    port: 3000,
    reuseExistingServer: process.env.CI !== "true",
    timeout: 180_000,
  } : undefined,
});
