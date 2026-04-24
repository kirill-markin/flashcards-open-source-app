import { expect } from "@playwright/test";

import {
  trackedClick,
  trackedExpectAttribute,
  trackedExpectText,
  trackedExpectVisible,
  trackedFill,
  trackedReadRequiredTextContent,
} from "../../live-smoke.actions";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

const resetPreviewTimeoutMs = externalUiTimeoutMs + localUiTimeoutMs;

export async function runResetProgressFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "confirm the reviewed seeded card still exists in cards", async () => {
    await confirmReviewedSeededCardStillExists(session);
  });

  await runLiveSmokeStep(session, "reset the reviewed seeded card through the danger zone flow", async () => {
    await completeResetProgressFlow(session);
  });

  await runLiveSmokeStep(session, "confirm the card becomes due again after reset", async () => {
    await confirmReviewedSeededCardBecomesDueAgain(session);
  });
}

async function confirmReviewedSeededCardStillExists(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;

  await trackedClick(diagnostics, "open cards navigation before reset", page.locator('nav.nav a[href="/cards"]').first());
  await trackedFill(
    diagnostics,
    `search cards for ${scenario.seededFrontText}`,
    page.getByTestId("cards-search-input"),
    scenario.seededFrontText,
  );
  await trackedExpectVisible(
    diagnostics,
    `confirm cards list still shows ${scenario.seededFrontText}`,
    page.locator(`[data-testid="cards-row"][data-card-front-text=${JSON.stringify(scenario.seededFrontText)}]`).first(),
    externalUiTimeoutMs,
  );
}

async function completeResetProgressFlow(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;

  await ensureScenarioWorkspaceSelected(session, "before reset progress flow");

  await trackedClick(
    diagnostics,
    "open settings navigation before reset",
    page.locator('nav.nav a[href="/settings"]').first(),
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm settings screen is visible before opening workspace settings",
    page.locator(".settings-panel"),
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open workspace settings screen before reset",
    page.locator('.settings-switcher a[href="/settings/workspace"]').first(),
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm workspace settings screen is visible before reset",
    page.locator(".settings-panel"),
    localUiTimeoutMs,
  );
  const resetDialog = page.getByTestId("workspace-reset-progress-dialog");
  await trackedClick(
    diagnostics,
    "open reset all progress dialog",
    page.getByTestId("workspace-reset-progress-open"),
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm reset all progress dialog is visible",
    resetDialog,
    localUiTimeoutMs,
  );

  const confirmationPhrase = await trackedReadRequiredTextContent(
    diagnostics,
    "read reset progress confirmation phrase from dialog",
    resetDialog.getByTestId("workspace-reset-progress-confirmation-phrase"),
    externalUiTimeoutMs,
  );

  await trackedFill(
    diagnostics,
    `enter reset progress confirmation phrase ${confirmationPhrase}`,
    resetDialog.locator("#reset-workspace-progress-confirmation"),
    confirmationPhrase,
  );
  await trackedClick(
    diagnostics,
    "continue to reset progress preview",
    resetDialog.getByTestId("workspace-reset-progress-continue-to-preview"),
  );
  await trackedExpectAttribute(
    diagnostics,
    "wait for reset preview dialog to reach preview-ready state",
    resetDialog,
    "data-reset-progress-state",
    "preview-ready",
    resetPreviewTimeoutMs,
  );

  const resetPreviewCount = resetDialog.getByTestId("workspace-reset-progress-preview-count-value");
  await trackedExpectText(
    diagnostics,
    "confirm reset preview machine-readable count shows exactly one card",
    resetPreviewCount,
    "1",
    externalUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "confirm reset all progress",
    resetDialog.getByTestId("workspace-reset-progress-confirm-reset"),
  );
}

async function confirmReviewedSeededCardBecomesDueAgain(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;

  await trackedClick(diagnostics, "open review navigation after reset", page.locator('nav.nav a[href="/review"]').first());
  await trackedExpectAttribute(
    diagnostics,
    `confirm the reviewed card becomes due again: ${scenario.seededFrontText}`,
    page.getByTestId("review-current-front-card"),
    "data-card-front-text",
    scenario.seededFrontText,
    externalUiTimeoutMs,
  );
}

async function ensureScenarioWorkspaceSelected(
  session: LiveSmokeSession,
  actionSuffix: string,
): Promise<void> {
  const { page, diagnostics, scenario } = session;
  const activeWorkspaceValue = page.getByTestId("topbar-active-workspace-value");

  const currentWorkspaceName = await diagnostics.runAction(
    `read active workspace ${actionSuffix}`,
    async () => (await activeWorkspaceValue.textContent())?.trim() ?? "",
  );

  if (currentWorkspaceName !== scenario.workspaceName) {
    await trackedClick(
      diagnostics,
      `open settings navigation to recover workspace ${actionSuffix}`,
      page.locator('nav.nav a[href="/settings"]').first(),
    );
    await trackedExpectVisible(
      diagnostics,
      `confirm settings screen is visible while recovering workspace ${actionSuffix}`,
      page.locator(".settings-panel"),
      localUiTimeoutMs,
    );
    await trackedClick(
      diagnostics,
      `open current workspace settings while recovering workspace ${actionSuffix}`,
      page.locator('.settings-switcher a[href="/settings/current-workspace"]').first(),
    );
    const workspaceActionCard = page.locator(".settings-nav-card-button[data-workspace-management-state]").first();
    await trackedExpectAttribute(
      diagnostics,
      `wait for workspace picker readiness while recovering workspace ${actionSuffix}`,
      workspaceActionCard,
      "data-workspace-management-state",
      "ready",
      externalUiTimeoutMs,
    );
    await trackedClick(
      diagnostics,
      `expand workspace picker while recovering workspace ${actionSuffix}`,
      workspaceActionCard,
    );
    await trackedExpectVisible(
      diagnostics,
      `confirm workspace picker is visible while recovering workspace ${actionSuffix}`,
      page.locator(".settings-workspace-picker"),
      externalUiTimeoutMs,
    );
    await trackedClick(
      diagnostics,
      `select scenario workspace ${scenario.workspaceName} while recovering workspace ${actionSuffix}`,
      page.locator(".settings-workspace-choice").filter({ hasText: scenario.workspaceName }).first(),
    );
  }

  await trackedExpectText(
    diagnostics,
    `confirm topbar shows scenario workspace ${scenario.workspaceName} ${actionSuffix}`,
    activeWorkspaceValue,
    scenario.workspaceName,
    externalUiTimeoutMs,
  );
  await waitForSyncIndicatorToDisappear(session, actionSuffix);
}

async function waitForSyncIndicatorToDisappear(
  session: LiveSmokeSession,
  actionSuffix: string,
): Promise<void> {
  const { page, diagnostics } = session;

  await diagnostics.runAction(`wait for sync indicator to disappear ${actionSuffix}`, async () => {
    const syncStatus = page.locator(".topbar-sync-status");
    await expect.poll(
      async () => syncStatus.first().isVisible().catch(() => false),
      { timeout: resetPreviewTimeoutMs },
    ).toBe(false);
  });
}
