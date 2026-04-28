import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import { loadWorkspaceTagsSummary } from "../../../localDb/workspace";
import type { WorkspaceTagsSummary } from "../../../types";

const emptyTagsSummary: WorkspaceTagsSummary = {
  tags: [],
  totalCards: 0,
};

export function TagsScreen(): ReactElement {
  const { activeWorkspace, localReadVersion, refreshLocalData } = useAppData();
  const { t, formatCount, formatNumber } = useI18n();
  const [tagsSummary, setTagsSummary] = useState<WorkspaceTagsSummary>(emptyTagsSummary);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setIsLoading(true);
      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error("Workspace is unavailable");
        }

        const nextTagsSummary = await loadWorkspaceTagsSummary(activeWorkspace.workspaceId);
        if (isCancelled) {
          return;
        }

        setTagsSummary(nextTagsSummary);
      } catch (error) {
        if (isCancelled) {
          return;
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
  }, [activeWorkspace, localReadVersion]);

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
          <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
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
            <article key={tagSummary.tag} className="content-card tags-summary-card">
              <div className="tags-summary-card-head">
                <strong className="panel-subtitle">{tagSummary.tag}</strong>
                <span className="badge">{formatCount(tagSummary.cardsCount, {
                  one: t("common.countLabels.card.one"),
                  other: t("common.countLabels.card.other"),
                })}</span>
              </div>
            </article>
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
