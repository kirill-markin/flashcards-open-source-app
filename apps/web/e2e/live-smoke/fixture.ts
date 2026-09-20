import { test as base, type BrowserContext } from "@playwright/test";

import {
  attachPageSnapshot,
  createLiveSmokeDiagnostics,
  normalizeError,
} from "../live-smoke.diagnostics";
import { liveSmokeBrowserLocale, liveSmokeEnvironment, reviewEmail } from "./config";
import { buildScenario, runIdFromClock } from "./scenario";
import { enableTestSeedBridge } from "./seedBridge";
import type { LiveSmokeSession } from "./types";

type LiveSmokeWorkerFixtures = {
  liveSmokeSession: LiveSmokeSession;
};

type LiveSmokeTestFixtures = {
  liveSmokeGroup: void;
};

/** The stored analytics switch, written exactly as `apps/web/src/analytics/identity.ts` writes it. */
const analyticsConsentStorageKey = "flashcards-analytics-enabled";

/**
 * Answers the consent banner before the app ever starts, so the product scenarios exercise the
 * product rather than the banner. Every local run needs it: the API cannot place a caller that
 * reaches it without an API Gateway source address, and a caller it cannot place is treated as
 * consent-required. The unseeded banner scenario in `flows/analytics-consent.ts` is what keeps the
 * unanswered state — the one every first-time visitor is actually in — covered.
 */
async function grantAnalyticsConsentForSmoke(context: BrowserContext): Promise<void> {
  await context.addInitScript((storageKey: string) => {
    try {
      window.localStorage.setItem(storageKey, "granted");
    } catch {
      // `about:blank`, which `context.newPage()` opens with, refuses storage access entirely. The
      // seed lands on the real page instead; swallowing this keeps the failure summaries clean.
    }
  }, analyticsConsentStorageKey);
}

export const test = base.extend<LiveSmokeTestFixtures, LiveSmokeWorkerFixtures>({
  liveSmokeSession: [async ({ browser }, use) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: liveSmokeBrowserLocale,
    });
    await enableTestSeedBridge(context);
    await grantAnalyticsConsentForSmoke(context);
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
