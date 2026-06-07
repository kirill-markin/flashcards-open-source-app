import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import { loadWorkspaceOverviewSnapshot } from "../../../localDb/cards/workspace";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { WorkspaceOverviewSnapshot } from "../../../types";
import { SettingsShell } from "../SettingsShared";

const emptyOverviewSnapshot: WorkspaceOverviewSnapshot = {
  workspaceName: "",
  deckCount: 0,
  tagsCount: 0,
  totalCards: 0,
  dueCount: 0,
  newCount: 0,
  reviewedCount: 0,
};

export function WorkspaceOverviewScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    localReadVersion,
    refreshLocalData,
    session,
  } = useAppData();
  const { t, formatCount, formatNumber } = useI18n();
  const workspaceUnavailableMessage = t("workspaceOverview.workspaceUnavailable");
  const [overviewSnapshot, setOverviewSnapshot] = useState<WorkspaceOverviewSnapshot>(emptyOverviewSnapshot);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      if (activeWorkspace === null) {
        setOverviewSnapshot({
          ...emptyOverviewSnapshot,
          workspaceName: workspaceUnavailableMessage,
        });
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage("");

      try {
        const nextOverviewSnapshot = await loadWorkspaceOverviewSnapshot(activeWorkspace);
        if (isCancelled) {
          return;
        }

        setOverviewSnapshot(nextOverviewSnapshot);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        if (activeWorkspace !== null) {
          const observationIdentity = observationIdentityRef.current;
          captureAppOperationError(error, {
            feature: "settings",
            operation: "workspace_overview_load",
            userId: observationIdentity.userId,
            workspaceId: activeWorkspace.workspaceId,
            installationId: observationIdentity.installationId,
            entityId: activeWorkspace.workspaceId,
          });
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, localReadVersion, workspaceUnavailableMessage]);

  if (isLoading) {
    return (
      <SettingsShell
        title={t("workspaceOverview.title")}
        subtitle={t("workspaceOverview.subtitle")}
        activeTab="workspace"
      >
        <p className="subtitle">{t("workspaceOverview.loading")}</p>
      </SettingsShell>
    );
  }

  if (errorMessage !== "") {
    return (
      <SettingsShell
        title={t("workspaceOverview.title")}
        subtitle={t("workspaceOverview.subtitle")}
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
      title={t("workspaceOverview.title")}
      subtitle={t("workspaceOverview.subtitle")}
      activeTab="workspace"
    >
      <section className="settings-group">
        <div className="settings-summary-grid">
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceOverview.labels.workspace")}</span>
            <strong className="panel-subtitle">{overviewSnapshot.workspaceName}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceOverview.labels.cards")}</span>
            <strong className="panel-subtitle">{formatNumber(overviewSnapshot.totalCards)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceOverview.labels.decks")}</span>
            <strong className="panel-subtitle">{formatNumber(overviewSnapshot.deckCount)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceOverview.labels.tags")}</span>
            <strong className="panel-subtitle">{formatNumber(overviewSnapshot.tagsCount)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceOverview.labels.due")}</span>
            <strong className="panel-subtitle">{formatNumber(overviewSnapshot.dueCount)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceOverview.labels.new")}</span>
            <strong className="panel-subtitle">{formatNumber(overviewSnapshot.newCount)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceOverview.labels.reviewed")}</span>
            <strong className="panel-subtitle">{formatNumber(overviewSnapshot.reviewedCount)}</strong>
          </article>
        </div>
      </section>
    </SettingsShell>
  );
}
