import { useEffect, useState, type ReactElement } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useAppData } from "../../../appData";
import { getErrorMessage, isCardDue } from "../../../appData/domain";
import { markIndexedDbOpenRecoveryFailureAndCheckActive, useAppErrorDialog } from "../../../appError/AppErrorContext";
import { buildDeckFilterDefinition } from "../../../deckFilters";
import { useI18n } from "../../../i18n";
import { loadCardsMatchingDeck } from "../../../localDb/cards/cards";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { libraryTagsRoute, reviewRoute } from "../../../routes";
import type { Card } from "../../../types";
import { useWorkspacePath } from "../../../useWorkspacePath";
import { CardMaintenanceAction } from "./CardMaintenanceAction";

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
  const { t, formatNumber } = useI18n();
  const navigate = useNavigate();
  const workspacePath = useWorkspacePath();
  const [cards, setCards] = useState<ReadonlyArray<Card> | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [readAttempt, setReadAttempt] = useState(0);
  const userId = session?.userId ?? null;
  const installationId = cloudSettings?.installationId ?? null;
  const technicalErrorMessage = t("appError.technicalError.message");
  const tagsPath = workspacePath(libraryTagsRoute);
  const nowTimestamp = Date.now();

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
    <main className="container tags-page">
      <section className="panel tags-screen-panel" data-testid="tag-detail">
        <div className="screen-head">
          <h1 className="title" dir="auto">{tag}</h1>
          <div className="screen-actions">
            <Link className="ghost-btn" to={tagsPath}>{t("deckDetail.actions.back")}</Link>
          </div>
        </div>

        {errorMessage !== "" ? (
          <>
            <p className="error-banner" role="alert">{errorMessage}</p>
            <button className="ghost-btn" type="button" onClick={() => setReadAttempt((attempt) => attempt + 1)}>
              {t("common.retry")}
            </button>
          </>
        ) : cards === null ? (
          <p className="subtitle" role="status">{t("loading.tags")}</p>
        ) : null}

        {cards === null ? null : (
          <>
            <div className="deck-detail-stats">
              <div className="content-card deck-detail-stat-card">
                <span className="deck-detail-stat-label">{t("tagsScreen.totalCards.label")}</span>
                <span className="deck-detail-stat-value">{formatNumber(cards.length)}</span>
              </div>
              <div className="content-card deck-detail-stat-card">
                <span className="deck-detail-stat-label">{t("deckDetail.rules.new")}</span>
                <span className="deck-detail-stat-value">
                  {formatNumber(cards.filter((card) => card.reps === 0 && card.lapses === 0).length)}
                </span>
              </div>
              <div className="content-card deck-detail-stat-card">
                <span className="deck-detail-stat-label">{t("deckDetail.rules.toStudy")}</span>
                <span className="deck-detail-stat-value">
                  {formatNumber(cards.filter((card) => isCardDue(card, nowTimestamp)).length)}
                </span>
              </div>
            </div>
            <div className="screen-actions">
              <button
                className="primary-btn"
                type="button"
                onClick={handleOpenReview}
                disabled={cards.length === 0 || errorMessage !== ""}
                data-testid="tag-detail-open-review"
              >
                {t("deckDetail.actions.openReview")}
              </button>
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
          </>
        )}
      </section>
    </main>
  );
}
