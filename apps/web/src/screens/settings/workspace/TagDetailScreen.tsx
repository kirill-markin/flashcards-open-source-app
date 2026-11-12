import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useAppData } from "../../../appData";
import { getErrorMessage } from "../../../appData/domain";
import { markIndexedDbOpenRecoveryFailureAndCheckActive, useAppErrorDialog } from "../../../appError/AppErrorContext";
import { buildDeckFilterDefinition } from "../../../deckFilters";
import { useI18n } from "../../../i18n";
import { loadCardsMatchingDeck } from "../../../localDb/cards/cards";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { libraryTagsRoute, reviewRoute } from "../../../routes";
import type { Card } from "../../../types";
import { useWorkspacePath } from "../../../useWorkspacePath";
import { CardMaintenanceAction } from "./CardMaintenanceAction";
import { DeckDetailStats, MatchingCardPreview, MatchingCardsSection } from "./decks/DeckDetailContent";

const tagCardsPageSize = 50;

export function TagDetailScreen(): ReactElement {
  const [searchParams] = useSearchParams();
  const workspacePath = useWorkspacePath();
  const { activeWorkspace } = useAppData();
  const tag = searchParams.get("tag");

  if (activeWorkspace === null) {
    throw new Error("Workspace is unavailable");
  }

  if (tag === null || tag.trim() === "") {
    return <Navigate to={workspacePath(libraryTagsRoute)} replace />;
  }

  const { workspaceId } = activeWorkspace;
  return <TagDetail key={JSON.stringify([workspaceId, tag])} tag={tag} workspaceId={workspaceId} />;
}

function TagDetail({ tag, workspaceId }: Readonly<{ tag: string; workspaceId: string }>): ReactElement {
  const { cloudSettings, localReadVersion, openReview, session } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const navigate = useNavigate();
  const workspacePath = useWorkspacePath();
  const [cards, setCards] = useState<ReadonlyArray<Card> | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [readAttempt, setReadAttempt] = useState(0);
  const userId = session?.userId ?? null;
  const installationId = cloudSettings?.installationId ?? null;
  const technicalErrorMessage = t("appError.technicalError.message");
  const tagsPath = workspacePath(libraryTagsRoute);

  useEffect(() => {
    let isCurrent = true;
    setErrorMessage("");

    async function loadTag(): Promise<void> {
      try {
        indexedDbOpenRecoveryState.throwIfFailed();
        const matchingCards = await loadCardsMatchingDeck(workspaceId, buildDeckFilterDefinition([tag]));
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isCurrent) setCards(matchingCards);
      } catch (error) {
        if (!isCurrent || markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) return;

        const wasCaptured = captureAppOperationError(error, {
          feature: "settings",
          operation: "tag_detail_load",
          userId,
          workspaceId,
          installationId,
          entityId: tag,
        });
        if (wasCaptured) showCapturedTechnicalError(error);
        setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
      }
    }

    void loadTag();
    return () => {
      isCurrent = false;
    };
  }, [indexedDbOpenRecoveryState, installationId, localReadVersion, readAttempt, showCapturedTechnicalError, tag, technicalErrorMessage, userId, workspaceId]);

  function handleOpenReview(): void {
    if (indexedDbOpenRecoveryState.hasFailed()) return;

    openReview({ kind: "tags", tags: [tag] });
    navigate(workspacePath(reviewRoute));
  }

  return (
    <main className="container">
      <section className="panel tag-detail-panel" data-testid="tag-detail">
        <div className="screen-head">
          <div>
            <h1 className="title"><bdi>{tag}</bdi></h1>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to={tagsPath}>{t("deckDetail.actions.back")}</Link>
            <button
              className="primary-btn"
              type="button"
              onClick={handleOpenReview}
              disabled={cards === null || cards.length === 0 || errorMessage !== ""}
              data-testid="tag-detail-open-review"
            >
              {t("deckDetail.actions.openReview")}
            </button>
          </div>
        </div>

        {errorMessage !== "" ? (
          <div className="cell-stack tag-detail-error">
            <p className="error-banner" role="alert">{errorMessage}</p>
            <button className="ghost-btn" type="button" onClick={() => setReadAttempt((attempt) => attempt + 1)}>
              {t("common.retry")}
            </button>
          </div>
        ) : cards === null ? (
          <p className="subtitle" role="status">{t("common.loading")}</p>
        ) : null}

        {cards === null ? null : (
          <div className="deck-detail-layout">
            <div className="deck-detail-panel">
              <DeckDetailStats cards={cards} />
              <div className="tag-detail-maintenance">
                <CardMaintenanceAction kind="resetTag" target={tag} disabled={false} />
                <CardMaintenanceAction
                  kind="removeTag"
                  target={tag}
                  disabled={false}
                  onComplete={() => navigate(tagsPath, { replace: true })}
                  didApplyAfterSync={async () => (
                    (await loadCardsMatchingDeck(workspaceId, buildDeckFilterDefinition([tag]))).length === 0
                  )}
                />
              </div>
            </div>
            <TagMatchingCards cards={cards} />
          </div>
        )}
      </section>
    </main>
  );
}

function TagMatchingCards({ cards }: Readonly<{ cards: ReadonlyArray<Card> }>): ReactElement {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(tagCardsPageSize);
  const observeLastCard = useCallback((row: HTMLElement | null): (() => void) | undefined => {
    if (row === null) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => Math.max(count, visibleCount + tagCardsPageSize));
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [visibleCount]);

  return (
    <MatchingCardsSection cardCount={cards.length} emptyMessage={t("reviewScreen.empty.noCardsTitle")}>
      {cards.slice(0, visibleCount).map((card, index) => (
        <MatchingCardPreview
          key={card.cardId}
          card={card}
          rowRef={visibleCount < cards.length && index === visibleCount - 1 ? observeLastCard : undefined}
        />
      ))}
    </MatchingCardsSection>
  );
}
