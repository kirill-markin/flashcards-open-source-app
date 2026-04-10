import { expect, type Locator } from "@playwright/test";

import {
  trackedClick,
  trackedExpectVisible,
  trackedFill,
  trackedIsVisible,
  trackedReadRequiredTextContent,
} from "../../live-smoke.actions";
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
  const { page, diagnostics, scenario } = session;
  const activeWorkspaceTopbar = page.getByTestId("topbar-active-workspace");
  const settingsTabs = page.locator(".settings-switcher");
  const hasSettingsTabs = await trackedIsVisible(
    diagnostics,
    "check whether settings tabs are already visible before cleanup",
    settingsTabs,
  );

  if (hasSettingsTabs === false) {
    await trackedClick(
      diagnostics,
      "open settings navigation before cleanup",
      page.locator('nav.nav a[href="/settings"]').first(),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm settings tabs are visible before cleanup",
      settingsTabs,
      localUiTimeoutMs,
    );
  }

  const startsOnOverview = await diagnostics.runAction(
    "check whether cleanup already starts on workspace overview",
    async () => page.url().endsWith("/settings/workspace/overview"),
  );

  if (startsOnOverview === false) {
    await trackedClick(
      diagnostics,
      "open workspace tab from settings shell",
      page.locator('.settings-switcher a[href="/settings/workspace"]').first(),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm workspace settings screen is visible",
      page.locator(".settings-panel"),
      localUiTimeoutMs,
    );
    await trackedClick(
      diagnostics,
      "open workspace overview screen",
      page.locator('a[href="/settings/workspace/overview"]').first(),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm workspace overview screen is visible",
      page.locator('button.settings-danger-btn').first(),
      localUiTimeoutMs,
    );
  }

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
