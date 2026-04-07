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
  await trackedClick(diagnostics, "open cards navigation", page.getByRole("link", { name: "Cards", exact: true }));
  await trackedClick(diagnostics, "open new card screen", page.getByRole("link", { name: "New card", exact: true }));
  await trackedFill(diagnostics, `fill card front text ${scenario.manualFrontText}`, page.getByLabel("Front"), scenario.manualFrontText);
  await trackedFill(diagnostics, `fill card back text ${scenario.manualBackText}`, page.getByLabel("Back"), scenario.manualBackText);
  await trackedClick(diagnostics, "submit manual card", page.getByRole("button", { name: "Save card" }));
  await trackedExpectVisible(
    diagnostics,
    "confirm cards heading is visible after manual card save",
    page.getByRole("heading", { name: "Cards" }),
    externalUiTimeoutMs,
  );
}

async function assertCardVisibleInCards(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open cards navigation for verification", page.getByRole("link", { name: "Cards", exact: true }));
  const searchInput = page.getByPlaceholder("Search front, back, or tags");
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
  await trackedClick(diagnostics, "open review navigation", page.getByRole("link", { name: "Review", exact: true }));
  await trackedExpectVisible(
    diagnostics,
    `confirm review queue shows ${scenario.manualFrontText}`,
    page.locator(".review-front").filter({ hasText: scenario.manualFrontText }).first(),
    localUiTimeoutMs,
  );
  await trackedClick(diagnostics, "reveal review answer", page.getByRole("button", { name: "Reveal answer" }));
  await trackedClick(diagnostics, "submit Good review answer", page.getByRole("button", { name: "Good" }));
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

        const syncStatusCount = await syncStatus.count();
        if (syncStatusCount > 0) {
          const syncText = await syncStatus.first().innerText();
          if (syncText.trim() === "Syncing...") {
            return "syncing";
          }
        }

        return "missing";
      },
      { timeout: timeoutMs },
    ).toBe("visible");
  });
}
