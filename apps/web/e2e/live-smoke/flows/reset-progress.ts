import {
  trackedClick,
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

  await trackedClick(diagnostics, "open cards navigation before reset", page.getByRole("link", { name: "Cards", exact: true }));
  await trackedFill(
    diagnostics,
    `search cards for ${scenario.manualFrontText}`,
    page.getByPlaceholder("Search front, back, or tags"),
    scenario.manualFrontText,
  );
  await trackedExpectVisible(
    diagnostics,
    `confirm cards list still shows ${scenario.manualFrontText}`,
    page.getByText(scenario.manualFrontText, { exact: true }),
    externalUiTimeoutMs,
  );
}

async function completeResetProgressFlow(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;

  await trackedClick(diagnostics, "open settings navigation before reset", page.getByRole("link", { name: "Settings", exact: true }));
  await trackedClick(
    diagnostics,
    "open workspace settings screen before reset",
    page.getByRole("navigation", { name: "Settings tabs" }).getByRole("link", { name: "Workspace", exact: true }),
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm workspace settings screen is visible before reset",
    page.getByRole("heading", { name: "Workspace Settings" }),
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open reset all progress dialog",
    page.getByRole("button", { name: "Reset all progress" }),
  );

  const resetDialog = page.getByRole("dialog", { name: "Reset all progress" });
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
    resetDialog.getByRole("textbox", { name: "Confirmation phrase", exact: true }),
    confirmationPhrase,
  );
  await trackedClick(
    diagnostics,
    "continue to reset progress preview",
    resetDialog.getByRole("button", { name: "Continue" }),
  );

  const resetPreviewCount = page.getByTestId("workspace-reset-progress-preview-count");
  await trackedExpectText(
    diagnostics,
    "confirm reset preview shows exactly one card",
    resetPreviewCount,
    "1",
    externalUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "confirm reset all progress",
    resetDialog.getByRole("button", { name: "OK" }),
  );
}

async function confirmReviewedManualCardBecomesDueAgain(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;

  await trackedClick(diagnostics, "open review navigation after reset", page.getByRole("link", { name: "Review", exact: true }));
  await trackedExpectVisible(
    diagnostics,
    `confirm the reviewed card becomes due again: ${scenario.manualFrontText}`,
    page.locator(".review-front").filter({ hasText: scenario.manualFrontText }).first(),
    externalUiTimeoutMs,
  );
}
