import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import { loadWorkspaceTagsSummary } from "../syncStorage";
import type { WorkspaceTagsSummary } from "../types";

function formatCardsCount(cardsCount: number): string {
  return `${cardsCount} ${cardsCount === 1 ? "card" : "cards"}`;
}

const emptyTagsSummary: WorkspaceTagsSummary = {
  tags: [],
  totalCards: 0,
};

export function TagsScreen(): ReactElement {
  const { localReadVersion, refreshLocalData } = useAppData();
  const [tagsSummary, setTagsSummary] = useState<WorkspaceTagsSummary>(emptyTagsSummary);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const nextTagsSummary = await loadWorkspaceTagsSummary();
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
  }, [localReadVersion]);

  if (isLoading) {
    return (
      <main className="container">
        <section className="panel tags-screen-panel">
          <h1 className="title">Tags</h1>
          <p className="subtitle">Loading tags…</p>
        </section>
      </main>
    );
  }

  if (errorMessage !== "") {
    return (
      <main className="container">
        <section className="panel tags-screen-panel">
          <h1 className="title">Tags</h1>
          <p className="error-banner">{errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
            Retry
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
            <h1 className="title">Tags</h1>
            <p className="subtitle">
              Tags group cards across the workspace. Per-tag counts can overlap when one card has multiple tags.
            </p>
          </div>
          <div className="screen-actions">
            <span className="badge">{tagsSummary.tags.length} total</span>
          </div>
        </div>

        <div className="tags-summary-list">
          {tagsSummary.tags.length === 0 ? (
            <div className="content-card">No tags have been used yet.</div>
          ) : tagsSummary.tags.map((tagSummary) => (
            <article key={tagSummary.tag} className="content-card tags-summary-card">
              <div className="tags-summary-card-head">
                <strong className="panel-subtitle">{tagSummary.tag}</strong>
                <span className="badge">{formatCardsCount(tagSummary.cardsCount)}</span>
              </div>
            </article>
          ))}
        </div>

        <article className="content-card content-card-muted tags-total-card">
          <div className="tags-total-card-head">
            <span className="cell-secondary">Total cards</span>
            <strong className="panel-subtitle">{tagsSummary.totalCards}</strong>
          </div>
          <p className="subtitle">This is the workspace-wide card count, so it does not double-count cards that share tags.</p>
        </article>
      </section>
    </main>
  );
}
