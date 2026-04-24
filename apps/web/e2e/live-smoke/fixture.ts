import { test as base } from "@playwright/test";

import {
  attachPageSnapshot,
  createLiveSmokeDiagnostics,
  normalizeError,
} from "../live-smoke.diagnostics";
import { liveSmokeEnvironment, reviewEmail } from "./config";
import { buildScenario, runIdFromClock } from "./scenario";
import { enableTestSeedBridge } from "./seedBridge";
import type { LiveSmokeSession } from "./types";

type LiveSmokeWorkerFixtures = {
  liveSmokeSession: LiveSmokeSession;
};

type LiveSmokeTestFixtures = {
  liveSmokeGroup: void;
};

const liveSmokeBrowserLocale = "en-US";

export const test = base.extend<LiveSmokeTestFixtures, LiveSmokeWorkerFixtures>({
  liveSmokeSession: [async ({ browser }, use) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: liveSmokeBrowserLocale,
    });
    await enableTestSeedBridge(context);
    const page = await context.newPage();
    const diagnostics = createLiveSmokeDiagnostics(page);
    const liveSmokeSession: LiveSmokeSession = {
      context,
      page,
      diagnostics,
      scenario: buildScenario(runIdFromClock()),
      baseUrl: liveSmokeEnvironment.appBaseUrl,
      reviewEmail,
      cleanupRequested: false,
    };

    await use(liveSmokeSession);

    if (page.isClosed() === false) {
      await page.close();
    }

    await context.close();
  }, { scope: "worker" }],
  liveSmokeGroup: [async ({ liveSmokeSession }, use, testInfo) => {
    const { diagnostics, page } = liveSmokeSession;
    diagnostics.startTest(testInfo.title);

    try {
      await use();
    } catch (error) {
      const primaryFailure = normalizeError(error);
      await diagnostics.attachFailureDetails(testInfo, primaryFailure);
      await attachPageSnapshot(page, testInfo, "failure-page", diagnostics);
      throw primaryFailure;
    } finally {
      await attachPageSnapshot(page, testInfo, "group-final-page", diagnostics);
    }
  }, { auto: true }],
});
