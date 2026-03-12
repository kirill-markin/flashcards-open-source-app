import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { makeWorkspaceTagsSummary } from "../appData/domain";
import { useAppData } from "../appData";
import { settingsDecksRoute, settingsTagsRoute } from "../routes";

type SettingsNavigationCardProps = Readonly<{
  title: string;
  description: string;
  value: string;
  to: string;
}>;

function SettingsNavigationCard(props: SettingsNavigationCardProps): ReactElement {
  const { title, description, value, to } = props;

  return (
    <Link className="settings-nav-card content-card" to={to}>
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{title}</strong>
        <p className="subtitle">{description}</p>
      </div>
      <span className="badge">{value}</span>
    </Link>
  );
}

export function SettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cards,
    cardsState,
    decks,
    decksState,
    ensureCardsLoaded,
    ensureDecksLoaded,
    refreshCards,
    refreshDecks,
    workspaceSettings,
  } = useAppData();

  useEffect(() => {
    void ensureCardsLoaded();
    void ensureDecksLoaded();
  }, [ensureCardsLoaded, ensureDecksLoaded]);

  const activeCardCount = cards.filter((card) => card.deletedAt === null).length;
  const activeDeckCount = decks.filter((deck) => deck.deletedAt === null).length;
  const tagsCount = makeWorkspaceTagsSummary(cards).tags.length;
  const resourceErrorMessage = decksState.status === "error"
    ? decksState.errorMessage
    : cardsState.status === "error"
      ? cardsState.errorMessage
      : "";

  if (
    (decksState.status === "loading" && !decksState.hasLoaded)
    || (cardsState.status === "loading" && !cardsState.hasLoaded)
  ) {
    return (
      <main className="container settings-page">
        <section className="panel settings-panel">
          <h1 className="panel-subtitle">Settings</h1>
          <p className="subtitle">Loading workspace settings…</p>
        </section>
      </main>
    );
  }

  if (
    (decksState.status === "error" && !decksState.hasLoaded)
    || (cardsState.status === "error" && !cardsState.hasLoaded)
  ) {
    return (
      <main className="container settings-page">
        <section className="panel settings-panel">
          <h1 className="panel-subtitle">Settings</h1>
          <p className="error-banner">{resourceErrorMessage}</p>
          <button
            className="primary-btn"
            type="button"
            onClick={() => {
              void refreshCards();
              void refreshDecks();
            }}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container settings-page">
      <section className="panel settings-panel">
        <div className="screen-head">
          <div>
            <h1 className="panel-subtitle">Settings</h1>
            <p className="subtitle">Workspace navigation matches iOS: decks and tags live here instead of the primary nav.</p>
          </div>
        </div>

        {resourceErrorMessage !== "" ? <p className="error-banner">{resourceErrorMessage}</p> : null}

        <div className="settings-summary-grid">
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Workspace</span>
            <strong className="panel-subtitle">{activeWorkspace?.name ?? "Workspace unavailable"}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Cards</span>
            <strong className="panel-subtitle">{activeCardCount}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Decks</span>
            <strong className="panel-subtitle">{activeDeckCount}</strong>
          </article>
        </div>

        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="Decks"
            description="Create, edit, and review reusable study scopes."
            value={`${activeDeckCount} total`}
            to={settingsDecksRoute}
          />
          <SettingsNavigationCard
            title="Tags"
            description="Inspect workspace-wide tag usage and card counts."
            value={`${tagsCount} total`}
            to={settingsTagsRoute}
          />
        </div>

        <article className="content-card content-card-muted settings-summary-card">
          <span className="cell-secondary">Scheduler</span>
          <strong className="panel-subtitle">
            {workspaceSettings === null ? "Unavailable" : `${workspaceSettings.algorithm.toUpperCase()} • Retention ${workspaceSettings.desiredRetention}`}
          </strong>
          <p className="subtitle">Workspace scheduler settings stay here on both web and iOS, while account settings live in the account entry point.</p>
        </article>
      </section>
    </main>
  );
}
