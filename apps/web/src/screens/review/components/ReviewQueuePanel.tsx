import type { ReactElement } from "react";
import { isCardDue } from "../../../appData/domain";
import { parseDueAtMillis } from "../../../appData/domain/dueAt";
import { useI18n } from "../../../i18n";
import type { Card } from "../../../types";
import type { ReviewLoadingSnapshot } from "../../shared/loadingSnapshots";
import { formatEffortLevelLabel, formatNullableDateTime, formatTagSummary } from "../../shared/featureFormatting";

export type ReviewQueuePanelProps = Readonly<{
  isInitialReviewLoad: boolean;
  loadingReviewCurrentCard: ReviewLoadingSnapshot["currentCard"];
  nowTimestamp: number;
  queueCards: ReadonlyArray<Card>;
  reviewLoadingSnapshot: ReviewLoadingSnapshot | null;
  selectedCardId: string | null;
  visibleQueueCardsCount: number;
}>;

function isReviewLoadingPreviewDue(dueAt: string | null, nowTimestamp: number): boolean {
  if (dueAt === null) {
    return true;
  }

  const dueAtMillis = parseDueAtMillis(dueAt);
  return dueAtMillis !== null && dueAtMillis <= nowTimestamp;
}

export function ReviewQueuePanel(props: ReviewQueuePanelProps): ReactElement {
  const {
    isInitialReviewLoad,
    loadingReviewCurrentCard,
    nowTimestamp,
    queueCards,
    reviewLoadingSnapshot,
    selectedCardId,
    visibleQueueCardsCount,
  } = props;
  const { t, formatCount, formatDateTime } = useI18n();

  return (
    <aside className="review-queue-panel" id="review-queue-panel">
      <div className="review-queue-head">
        <h2 className="panel-subtitle">{t("reviewScreen.queue.title")}</h2>
        <span className="review-queue-caption">
          {isInitialReviewLoad && reviewLoadingSnapshot === null
            ? t("reviewScreen.queue.loading")
            : formatCount(visibleQueueCardsCount, {
              one: t("common.countLabels.card.one"),
              other: t("common.countLabels.card.other"),
            })}
        </span>
      </div>
      {isInitialReviewLoad ? (
        reviewLoadingSnapshot !== null && reviewLoadingSnapshot.queuePreview.length > 0 ? (
          <div className="review-queue-list">
            {reviewLoadingSnapshot.queuePreview.map((card, index) => {
              const isDue = isReviewLoadingPreviewDue(card.dueAt, nowTimestamp);
              const isActive = loadingReviewCurrentCard?.cardId === card.cardId || (loadingReviewCurrentCard === null && index === 0);

              return (
                <div
                  key={card.cardId}
                  className={`review-queue-card${isDue ? "" : " review-queue-card-upcoming"}${isActive ? " review-queue-card-active" : ""}`}
                  data-testid="review-queue-card"
                  data-card-due-state={isDue ? "due" : "upcoming"}
                  data-card-front-text={card.frontText}
                  data-card-id={card.cardId}
                >
                  <span className="review-queue-card-title">{card.frontText}</span>
                  <span className="review-queue-card-tags">{formatTagSummary(card.tags)}</span>
                  <span className="review-queue-card-meta">
                    <span>{formatEffortLevelLabel(t, card.effortLevel)}</span>
                    <span>{formatNullableDateTime(card.dueAt, formatDateTime, t)}</span>
                    {isDue ? null : <span>{t("reviewScreen.queue.upcoming")}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="review-queue-list review-loading-queue-list" aria-hidden="true">
            {["queue-1", "queue-2", "queue-3", "queue-4"].map((key) => (
              <div key={key} className="review-queue-card review-loading-queue-card">
                <span className="review-loading-line review-loading-line-title" />
                <span className="review-loading-line review-loading-line-short" />
                <span className="review-loading-line review-loading-line-shorter" />
              </div>
            ))}
          </div>
        )
      ) : queueCards.length === 0 ? (
        <p className="subtitle">{t("reviewScreen.empty.queue")}</p>
      ) : (
        <div className="review-queue-list">
          {queueCards.map((card) => {
            const isDue = isCardDue(card, nowTimestamp);

            return (
              <div
                key={card.cardId}
                className={`review-queue-card${isDue ? "" : " review-queue-card-upcoming"}${selectedCardId === card.cardId ? " review-queue-card-active" : ""}`}
                data-testid="review-queue-card"
                data-card-due-state={isDue ? "due" : "upcoming"}
                data-card-front-text={card.frontText}
                data-card-id={card.cardId}
              >
                <span className="review-queue-card-title">{card.frontText}</span>
                <span className="review-queue-card-tags">{formatTagSummary(card.tags)}</span>
                <span className="review-queue-card-meta">
                  <span>{formatEffortLevelLabel(t, card.effortLevel)}</span>
                  <span>{formatNullableDateTime(card.dueAt, formatDateTime, t)}</span>
                  {isDue ? null : <span>{t("reviewScreen.queue.upcoming")}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
