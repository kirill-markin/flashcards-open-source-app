import { expect, type Locator, type Page } from "@playwright/test";

import {
  trackedClick,
  trackedExpectVisible,
  trackedFill,
} from "../../live-smoke.actions";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

export async function runManualCardReviewFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "create one manual card", async () => {
    await createManualCard(session);
  });

  await runLiveSmokeStep(session, "verify the manual card in cards and review it", async () => {
    await assertCardVisibleInCards(session);
    await reviewCardFromQueue(session);
  });
}

async function createManualCard(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open cards navigation", page.locator('nav.nav a[href="/cards"]').first());
  await trackedClick(diagnostics, "open new card screen", page.getByTestId("cards-new-card"));
  await trackedFill(diagnostics, `fill card front text ${scenario.manualFrontText}`, page.getByTestId("card-form-front-text"), scenario.manualFrontText);
  await trackedFill(diagnostics, `fill card back text ${scenario.manualBackText}`, page.getByTestId("card-form-back-text"), scenario.manualBackText);
  await trackedClick(diagnostics, "submit manual card", page.getByTestId("card-form-save"));
  await trackedExpectVisible(
    diagnostics,
    "confirm cards screen is visible after manual card save",
    page.getByTestId("cards-screen"),
    externalUiTimeoutMs,
  );
}

async function assertCardVisibleInCards(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open cards navigation for verification", page.locator('nav.nav a[href="/cards"]').first());
  const searchInput = page.getByTestId("cards-search-input");
  await trackedFill(diagnostics, "clear cards search input", searchInput, "");
  await trackedFill(diagnostics, `fill cards search input with ${scenario.manualFrontText}`, searchInput, scenario.manualFrontText);
  await waitForCardVisibleUnlessSyncing(
    page,
    diagnostics,
    `confirm cards list shows ${scenario.manualFrontText}`,
    page.getByText(scenario.manualFrontText, { exact: true }),
    localUiTimeoutMs,
  );
}

async function reviewCardFromQueue(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open review navigation", page.locator('nav.nav a[href="/review"]').first());
  await trackedExpectVisible(
    diagnostics,
    `confirm review queue shows ${scenario.manualFrontText}`,
    page.locator(".review-front").filter({ hasText: scenario.manualFrontText }).first(),
    localUiTimeoutMs,
  );
  await trackedClick(diagnostics, "reveal review answer", page.getByTestId("review-reveal-answer"));
  await trackedClick(diagnostics, "submit Good review answer", page.getByTestId("review-rate-good"));
  await session.diagnostics.runAction(`confirm review queue moved past ${scenario.manualFrontText}`, async () => {
    await expect.poll(
      async () => page.locator(".review-pane").innerText(),
      { timeout: localUiTimeoutMs },
    ).not.toContain(scenario.manualFrontText);
  });
}

async function waitForCardVisibleUnlessSyncing(
  page: Page,
  diagnostics: LiveSmokeSession["diagnostics"],
  actionName: string,
  expectedCard: Locator,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    const syncStatus = page.locator(".topbar-sync-status");
    await expect.poll(
      async () => {
        if (await expectedCard.isVisible().catch(() => false)) {
          return "visible";
        }

        if (await syncStatus.first().isVisible().catch(() => false)) {
          return "syncing";
        }

        return "missing";
      },
      { timeout: timeoutMs },
    ).toBe("visible");
  });
}
