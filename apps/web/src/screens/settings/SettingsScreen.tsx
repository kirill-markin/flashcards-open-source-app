import { useEffect, type ReactElement } from "react";
import { isAuthRedirectError } from "../../api";
import { useAppData } from "../../appData";
import {
  autoLocalePreference,
  type Locale,
  type LocalePreference,
  type TranslationKey,
  useI18n,
} from "../../i18n";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountLegalRoute,
  accountOpenSourceRoute,
  accountStatusRoute,
  accountSupportRoute,
  settingsAccessRoute,
  settingsCurrentWorkspaceRoute,
  settingsDecksRoute,
  settingsDeleteCurrentWorkspaceRoute,
  settingsDeviceRoute,
  settingsExportRoute,
  settingsFeedbackRoute,
  settingsLanguageRoute,
  settingsNotificationsRoute,
  settingsReviewAnimationsRoute,
  settingsResetStudyProgressRoute,
  settingsSchedulerRoute,
  settingsServerRoute,
  settingsTagsRoute,
  settingsTestRoute,
} from "../../routes";
import { useTestMode } from "../../testMode";
import {
  SettingsGroup,
  SettingsNavigationCard,
  SettingsShell,
} from "./SettingsShared";

type LocaleNameTranslationKey = `locale.names.${Locale}`;

function accountStatusValue(linkedEmail: string | null, unavailableLabel: string): string {
  if (linkedEmail === null || linkedEmail === "") {
    return unavailableLabel;
  }

  return linkedEmail;
}

function localeNameKey(locale: Locale): LocaleNameTranslationKey {
  return `locale.names.${locale}`;
}

function formatLocalePreferenceLabel(
  localePreference: LocalePreference,
  t: (key: TranslationKey) => string,
): string {
  if (localePreference === autoLocalePreference) {
    return t("locale.preferenceAuto");
  }

  return t(localeNameKey(localePreference));
}

