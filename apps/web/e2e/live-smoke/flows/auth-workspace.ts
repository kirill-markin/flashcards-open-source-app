import {
  trackedClick,
  trackedExpectAttribute,
  trackedExpectText,
  trackedExpectVisible,
  trackedFill,
  trackedGoto,
  trackedIsVisible,
  trackedWaitForUrl,
} from "../../live-smoke.actions";
import { authBaseUrl, externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import { seedLinkedWorkspaceForTest } from "../seedBridge";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

const seededCardCreatedAt = "2024-02-01T09:00:00.000Z";
const seededCardReviewedAt = "2024-02-01T09:10:00.000Z";

export async function runLinkedWorkspaceSetupFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "sign in with the configured review account", async () => {
    await signInWithReviewAccount(session);
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

async function signInWithReviewAccount(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, baseUrl, reviewEmail } = session;
  await trackedGoto(
    page,
    diagnostics,
    `open auth login page for ${reviewEmail}`,
    buildLoginUrl(baseUrl),
    externalUiTimeoutMs,
  );
  await trackedFill(diagnostics, `fill review account email ${reviewEmail}`, page.locator('input[type="email"]').first(), reviewEmail);
  await trackedClick(diagnostics, "submit review account email", page.locator("#send-btn"));
  await trackedWaitForUrl(
    page,
    diagnostics,
    "wait for review redirect after auth",
    new RegExp(`^${escapeRegExp(`${baseUrl}/review`)}`),
    externalUiTimeoutMs,
  );

  const chooseWorkspaceHeading = page.locator(".workspace-choice-list");
  const chooseWorkspaceVisible = await trackedIsVisible(
    diagnostics,
    "check whether auth restored into the workspace chooser",
    chooseWorkspaceHeading,
  );

  if (chooseWorkspaceVisible) {
    await trackedClick(
      diagnostics,
      "select the first linked workspace from the workspace chooser",
      page.locator(".workspace-choice-btn").first(),
    );
  }

  await trackedExpectVisible(
    diagnostics,
    "confirm primary navigation is visible after auth",
    page.locator("nav.nav"),
    localUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm review navigation link is visible after auth",
    page.locator('nav.nav a[href="/review"]').first(),
    localUiTimeoutMs,
  );
}

async function createEphemeralWorkspace(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open settings navigation", page.locator('nav.nav a[href="/settings"]').first());
  await trackedClick(
    diagnostics,
    "open current workspace settings",
    page.locator('.settings-switcher a[href="/settings/current-workspace"]').first(),
  );
  const workspaceActionCard = page.locator(".settings-nav-card-button[data-workspace-management-state]").first();
  await trackedExpectAttribute(
    diagnostics,
    "wait for workspace management readiness",
    workspaceActionCard,
    "data-workspace-management-state",
    "ready",
    externalUiTimeoutMs,
  );
  await trackedClick(diagnostics, "expand workspace picker card", workspaceActionCard);
  await trackedExpectVisible(
    diagnostics,
    "confirm workspace picker is visible",
    page.locator(".settings-workspace-picker"),
    externalUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open new workspace form",
    page.locator(".settings-workspace-picker > button.ghost-btn").first(),
  );
  await trackedFill(diagnostics, `fill workspace name ${scenario.workspaceName}`, page.locator(".settings-workspace-create-input"), scenario.workspaceName);
  await trackedClick(
    diagnostics,
    `submit workspace creation for ${scenario.workspaceName}`,
    page.locator(".settings-workspace-create-actions .primary-btn"),
  );
  await trackedExpectText(
    diagnostics,
    `confirm topbar switched to workspace ${scenario.workspaceName}`,
    page.getByTestId("topbar-active-workspace-value"),
    scenario.workspaceName,
    externalUiTimeoutMs,
  );
}

async function assertLinkedAccountStatus(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, reviewEmail, scenario } = session;
  await trackedClick(diagnostics, "open settings navigation for account verification", page.locator('nav.nav a[href="/settings"]').first());
  await trackedExpectText(
    diagnostics,
    `confirm settings shows workspace ${scenario.workspaceName}`,
    page.getByTestId("topbar-active-workspace-value"),
    scenario.workspaceName,
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open account settings screen",
    page.locator('.settings-switcher a[href="/settings/account"]').first(),
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm account settings heading is visible",
    page.locator(".settings-panel"),
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open account status screen",
    page.locator('a[href="/settings/account/status"]').first(),
  );
  await trackedExpectText(
    diagnostics,
    `confirm account status shows ${reviewEmail}`,
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
          effortLevel: "medium",
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

function buildLoginUrl(appBaseUrl: string): string {
  const redirectUri = `${appBaseUrl}/review`;
  return `${authBaseUrl}/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
