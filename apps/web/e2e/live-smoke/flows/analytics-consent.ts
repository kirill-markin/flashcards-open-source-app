import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";

import {
  attachPageSnapshot,
  createLiveSmokeDiagnostics,
  normalizeError,
} from "../../live-smoke.diagnostics";
import { shareRoute } from "../../../src/routes";
import { externalUiTimeoutMs, liveSmokeBrowserLocale, liveSmokeEnvironment, localUiTimeoutMs } from "../config";

/**
 * Answers the jurisdiction question for this page instead of letting the runner's own location
 * answer it. The banner is owed only where `GET /v1/analytics/visitor` says consent is required, and
 * the release workflow runs this suite from a GitHub-hosted US runner, whose API Gateway source
 * address the route places outside every consent country: against the real answer the banner would
 * never appear and the scenario would fail on geography rather than on the product.
 *
 * Only the `GET` is stubbed. The `POST` the buttons make is the real call, which is what mints the
 * cookie and what the rest of the flow depends on.
 *
 * The CORS headers are part of the stub because the API is a different origin from the app: the
 * browser drops a credentialed cross-origin answer that does not carry them, and the client reads a
 * dropped answer as a transient failure rather than as consent required.
 */
async function stubConsentRequiredJurisdiction(page: Page): Promise<void> {
  const appOrigin = new URL(liveSmokeEnvironment.appBaseUrl).origin;
  await page.route("**/v1/analytics/visitor", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": appOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ consentRequired: true, visitorId: null }),
    });
  });
}

/**
 * The one scenario that runs on a browser nobody answered the consent banner for, which is the state
 * every first-time visitor is actually in. Every other flow seeds `granted` so it exercises the
 * product; without this one no smoke run would ever see the banner, the awaiting-decision gate
 * behind it, or what the bottom strip does to the page underneath.
 *
 * It uses its own context rather than the shared worker session, because the seed the worker context
 * carries is applied before the app starts and cannot be removed afterwards. A public route is
 * enough: the banner is rendered above the routes so that every surface a visitor lands on asks on
 * the same terms.
 *
 * That route is `/share` because it is a real public route that renders unconditionally in a
 * production build, which is what this suite runs against. Do not move this scenario onto a
 * `/dev/previews/...` route: those are disabled outside the dev server
 * (docs/web-invite-previews.md), and a disabled preview screen replaces the URL with the default
 * authenticated route, so the visitor lands in the authenticated shell and is redirected to the
 * login page before anything on the page can be clicked.
 *
 * It runs outside the shared fixture, so it builds its own diagnostics around its own page: a
 * failure in the release gate arrives with the same console, network and page capture its siblings
 * attach, rather than with a bare assertion message.
 */
export async function runAnalyticsConsentBannerFlow(browser: Browser, testInfo: TestInfo): Promise<void> {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: liveSmokeBrowserLocale,
  });

  try {
    const page = await context.newPage();
    const diagnostics = createLiveSmokeDiagnostics(page);
    diagnostics.startTest(testInfo.title);

    try {
      await stubConsentRequiredJurisdiction(page);
      await page.goto(`${liveSmokeEnvironment.appBaseUrl}${shareRoute}`);

      const banner = page.getByTestId("analytics-consent-banner");
      await expect(banner).toBeVisible({ timeout: externalUiTimeoutMs });
      await expect(page.getByTestId("share-app-screen")).toBeVisible({ timeout: localUiTimeoutMs });

      // The strip is not a modal, so the flow underneath has to stay reachable while it is up —
      // including the bottom-of-page interactions the strip sits near. The MCP option is the last
      // tile on this page, so it is the one the strip actually overlaps, and its copy button reports
      // into a status line rather than navigating away.
      const copyButton = page.getByTestId("share-app-mcp-copy-button");
      const copyStatus = page.getByTestId("share-app-mcp-copy-status");
      await copyButton.click();
      // The status reads `copied` or `failed` depending on whether this browser grants clipboard
      // access, and both prove the click reached the page. Asserting that it is no longer empty
      // rather than matching either word keeps this off the translated copy.
      await expect(copyStatus).not.toBeEmpty({ timeout: localUiTimeoutMs });
      await expect(banner).toBeVisible();

      await page.getByTestId("analytics-consent-allow").click();
      await expect(banner).toBeHidden({ timeout: externalUiTimeoutMs });
      // Answering it must neither reload the page nor disturb what the visitor was doing.
      await expect(copyButton).toBeVisible();
      await expect(copyStatus).not.toBeEmpty();
    } catch (error) {
      const failure = normalizeError(error);
      await diagnostics.attachFailureDetails(testInfo, failure);
      await attachPageSnapshot(page, testInfo, "failure-page", diagnostics);
      throw failure;
    } finally {
      await attachPageSnapshot(page, testInfo, "final-page", diagnostics);
    }
  } finally {
    await context.close();
  }
}
