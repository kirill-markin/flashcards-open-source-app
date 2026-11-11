import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { useAppData } from "../../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { loadWorkspaceTagsSummary } from "../../../localDb/cards/workspace";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { buildLibraryTagDetailRoute } from "../../../routes";
import { useWorkspacePath } from "../../../useWorkspacePath";
import { handleRefreshLocalDataError } from "../../shared/refreshLocalDataError";
import type { WorkspaceTagsSummary } from "../../../types";

const emptyTagsSummary: WorkspaceTagsSummary = {
  tags: [],
  totalCards: 0,
};

export function TagsScreen(): ReactElement {
  const { activeWorkspace, cloudSettings, localReadVersion, refreshLocalData, session } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { messages, t, formatCount, formatNumber } = useI18n();
  const workspacePath = useWorkspacePath();
  const [tagsSummary, setTagsSummary] = useState<WorkspaceTagsSummary>(emptyTagsSummary);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  const technicalErrorMessage = t("appError.technicalError.message");
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setIsLoading(true);
      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error("Workspace is unavailable");
        }

        const nextTagsSummary = await loadWorkspaceTagsSummary(activeWorkspace.workspaceId);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isCancelled) {
          return;
        }

        setTagsSummary(nextTagsSummary);
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCancelled) {
          return;
        }

        if (activeWorkspace !== null) {
          const observationIdentity = observationIdentityRef.current;
          const wasCaptured = captureAppOperationError(error, {
            feature: "settings",
            operation: "tags_load",
            userId: observationIdentity.userId,
            workspaceId: activeWorkspace.workspaceId,
            installationId: observationIdentity.installationId,
            entityId: null,
          });
          if (wasCaptured) {
            showCapturedTechnicalError(error);
            setErrorMessage(technicalErrorMessage);
            return;
          }
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled && indexedDbOpenRecoveryState.hasFailed() === false) {
          setIsLoading(false);
        }
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, indexedDbOpenRecoveryState, localReadVersion]);

  async function handleRefreshLocalData(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    try {
      await refreshLocalData();
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      handleRefreshLocalDataError({
        error,
        context: {
          feature: "sync",
          operation: "refresh_local_metadata",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: activeWorkspace?.workspaceId ?? null,
        },
        setErrorMessage,
        showCapturedTechnicalError,
        technicalErrorMessage,
      });
    }
  }

  if (isLoading) {
    return (
      <main className="container">
        <section className="panel tags-screen-panel">
          <h1 className="title">{t("tagsScreen.title")}</h1>
          <p className="subtitle">{t("loading.tags")}</p>
        </section>
      </main>
    );
  }

  if (errorMessage !== "") {
    return (
      <main className="container">
        <section className="panel tags-screen-panel">
          <h1 className="title">{t("tagsScreen.title")}</h1>
          <p className="error-banner">{errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void handleRefreshLocalData()}>
            {t("common.retry")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container tags-page">
      <section className="panel tags-screen-panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{t("tagsScreen.title")}</h1>
            <p className="subtitle">{t("tagsScreen.subtitle")}</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{t("tagsScreen.counts.total", { count: formatNumber(tagsSummary.tags.length) })}</span>
          </div>
        </div>

        <div className="tags-summary-list">
          {tagsSummary.tags.length === 0 ? (
            <div className="content-card">{t("tagsScreen.empty")}</div>
          ) : tagsSummary.tags.map((tagSummary) => (
            <Link
              key={tagSummary.tag}
              className="content-card tags-summary-card tags-summary-card-button"
              to={workspacePath(buildLibraryTagDetailRoute(tagSummary.tag))}
            >
              <div className="tags-summary-card-head">
                <strong className="panel-subtitle">{tagSummary.tag}</strong>
                <span className="badge">{formatCount(tagSummary.cardsCount, messages.common.countLabels.card)}</span>
              </div>
            </Link>
          ))}
        </div>

        <article className="content-card content-card-muted tags-total-card">
          <div className="tags-total-card-head">
            <span className="cell-secondary">{t("tagsScreen.totalCards.label")}</span>
            <strong className="panel-subtitle">{formatNumber(tagsSummary.totalCards)}</strong>
          </div>
          <p className="subtitle">{t("tagsScreen.totalCards.description")}</p>
        </article>
      </section>
    </main>
  );
}
