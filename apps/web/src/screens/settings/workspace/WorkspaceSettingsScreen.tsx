import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import {
  settingsDecksRoute,
  settingsExportRoute,
  settingsNotificationsRoute,
  settingsResetStudyProgressRoute,
  settingsOverviewRoute,
  settingsSchedulerRoute,
  settingsTagsRoute,
} from "../../../routes";
import { loadDecksListSnapshot } from "../../../localDb/cards/decks";
import { loadWorkspaceTagsSummary } from "../../../localDb/cards/workspace";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { SettingsGroup, SettingsNavigationCard, SettingsShell } from "../SettingsShared";

export function WorkspaceSettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    errorMessage: appErrorMessage,
    localReadVersion,
    refreshLocalData,
    session,
    workspaceSettings,
  } = useAppData();
  const { t, formatCount } = useI18n();
  const [activeCardCount, setActiveCardCount] = useState<number>(0);
  const [activeDeckCount, setActiveDeckCount] = useState<number>(0);
  const [tagsCount, setTagsCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });

  const workspaceUnavailableMessage = t("workspaceOverview.workspaceUnavailable");
  const cardCountLabel = formatCount(activeCardCount, {
    one: t("settingsWorkspace.countLabels.card.one"),
    other: t("settingsWorkspace.countLabels.card.other"),
  });
  const deckCountLabel = formatCount(activeDeckCount, {
    one: t("settingsWorkspace.countLabels.deck.one"),
    other: t("settingsWorkspace.countLabels.deck.other"),
  });
  const tagCountLabel = formatCount(tagsCount, {
    one: t("settingsWorkspace.countLabels.tag.one"),
    other: t("settingsWorkspace.countLabels.tag.other"),
  });
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error(workspaceUnavailableMessage);
        }

        const [tagsSummary, decksSnapshot] = await Promise.all([
          loadWorkspaceTagsSummary(activeWorkspace.workspaceId),
          loadDecksListSnapshot(activeWorkspace.workspaceId),
        ]);
        if (isCancelled) {
          return;
        }

        setActiveCardCount(tagsSummary.totalCards);
        setActiveDeckCount(decksSnapshot.deckSummaries.length);
        setTagsCount(tagsSummary.tags.length);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        if (activeWorkspace !== null) {
          const observationIdentity = observationIdentityRef.current;
          captureAppOperationError(error, {
            feature: "settings",
            operation: "workspace_settings_load",
            userId: observationIdentity.userId,
            workspaceId: activeWorkspace.workspaceId,
            installationId: observationIdentity.installationId,
            entityId: activeWorkspace.workspaceId,
          });
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, localReadVersion, workspaceUnavailableMessage]);

  if (errorMessage !== "") {
    return (
      <SettingsShell
        title={t("settingsWorkspace.title")}
        subtitle={t("settingsWorkspace.errorSubtitle")}
        activeTab="workspace"
      >
        <p className="error-banner">{errorMessage}</p>
        <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
          {t("common.retry")}
        </button>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title={t("settingsWorkspace.title")}
      subtitle={t("settingsWorkspace.subtitle")}
      activeTab="workspace"
    >
      {appErrorMessage !== "" ? <p className="error-banner">{appErrorMessage}</p> : null}

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("settingsWorkspace.overview.title")}
            description={t("settingsWorkspace.overview.description")}
            value={cardCountLabel}
            to={settingsOverviewRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settingsWorkspace.workspaceDataGroupTitle")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("settingsWorkspace.decks.title")}
            description={t("settingsWorkspace.decks.description")}
            value={deckCountLabel}
            to={settingsDecksRoute}
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.tags.title")}
            description={t("settingsWorkspace.tags.description")}
            value={tagCountLabel}
            to={settingsTagsRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settingsWorkspace.settingsGroupTitle")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("settingsWorkspace.scheduler.title")}
            description={t("settingsWorkspace.scheduler.description")}
            value={workspaceSettings === null ? t("common.unavailable") : workspaceSettings.algorithm.toUpperCase()}
            to={settingsSchedulerRoute}
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.notifications.title")}
            description={t("settingsWorkspace.notifications.description")}
            value={t("settingsWorkspace.notifications.value")}
            to={settingsNotificationsRoute}
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.export.title")}
            description={t("settingsWorkspace.export.description")}
            value={t("settingsWorkspace.export.value")}
            to={settingsExportRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settingsWorkspace.dangerZoneGroupTitle")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("settingsWorkspace.resetProgress.title")}
            description={t("settingsWorkspace.resetProgress.description")}
            value={t("settingsWorkspace.resetProgress.value")}
            to={settingsResetStudyProgressRoute}
            testId="workspace-reset-progress-open"
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
