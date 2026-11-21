import { expect, type Locator } from "@playwright/test";

import { trackedClick, trackedWaitForUrl } from "../../live-smoke.actions";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import { primaryNavigationLinkSelector } from "../navigation";
import type { LiveSmokeSession } from "../types";

export async function openCustomInstructionsEditor(session: LiveSmokeSession, entry: Locator): Promise<void> {
  const { page, diagnostics } = session;
  await trackedClick(diagnostics, "open custom instructions", entry);
  await trackedWaitForUrl(page, diagnostics, "wait for the custom instructions editor", /\/settings\/chat-instructions$/, externalUiTimeoutMs);
  await diagnostics.runAction("wait for custom instructions to load in place", async () => {
    await expect(page.getByTestId("chat-instructions-form")).toHaveAttribute("data-load-state", "ready", { timeout: externalUiTimeoutMs });
    await expect(page.getByTestId("chat-instructions-count")).toBeVisible({ timeout: localUiTimeoutMs });
  });
}

export async function openWorkspaceCustomInstructionsEditor(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;
  await trackedClick(diagnostics, "open settings navigation", page.locator(primaryNavigationLinkSelector("/settings")).first());
  await trackedClick(diagnostics, "open current workspace settings", page.getByTestId("settings-row-current-workspace"));
  await openCustomInstructionsEditor(session, page.getByTestId("workspace-chat-instructions-open"));
}
