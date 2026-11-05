import { expect } from "@playwright/test";

import {
  trackedClick,
  trackedExpectVisible,
  trackedWaitForUrl,
} from "../../live-smoke.actions";
import {
  accountStatusRoute,
  accountLegalRoute,
  accountSupportRoute,
  libraryDecksRoute,
  libraryExportRoute,
  libraryImportRoute,
  libraryTagsRoute,
  settingsAccessRoute,
  settingsCurrentWorkspaceRoute,
  settingsDeviceRoute,
  settingsLanguageRoute,
  settingsNotificationsRoute,
  settingsSchedulerRoute,
  settingsServerRoute,
  workspaceRoutePrefix,
} from "../../../src/routes";
import { localUiTimeoutMs } from "../config";
import { openLibraryRow, primaryNavigationLinkSelector } from "../navigation";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

type SettingsDetailTarget = Readonly<{
  rowTestId: string;
  route: string;
  actionName: string;
}>;

type LibraryDetailTarget = Readonly<{
  rowTestId: string;
  route: string;
  screenSelector: string;
}>;

const settingsDetailTargets: ReadonlyArray<SettingsDetailTarget> = [
  {
    rowTestId: "settings-row-account-status",
    route: accountStatusRoute,
    actionName: "open Account status settings",
  },
  {
    rowTestId: "settings-row-current-workspace",
    route: settingsCurrentWorkspaceRoute,
    actionName: "open Workspace settings",
  },
  {
    rowTestId: "settings-row-language",
    route: settingsLanguageRoute,
    actionName: "open Language settings",
  },
  {
    rowTestId: "settings-row-review-reminders",
    route: settingsNotificationsRoute,
    actionName: "open Notifications settings",
  },
  {
    rowTestId: "settings-row-access",
    route: settingsAccessRoute,
    actionName: "open Access settings",
  },
  {
    rowTestId: "settings-row-scheduling",
    route: settingsSchedulerRoute,
    actionName: "open Scheduling / FSRS settings",
  },
  {
    rowTestId: "settings-row-server",
    route: settingsServerRoute,
    actionName: "open Server settings",
  },
  {
    rowTestId: "settings-row-device-diagnostics",
    route: settingsDeviceRoute,
    actionName: "open Device settings",
  },
  {
    rowTestId: "settings-row-support",
    route: accountSupportRoute,
    actionName: "open Support settings",
  },
  {
    rowTestId: "settings-row-legal",
    route: accountLegalRoute,
    actionName: "open Legal settings",
  },
];

const rootRowTestIds: ReadonlyArray<string> = [
  "settings-row-review-app-store",
  "settings-row-private-feedback",
  "settings-row-account-status",
  "settings-row-current-workspace",
  "settings-row-review-reminders",
  "settings-row-language",
  "settings-row-access",
  "settings-row-feedback",
  "settings-row-support",
  "settings-row-legal",
  "settings-row-open-source",
  "settings-row-scheduling",
  "settings-row-agent-connections",
  "settings-row-server",
  "settings-row-device-diagnostics",
  "settings-row-reset-study-progress",
  "settings-row-delete-current-workspace",
  "settings-row-delete-account",
];

const libraryDetailTargets: ReadonlyArray<LibraryDetailTarget> = [
  { rowTestId: "library-row-tags", route: libraryTagsRoute, screenSelector: ".tags-screen-panel" },
  { rowTestId: "library-row-decks", route: libraryDecksRoute, screenSelector: "[data-testid='decks-screen']" },
  { rowTestId: "library-row-import", route: libraryImportRoute, screenSelector: ".settings-panel" },
  { rowTestId: "library-row-export", route: libraryExportRoute, screenSelector: ".settings-panel" },
];

export async function runSettingsIaFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "verify Settings first-level IA and detail navigation", async () => {
    await assertSettingsRootTree(session);

    for (const target of settingsDetailTargets) {
      await openSettingsDetailFromRoot(session, target);
    }
  });

  await runLiveSmokeStep(session, "verify the Library hub opens Tags, Decks, Import and Export", async () => {
    for (const target of libraryDetailTargets) {
      await openLibraryDetail(session, target);
    }
  });
}

async function openLibraryDetail(session: LiveSmokeSession, target: LibraryDetailTarget): Promise<void> {
  const { page, diagnostics, baseUrl } = session;
  const actionName = `open ${target.rowTestId} from Library`;
  await openLibraryRow(page, diagnostics, actionName, target.rowTestId);
  await trackedWaitForUrl(
    page,
    diagnostics,
    `confirm route after ${actionName}`,
    buildRouteUrlPattern(baseUrl, target.route),
    localUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    `confirm screen is visible after ${actionName}`,
    page.locator(target.screenSelector),
    localUiTimeoutMs,
  );
}

async function assertSettingsRootTree(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;
  await openSettingsRoot(session, "open Settings for IA verification");

  for (const groupLabel of ["Feedback", "Account", "Style", "General", "Support", "Advanced"]) {
    await trackedExpectVisible(
      diagnostics,
      `confirm Settings group ${groupLabel} is visible`,
      page.getByRole("heading", { name: groupLabel, exact: true }),
      localUiTimeoutMs,
    );
  }

  for (const rowTestId of rootRowTestIds) {
    await trackedExpectVisible(
      diagnostics,
      `confirm Settings row ${rowTestId} is visible`,
      page.getByTestId(rowTestId),
      localUiTimeoutMs,
    );
  }

  await diagnostics.runAction("confirm Settings Test row is hidden when test mode is off", async () => {
    await expect(page.getByTestId("settings-row-test")).toHaveCount(0);
  });

  await diagnostics.runAction("confirm Library rows are not in Settings", async () => {
    for (const rowTestId of ["settings-row-decks", "settings-row-tags", "settings-row-import", "settings-row-export"]) {
      await expect(page.getByTestId(rowTestId)).toHaveCount(0);
    }
  });
}

async function openSettingsDetailFromRoot(
  session: LiveSmokeSession,
  target: SettingsDetailTarget,
): Promise<void> {
  const { page, diagnostics, baseUrl } = session;
  await openSettingsRoot(session, `return to Settings before ${target.actionName}`);
  await trackedClick(diagnostics, target.actionName, page.getByTestId(target.rowTestId));
  await trackedWaitForUrl(
    page,
    diagnostics,
    `confirm route after ${target.actionName}`,
    buildRouteUrlPattern(baseUrl, target.route),
    localUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    `confirm settings panel is visible after ${target.actionName}`,
    page.locator(".settings-panel"),
    localUiTimeoutMs,
  );
}

async function openSettingsRoot(session: LiveSmokeSession, actionName: string): Promise<void> {
  const { page, diagnostics, baseUrl } = session;
  await trackedClick(diagnostics, actionName, page.locator(primaryNavigationLinkSelector("/settings")).first());
  await trackedWaitForUrl(
    page,
    diagnostics,
    `${actionName} route`,
    buildRouteUrlPattern(baseUrl, "/settings"),
    localUiTimeoutMs,
  );
}

/**
 * The workspace segment is optional because the flat address reaches the same route through the
 * permanent redirect in `App.tsx`, which external bookmarks still arrive on.
 */
function buildRouteUrlPattern(baseUrl: string, route: string): RegExp {
  const workspaceSegment = `(?:${escapeRegExp(`${workspaceRoutePrefix}/`)}[^/]+)?`;
  return new RegExp(`^${escapeRegExp(baseUrl)}${workspaceSegment}${escapeRegExp(route)}(?:[?#].*)?$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
