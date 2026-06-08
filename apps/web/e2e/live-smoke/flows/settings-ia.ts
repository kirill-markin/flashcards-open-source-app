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
  settingsAccessRoute,
  settingsCurrentWorkspaceRoute,
  settingsDeviceRoute,
  settingsLanguageRoute,
  settingsNotificationsRoute,
  settingsSchedulerRoute,
  settingsServerRoute,
} from "../../../src/routes";
import { localUiTimeoutMs } from "../config";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

type SettingsDetailTarget = Readonly<{
  rowTestId: string;
  route: string;
  actionName: string;
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
    actionName: "open Review reminders settings",
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
  "settings-row-account-status",
  "settings-row-current-workspace",
  "settings-row-review-reminders",
  "settings-row-language",
  "settings-row-access",
  "settings-row-decks",
  "settings-row-tags",
  "settings-row-export",
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

export async function runSettingsIaFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "verify Settings first-level IA and detail navigation", async () => {
    await assertSettingsRootTree(session);

    for (const target of settingsDetailTargets) {
      await openSettingsDetailFromRoot(session, target);
    }
  });
}

async function assertSettingsRootTree(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;
  await openSettingsRoot(session, "open Settings for IA verification");

  for (const groupLabel of ["Account", "General", "Support", "Advanced"]) {
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
  await trackedClick(diagnostics, actionName, page.locator('nav.nav a[href="/settings"]').first());
  await trackedWaitForUrl(
    page,
    diagnostics,
    `${actionName} route`,
    buildRouteUrlPattern(baseUrl, "/settings"),
    localUiTimeoutMs,
  );
}

function buildRouteUrlPattern(baseUrl: string, route: string): RegExp {
  return new RegExp(`^${escapeRegExp(`${baseUrl}${route}`)}(?:[?#].*)?$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
