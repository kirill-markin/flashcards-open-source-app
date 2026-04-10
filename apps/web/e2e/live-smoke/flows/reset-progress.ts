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

export async function runResetProgressFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "confirm the reviewed manual card still exists in cards", async () => {
    await confirmReviewedManualCardStillExists(session);
  });

  await runLiveSmokeStep(session, "reset the reviewed manual card through the danger zone flow", async () => {
    await completeResetProgressFlow(session);
  });

  await runLiveSmokeStep(session, "confirm the card becomes due again after reset", async () => {
    await confirmReviewedManualCardBecomesDueAgain(session);
  });
}

async function confirmReviewedManualCardStillExists(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;

  await trackedClick(diagnostics, "open cards navigation before reset", page.locator('nav.nav a[href="/cards"]').first());
  await trackedFill(
    diagnostics,
    `search cards for ${scenario.manualFrontText}`,
    page.getByTestId("cards-search-input"),
    scenario.manualFrontText,
  );
  await trackedExpectVisible(
    diagnostics,
    `confirm cards list still shows ${scenario.manualFrontText}`,
    page.locator(`[data-testid="cards-row"][data-card-front-text=${JSON.stringify(scenario.manualFrontText)}]`).first(),
    externalUiTimeoutMs,
  );
}

async function completeResetProgressFlow(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;

  await trackedClick(diagnostics, "open settings navigation before reset", page.locator('nav.nav a[href="/settings"]').first());
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

async function confirmReviewedManualCardBecomesDueAgain(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;

  await trackedClick(diagnostics, "open review navigation after reset", page.locator('nav.nav a[href="/review"]').first());
  await trackedExpectAttribute(
    diagnostics,
    `confirm the reviewed card becomes due again: ${scenario.manualFrontText}`,
    page.getByTestId("review-current-front-card"),
    "data-card-front-text",
    scenario.manualFrontText,
    externalUiTimeoutMs,
  );
}