export function SettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    isSessionVerified,
    refreshAccountPreferences,
    session,
    setErrorMessage,
    workspaceSettings,
  } = useAppData();
  const { localePreference, t } = useI18n();
  const { isTestModeEnabled } = useTestMode();
  const currentWorkspaceName = activeWorkspace?.name ?? t("common.unavailable");
  const accountStatus = accountStatusValue(cloudSettings?.linkedEmail ?? session?.profile.email ?? null, t("common.unavailable"));
  const languagePreferenceLabel = formatLocalePreferenceLabel(localePreference, t);
  const schedulerValue = workspaceSettings === null ? t("common.unavailable") : workspaceSettings.algorithm.toUpperCase();

  useEffect(() => {
    if (session === null || isSessionVerified === false) {
      return;
    }

    void refreshAccountPreferences().catch((error: unknown) => {
      if (isAuthRedirectError(error)) {
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, [isSessionVerified, refreshAccountPreferences, session?.userId, setErrorMessage]);

  return (
    <SettingsShell
      title={t("settingsHome.title")}
      subtitle={t("settingsHome.subtitle")}
      activeTab="general"
    >
      <SettingsGroup title={t("settingsHome.groups.account")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("accountSettings.accountStatus.title")}
            description={t("accountSettings.accountStatus.description")}
            value={accountStatus}
            to={accountStatusRoute}
            testId="settings-row-account-status"
          />
          <SettingsNavigationCard
            title={t("settingsCurrentWorkspace.title")}
            description={t("settingsCurrentWorkspace.subtitle")}
            value={currentWorkspaceName}
            to={settingsCurrentWorkspaceRoute}
            testId="settings-row-current-workspace"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settingsHome.groups.general")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("notificationsSettings.title")}
            description={t("notificationsSettings.subtitle")}
            value={t("settingsWorkspace.notifications.value")}
            to={settingsNotificationsRoute}
            testId="settings-row-review-reminders"
          />
          <SettingsNavigationCard
            title={t("reviewAnimationsSettings.title")}
            description={t("reviewAnimationsSettings.subtitle")}
            value={session?.preferences.reviewReactionAnimationsEnabled === false ? t("common.off") : t("common.on")}
            to={settingsReviewAnimationsRoute}
            testId="settings-row-review-animations"
          />
          <SettingsNavigationCard
            title={t("settingsHome.language.title")}
            description={t("settingsHome.language.description")}
            value={languagePreferenceLabel}
            to={settingsLanguageRoute}
            testId="settings-row-language"
          />
          <SettingsNavigationCard
            title={t("accessSettings.title")}
            description={t("accessSettings.subtitle")}
            value={t("settingsHome.access.value")}
            to={settingsAccessRoute}
            testId="settings-row-access"
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.decks.title")}
            description={t("settingsWorkspace.decks.description")}
            value={t("common.open")}
            to={settingsDecksRoute}
            testId="settings-row-decks"
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.tags.title")}
            description={t("settingsWorkspace.tags.description")}
            value={t("common.open")}
            to={settingsTagsRoute}
            testId="settings-row-tags"
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.export.title")}
            description={t("settingsWorkspace.export.description")}
            value={t("settingsWorkspace.export.value")}
            to={settingsExportRoute}
            testId="settings-row-export"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settingsHome.groups.support")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("settingsHome.feedback.title")}
            description={t("settingsHome.feedback.description")}
            value={t("settingsHome.feedback.value")}
            to={settingsFeedbackRoute}
            testId="settings-row-feedback"
          />
          <SettingsNavigationCard
            title={t("support.title")}
            description={t("support.subtitle")}
            value={null}
            to={accountSupportRoute}
            testId="settings-row-support"
          />
          <SettingsNavigationCard
            title={t("legal.title")}
            description={t("legal.subtitle")}
            value={null}
            to={accountLegalRoute}
            testId="settings-row-legal"
          />
          <SettingsNavigationCard
            title={t("openSourceSettings.title")}
            description={t("openSourceSettings.subtitle")}
            value={t("accountSettings.openSource.value")}
            to={accountOpenSourceRoute}
            testId="settings-row-open-source"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settingsHome.groups.advanced")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("workspaceScheduler.title")}
            description={t("workspaceScheduler.subtitle")}
            value={schedulerValue}
            to={settingsSchedulerRoute}
            testId="settings-row-scheduling"
          />
          <SettingsNavigationCard
            title={t("agentConnections.title")}
            description={t("agentConnections.subtitle")}
            value={t("accountSettings.agentConnections.value")}
            to={accountAgentConnectionsRoute}
            testId="settings-row-agent-connections"
          />
          <SettingsNavigationCard
            title={t("settingsHome.server.title")}
            description={t("settingsHome.server.description")}
            value={t("settingsHome.server.value")}
            to={settingsServerRoute}
            testId="settings-row-server"
          />
          <SettingsNavigationCard
            title={t("settingsDevice.title")}
            description={t("settingsDevice.subtitle")}
            value={null}
            to={settingsDeviceRoute}
            testId="settings-row-device-diagnostics"
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.resetProgress.title")}
            description={t("settingsWorkspace.resetProgress.description")}
            value={t("settingsWorkspace.resetProgress.value")}
            to={settingsResetStudyProgressRoute}
            testId="settings-row-reset-study-progress"
          />
          <SettingsNavigationCard
            title={t("settingsHome.deleteCurrentWorkspace.title")}
            description={t("settingsHome.deleteCurrentWorkspace.description")}
            value={t("settingsHome.deleteCurrentWorkspace.value")}
            to={settingsDeleteCurrentWorkspaceRoute}
            testId="settings-row-delete-current-workspace"
          />
          <SettingsNavigationCard
            title={t("dangerZone.deleteTitle")}
            description={t("dangerZone.deleteDescription")}
            value={t("accountSettings.dangerZone.value")}
            to={accountDangerZoneRoute}
            testId="settings-row-delete-account"
          />
          {isTestModeEnabled ? (
            <SettingsNavigationCard
              title={t("settingsTest.title")}
              description={t("settingsTest.subtitle")}
              value={t("settingsHome.test.value")}
              to={settingsTestRoute}
              testId="settings-row-test"
            />
          ) : null}
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
