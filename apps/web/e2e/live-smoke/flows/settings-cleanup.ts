import { expect, type Locator } from "@playwright/test";

import {
  trackedClick,
  trackedExpectVisible,
  trackedFill,
  trackedGoto,
  trackedReadRequiredTextContent,
} from "../../live-smoke.actions";
import { settingsOverviewRoute } from "../../../src/routes";
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
  const activeWorkspaceTopbar = page.getByTestId("topbar-active-workspace");
  await trackedGoto(
    page,
    diagnostics,
    "open workspace overview route before cleanup",
    `${baseUrl}${settingsOverviewRoute}`,
    externalUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm workspace overview screen is visible before cleanup",
    page.locator('button.settings-danger-btn').first(),
    localUiTimeoutMs,
  );

  const deletedWorkspaceId = await readRequiredActiveWorkspaceId(
    diagnostics,
    "capture active workspace id before deleting the isolated workspace",
    activeWorkspaceTopbar,
  );

  await trackedClick(diagnostics, "open delete workspace dialog", page.locator('button.settings-danger-btn').first());
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

async function readRequiredActiveWorkspaceId(
  diagnostics: LiveSmokeSession["diagnostics"],
  actionName: string,
  locator: Locator,
): Promise<string> {
  return diagnostics.runAction(actionName, async () => {
    const activeWorkspaceId = await readActiveWorkspaceId(locator);
    if (activeWorkspaceId === "") {
      throw new Error("Topbar active workspace id contract is missing");
    }

    return activeWorkspaceId;
  });
}

async function readActiveWorkspaceId(locator: Locator): Promise<string> {
  const activeWorkspaceId = await locator.getAttribute("data-workspace-id");
  return activeWorkspaceId?.trim() ?? "";
}
