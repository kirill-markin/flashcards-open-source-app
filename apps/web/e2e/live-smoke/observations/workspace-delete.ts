import { type Locator, type Page } from "@playwright/test";

import {
  observeDeleteWorkspaceDialogState,
  trackedClick,
  trackedWaitForDeleteWorkspaceConfirmationState,
  trackedWaitForDeleteWorkspaceRetryTransition,
} from "../../live-smoke.actions";
import type { LiveSmokeDiagnostics } from "../../live-smoke.diagnostics";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";

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

  await trackedClick(
    diagnostics,
    "retry delete workspace details fetch",
    dialog.getByRole("button", { name: "Retry" }),
  );
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
