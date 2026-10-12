import { expect, type Locator } from "@playwright/test";

import {
  trackedClick,
  trackedExpectAttribute,
  trackedExpectVisible,
  trackedFill,
  trackedGoto,
  trackedReadRequiredTextContent,
} from "../../live-smoke.actions";
import { buildWorkspaceRoute, settingsDeleteCurrentWorkspaceRoute } from "../../../src/routes";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import { waitForDeleteWorkspaceConfirmation } from "../observations/workspace-delete";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

export async function runWorkspaceCleanupFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "delete the isolated workspace", async () => {
    await deleteEphemeralWorkspace(session);
  });
}

async function deleteEphemeralWorkspace(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario, baseUrl } = session;
  const deletedWorkspaceId = session.ownedWorkspaceId;
  if (deletedWorkspaceId === null) {
    throw new Error("Cannot clean up the scenario workspace without its captured owned workspace id");
  }
  const activeWorkspaceTopbar = page.getByTestId("topbar-active-workspace");
  await trackedGoto(
    page,
    diagnostics,
    "open the owned workspace deletion route before cleanup",
    `${baseUrl}${buildWorkspaceRoute(deletedWorkspaceId, settingsDeleteCurrentWorkspaceRoute)}`,
    externalUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm delete current workspace screen is visible before cleanup",
    page.getByTestId("delete-current-workspace-open"),
    localUiTimeoutMs,
  );

  await trackedExpectAttribute(
    diagnostics,
    "confirm the owned workspace is active before opening deletion",
    activeWorkspaceTopbar,
    "data-workspace-id",
    deletedWorkspaceId,
    externalUiTimeoutMs,
  );

  await trackedClick(diagnostics, "open delete workspace dialog", page.getByTestId("delete-current-workspace-open"));
  const deleteDialog = page.locator(".settings-delete-dialog-backdrop");
  await trackedExpectVisible(
    diagnostics,
    "confirm delete workspace dialog is visible",
    deleteDialog,
    localUiTimeoutMs,
  );

  await waitForDeleteWorkspaceConfirmation(page, diagnostics, deleteDialog);

  const confirmationInput = deleteDialog.locator("#delete-workspace-confirmation");
  const confirmationPhraseLabel = deleteDialog.locator(".settings-delete-phrase");
  const confirmationPhrase = await trackedReadRequiredTextContent(
    diagnostics,
    "read delete workspace confirmation phrase after details resolve",
    confirmationPhraseLabel,
    externalUiTimeoutMs,
  );

  await trackedFill(
    diagnostics,
    `enter delete workspace confirmation phrase ${confirmationPhrase}`,
    confirmationInput,
    confirmationPhrase,
  );
  await trackedExpectAttribute(
    diagnostics,
    "confirm the owned workspace is active before submitting deletion",
    activeWorkspaceTopbar,
    "data-workspace-id",
    deletedWorkspaceId,
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    `submit workspace deletion for ${scenario.workspaceName}`,
    deleteDialog.locator(".screen-actions .settings-danger-btn").first(),
  );
  await diagnostics.runAction(
    `confirm topbar active workspace id switched away from deleted workspace ${deletedWorkspaceId}`,
    async () => {
      await expect.poll(
        async () => {
          const activeWorkspaceId = await readActiveWorkspaceId(activeWorkspaceTopbar);
          return activeWorkspaceId !== "" && activeWorkspaceId !== deletedWorkspaceId;
        },
        { timeout: externalUiTimeoutMs },
      ).toBe(true);
    },
  );
}

async function readActiveWorkspaceId(locator: Locator): Promise<string> {
  const activeWorkspaceId = await locator.getAttribute("data-workspace-id");
  return activeWorkspaceId?.trim() ?? "";
}
