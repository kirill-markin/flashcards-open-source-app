import { useEffect, type ReactElement } from "react";
import { makeWorkspaceTagsSummary } from "../appData/domain";
import { useAppData } from "../appData";

function formatCardsCount(cardsCount: number): string {
  return `${cardsCount} ${cardsCount === 1 ? "card" : "cards"}`;
}

export function TagsScreen(): ReactElement {
  const {
    cards,
    cardsState,
    ensureCardsLoaded,
    refreshCards,
  } = useAppData();

  useEffect(() => {
    void ensureCardsLoaded();
  }, [ensureCardsLoaded]);

  const tagsSummary = makeWorkspaceTagsSummary(cards);
  const resourceErrorMessage = cardsState.status === "error" ? cardsState.errorMessage : "";

  if (cardsState.status === "loading" && cardsState.hasLoaded === false) {
    return (
      <main className="container">
        <section className="panel tags-screen-panel">
          <h1 className="title">Tags</h1>
          <p className="subtitle">Loading tags…</p>
        </section>
      </main>
    );
  }

  if (cardsState.status === "error" && cardsState.hasLoaded === false) {
    return (
      <main className="container">
        <section className="panel tags-screen-panel">
          <h1 className="title">Tags</h1>
          <p className="error-banner">{resourceErrorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshCards()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container tags-page">
      <section className="panel tags-screen-panel">
        {resourceErrorMessage !== "" ? <p className="error-banner">{resourceErrorMessage}</p> : null}
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
