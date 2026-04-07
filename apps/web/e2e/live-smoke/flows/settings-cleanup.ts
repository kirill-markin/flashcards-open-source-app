import {
  trackedClick,
  trackedExpectNotText,
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
  const settingsTabs = page.getByRole("navigation", { name: "Settings tabs" });
  const hasSettingsTabs = await trackedIsVisible(
    diagnostics,
    "check whether settings tabs are already visible before cleanup",
    settingsTabs,
  );

  if (hasSettingsTabs === false) {
    await trackedClick(
      diagnostics,
      "open settings navigation before cleanup",
      page.getByRole("link", { name: "Settings", exact: true }),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm settings tabs are visible before cleanup",
      settingsTabs,
      localUiTimeoutMs,
    );
  }

  const overviewHeading = page.getByRole("heading", { name: "Overview" });
  const startsOnOverview = await trackedIsVisible(
    diagnostics,
    "check whether cleanup already starts on workspace overview",
    overviewHeading,
  );

  if (startsOnOverview === false) {
    await trackedClick(
      diagnostics,
      "open workspace tab from settings shell",
      page.getByRole("link", { name: "Workspace", exact: true }),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm workspace settings screen is visible",
      page.getByRole("heading", { name: "Workspace Settings" }),
      localUiTimeoutMs,
    );
    await trackedClick(
      diagnostics,
      "open workspace overview screen",
      page.locator(".settings-nav-card").filter({ hasText: "Overview" }).first(),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm workspace overview screen is visible",
      overviewHeading,
      localUiTimeoutMs,
    );
  }

  await trackedClick(diagnostics, "open delete workspace dialog", page.getByRole("button", { name: "Delete workspace" }));
  const deleteDialog = page.getByRole("dialog", { name: "Delete workspace" });
  await trackedExpectVisible(
    diagnostics,
    "confirm delete workspace dialog is visible",
    deleteDialog,
    localUiTimeoutMs,
  );

  await waitForDeleteWorkspaceConfirmation(page, diagnostics, deleteDialog);

  const confirmationInput = deleteDialog.getByLabel("Type the phrase exactly to continue.");
  const confirmationPhraseLabel = deleteDialog.getByLabel("confirmation phrase");
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
    deleteDialog.getByRole("button", { name: "Delete workspace" }),
  );
  await trackedExpectNotText(
    diagnostics,
    `confirm topbar no longer shows workspace ${scenario.workspaceName}`,
    page.locator(".topbar-workspace"),
    scenario.workspaceName,
    externalUiTimeoutMs,
  );
}
