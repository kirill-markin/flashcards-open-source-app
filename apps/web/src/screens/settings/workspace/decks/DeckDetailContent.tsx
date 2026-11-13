import { memo, type ReactElement, type ReactNode, type Ref } from "react";
import { isCardDue } from "../../../../appData/domain";
import { parseDueAtMillis } from "../../../../appData/domain/dueAt";
import { CardPreviewText } from "../../../../components/CardPreviewText";
import { useI18n } from "../../../../i18n";
import type { Card } from "../../../../types";
import { formatTagSummary } from "../../../shared/featureFormatting";

export function DeckDetailStats({ cards }: Readonly<{ cards: ReadonlyArray<Card> }>): ReactElement {
  const { t, formatNumber } = useI18n();
  const nowTimestamp = Date.now();

  return (
    <div className="deck-detail-stats">
      <div className="content-card deck-detail-stat-card">
        <span className="deck-detail-stat-label">{t("deckDetail.rules.cards")}</span>
        <span className="deck-detail-stat-value">{formatNumber(cards.length)}</span>
      </div>
      <div className="content-card deck-detail-stat-card">
        <span className="deck-detail-stat-label">{t("deckDetail.rules.toStudy")}</span>
        <span className="deck-detail-stat-value">{formatNumber(cards.filter((card) => isCardDue(card, nowTimestamp)).length)}</span>
      </div>
      <div className="content-card deck-detail-stat-card">
        <span className="deck-detail-stat-label">{t("deckDetail.rules.new")}</span>
        <span className="deck-detail-stat-value">{formatNumber(cards.filter((card) => card.reps === 0 && card.lapses === 0).length)}</span>
      </div>
    </div>
  );
}

export function MatchingCardsSection({
  cardCount,
  emptyMessage,
  children,
}: Readonly<{ cardCount: number; emptyMessage: string; children: ReactNode }>): ReactElement {
  const { messages, t, formatCount } = useI18n();

  return (
    <section className="deck-detail-panel" data-testid="matching-cards">
      <div className="deck-detail-cards-head">
        <h2 className="panel-subtitle">{t("deckDetail.matchingCards.title")}</h2>
        <span className="badge">{formatCount(cardCount, messages.common.countLabels.card)}</span>
      </div>
      {cardCount === 0 ? (
        <section className="content-card deck-detail-empty">
          <p className="subtitle">{emptyMessage}</p>
        </section>
      ) : (
        <div className="deck-detail-cards">{children}</div>
      )}
    </section>
  );
}

export const MatchingCardPreview = memo(function MatchingCardPreview({
  card,
  rowRef,
}: Readonly<{ card: Card; rowRef?: Ref<HTMLElement> }>): ReactElement {
  const { t, formatDateTime, formatNumber } = useI18n();
  const dueAtMillis = card.dueAt === null ? null : parseDueAtMillis(card.dueAt);
  const dueLabel = card.dueAt === null
    ? t("reviewScreen.repetitionBadgeNew")
    : dueAtMillis === null
      ? null
      : t("deckDetail.meta.due", { value: formatDateTime(dueAtMillis) });

  return (
    <article className="content-card deck-detail-card" ref={rowRef}>
      <div className="deck-detail-card-head">
        {card.tags.length === 0 ? (
          <span className="tag-value-empty">{t("common.noTags")}</span>
        ) : (
          <span className="badge">{formatTagSummary(card.tags, t)}</span>
        )}
      </div>
      <h3 className="panel-subtitle"><CardPreviewText text={card.frontText} /></h3>
      <p className="subtitle"><CardPreviewText text={card.backText === "" ? t("common.noBackText") : card.backText} /></p>
      <div className="review-meta">
        {dueLabel === null ? null : <span>{dueLabel}</span>}
        <span>{t("deckDetail.meta.reps", { count: formatNumber(card.reps) })}</span>
        <span>{t("deckDetail.meta.lapses", { count: formatNumber(card.lapses) })}</span>
      </div>
    </article>
  );
});
