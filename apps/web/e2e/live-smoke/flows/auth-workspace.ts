import { expect } from "@playwright/test";

import {
  trackedClick,
  trackedExpectAttribute,
  trackedExpectText,
  trackedExpectVisible,
  trackedFill,
} from "../../live-smoke.actions";
import { splitWorkspaceRoutePath } from "../../../src/routes";
import { primaryNavigationLinkSelector } from "../navigation";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import { runGuestConversionFlow } from "./guest-conversion";
import { runWorkspaceCleanupFlow } from "./settings-cleanup";
import { seedLinkedWorkspaceForTest } from "../seedBridge";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

const seededCardCreatedAt = "2024-02-01T09:00:00.000Z";
const seededCardReviewedAt = "2024-02-01T09:10:00.000Z";

export async function runLinkedWorkspaceSetupFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "use a guest and convert it without losing cards or progress", async () => {
    await runGuestConversionFlow(session);
    await runWorkspaceCleanupFlow(session);
    session.cleanupRequested = false;
    session.ownedWorkspaceId = null;
  });

  await runLiveSmokeStep(session, "create an isolated linked workspace for this run", async () => {
    await createEphemeralWorkspace(session);
    session.cleanupRequested = true;
  });

  await runLiveSmokeStep(session, "verify linked account status in the new workspace", async () => {
    await assertLinkedAccountStatus(session);
  });

  await runLiveSmokeStep(session, "seed deterministic linked-workspace review data", async () => {
    await seedDeterministicWorkspaceData(session);
  });
}

async function createEphemeralWorkspace(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open settings navigation", page.locator(primaryNavigationLinkSelector("/settings")).first());
  await trackedClick(
    diagnostics,
    "open current workspace settings",
    page.getByTestId("settings-row-current-workspace"),
  );
  const workspaceActionCard = page.getByTestId("workspace-change-open");
  await trackedExpectAttribute(
    diagnostics,
    "wait for workspace management readiness",
    workspaceActionCard,
    "data-workspace-management-state",
    "ready",
    externalUiTimeoutMs,
  );
  await trackedClick(diagnostics, "open change workspace dialog", workspaceActionCard);
  await trackedExpectVisible(
    diagnostics,
    "confirm change workspace dialog is visible",
    page.getByTestId("workspace-change-dialog"),
    externalUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open new workspace form",
    page.getByTestId("workspace-create-open"),
  );
  await trackedFill(
    diagnostics,
    `fill workspace name ${scenario.workspaceName}`,
    page.getByTestId("workspace-create-name-input"),
    scenario.workspaceName,
  );
  await trackedClick(
    diagnostics,
    `submit workspace creation for ${scenario.workspaceName}`,
    page.getByTestId("workspace-create-submit"),
  );
  await trackedExpectText(
    diagnostics,
    `confirm topbar switched to workspace ${scenario.workspaceName}`,
    page.getByTestId("topbar-active-workspace-value"),
    scenario.workspaceName,
    externalUiTimeoutMs,
  );
  session.ownedWorkspaceId = await diagnostics.runAction("capture the created scenario workspace id", async () => {
    const workspaceId = (await page.getByTestId("topbar-active-workspace").getAttribute("data-workspace-id"))?.trim();
    if (workspaceId === undefined || workspaceId === "") {
      throw new Error("Created scenario workspace id is missing from the topbar");
    }

    await expect.poll(
      () => splitWorkspaceRoutePath(new URL(page.url()).pathname).workspaceId,
      { timeout: externalUiTimeoutMs },
    ).toBe(workspaceId);
    return workspaceId;
  });
}

async function assertLinkedAccountStatus(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, reviewEmail, scenario } = session;
  await trackedClick(diagnostics, "open settings navigation for account verification", page.locator(primaryNavigationLinkSelector("/settings")).first());
  await trackedExpectText(
    diagnostics,
    `confirm settings shows workspace ${scenario.workspaceName}`,
    page.getByTestId("topbar-active-workspace-value"),
    scenario.workspaceName,
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open account status screen",
    page.getByTestId("settings-row-account-status"),
  );
  await trackedExpectText(
    diagnostics,
    "confirm the linked account status",
    page.getByTestId("account-status-email-value"),
    reviewEmail,
    externalUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm account status summary cards are visible",
    page.locator(".settings-detail-grid .settings-summary-card").nth(1),
    externalUiTimeoutMs,
  );
}

async function seedDeterministicWorkspaceData(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  const seedResult = await seedLinkedWorkspaceForTest(
    page,
    diagnostics,
    {
      cards: [
        {
          frontText: scenario.seededFrontText,
          backText: scenario.seededBackText,
          tags: [],
          createdAt: seededCardCreatedAt,
          reviews: [
            {
              rating: 0,
              reviewedAtClient: seededCardReviewedAt,
            },
          ],
        },
      ],
    },
    scenario.workspaceName,
  );

  if (seedResult.cards.length !== 1) {
    throw new Error(`Expected exactly one seeded card, received ${seedResult.cards.length}`);
  }

  const seededCard = seedResult.cards[0];
  if (seededCard.frontText !== scenario.seededFrontText) {
    throw new Error(`Seeded card front text mismatch: expected ${scenario.seededFrontText}, received ${seededCard.frontText}`);
  }
}

