import { type Locator, type Page } from "@playwright/test";

import {
  observeDeleteWorkspaceDialogState,
  trackedWaitForDeleteWorkspaceConfirmationState,
  trackedWaitForDeleteWorkspaceRetryTransition,
  type DeleteWorkspaceDialogObservation,
} from "../../live-smoke.actions";
import type { LiveSmokeDiagnostics } from "../../live-smoke.diagnostics";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";

type DeleteWorkspaceRetryActionResult = "confirmation" | "retryClicked";

export async function waitForDeleteWorkspaceConfirmation(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  dialog: Locator,
): Promise<void> {
  let deleteDialogState = await trackedWaitForDeleteWorkspaceConfirmationState(
    page,
    diagnostics,
    "wait for delete workspace details",
    dialog,
    externalUiTimeoutMs,
  );

  if (deleteDialogState !== "retry") {
    return;
  }

  const retryActionResult = await retryDeleteWorkspaceDetailsFetch(diagnostics, dialog);
  if (retryActionResult === "confirmation") {
    return;
  }

  await trackedWaitForDeleteWorkspaceRetryTransition(
    page,
    diagnostics,
    "wait for delete workspace dialog to transition after retry",
    dialog,
    localUiTimeoutMs,
  );
  deleteDialogState = await trackedWaitForDeleteWorkspaceConfirmationState(
    page,
    diagnostics,
    "wait for delete workspace details after retry",
    dialog,
    externalUiTimeoutMs,
  );

  if (deleteDialogState === "confirmation") {
    return;
  }

  const finalObservation = await observeDeleteWorkspaceDialogState(dialog);
  throw new Error(
    "Delete workspace dialog stayed in retry state after retry "
    + `(state=${finalObservation.state}, loadingVisible=${finalObservation.isLoadingVisible}, `
    + `retryVisible=${finalObservation.isRetryVisible}, `
    + `confirmationPhraseVisible=${finalObservation.isConfirmationPhraseVisible}, `
    + `confirmationInputVisible=${finalObservation.isConfirmationInputVisible})`,
  );
}

async function retryDeleteWorkspaceDetailsFetch(
  diagnostics: LiveSmokeDiagnostics,
  dialog: Locator,
): Promise<DeleteWorkspaceRetryActionResult> {
  return diagnostics.runAction("retry delete workspace details fetch", async () => {
    const retryButton = dialog.locator(".screen-actions .primary-btn").first();
    const observationBeforeClick = await observeDeleteWorkspaceDialogState(dialog);

    if (observationBeforeClick.state === "confirmation") {
      return "confirmation";
    }

    if (observationBeforeClick.state !== "retry") {
      throw new Error(
        "Delete workspace retry was requested while the dialog was not in retry state "
        + formatDeleteWorkspaceDialogObservation(observationBeforeClick),
      );
    }

    try {
      await retryButton.click({ timeout: localUiTimeoutMs });
      return "retryClicked";
    } catch (error) {
      const observationAfterFailedClick = await observeDeleteWorkspaceDialogState(dialog);
      if (observationAfterFailedClick.state === "confirmation") {
        return "confirmation";
      }

      throw error;
    }
  });
}

function formatDeleteWorkspaceDialogObservation(
  observation: DeleteWorkspaceDialogObservation,
): string {
  return `(state=${observation.state}, loadingVisible=${observation.isLoadingVisible}, `
    + `retryVisible=${observation.isRetryVisible}, `
    + `confirmationPhraseVisible=${observation.isConfirmationPhraseVisible}, `
    + `confirmationInputVisible=${observation.isConfirmationInputVisible})`;
}
