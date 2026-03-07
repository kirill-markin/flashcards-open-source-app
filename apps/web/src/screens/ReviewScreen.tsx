import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import type { Card } from "../types";

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

function renderTags(tags: ReadonlyArray<string>): string {
  return tags.length === 0 ? "—" : tags.join(", ");
}

function isCardDue(card: Card, nowTimestamp: number): boolean {
  if (card.dueAt === null) {
    return true;
  }

  return new Date(card.dueAt).getTime() <= nowTimestamp;
}

function compareCardsForReviewQueue(leftCard: Card, rightCard: Card, nowTimestamp: number): number {
  const leftIsDue = isCardDue(leftCard, nowTimestamp);
  const rightIsDue = isCardDue(rightCard, nowTimestamp);

  if (leftIsDue !== rightIsDue) {
    return leftIsDue ? -1 : 1;
  }

  if (leftCard.dueAt === null && rightCard.dueAt !== null) {
    return -1;
  }

  if (leftCard.dueAt !== null && rightCard.dueAt === null) {
    return 1;
  }

  if (leftCard.dueAt !== null && rightCard.dueAt !== null) {
    const dueAtDifference = new Date(leftCard.dueAt).getTime() - new Date(rightCard.dueAt).getTime();
    if (dueAtDifference !== 0) {
      return dueAtDifference;
    }
  }

  return new Date(rightCard.updatedAt).getTime() - new Date(leftCard.updatedAt).getTime();
}

function sortCardsForReviewQueue(cards: ReadonlyArray<Card>, nowTimestamp: number): ReadonlyArray<Card> {
  return [...cards].sort((leftCard, rightCard) => compareCardsForReviewQueue(leftCard, rightCard, nowTimestamp));
}

function formatQueueBadge(dueCount: number, totalCount: number): string {
  const upcomingCount = totalCount - dueCount;
  if (upcomingCount <= 0) {
    return `${dueCount} due`;
  }

  return `${dueCount} due • ${upcomingCount} upcoming`;
}

export function ReviewScreen(): ReactElement {
  const {
    cards,
    cardsState,
    reviewQueue,
    reviewQueueState,
    ensureCardsLoaded,
    ensureReviewQueueLoaded,
    refreshReviewQueue,
    submitReviewItem,
    setErrorMessage,
  } = useAppData();
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [isAnswerVisible, setIsAnswerVisible] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const nowTimestamp = Date.now();
  const queueCards = cardsState.hasLoaded ? sortCardsForReviewQueue(cards, nowTimestamp) : reviewQueue;
  const selectedCard = reviewQueue.find((card) => card.cardId === selectedCardId) ?? reviewQueue[0] ?? null;

  useEffect(() => {
    void ensureCardsLoaded();
    void ensureReviewQueueLoaded();
  }, [ensureCardsLoaded, ensureReviewQueueLoaded]);

  useEffect(() => {
    if (reviewQueue.length === 0) {
      setSelectedCardId("");
      return;
    }

    const selectedStillExists = reviewQueue.some((card) => card.cardId === selectedCardId);
    if (!selectedStillExists) {
      setSelectedCardId(reviewQueue[0].cardId);
    }
  }, [reviewQueue, selectedCardId]);

  useEffect(() => {
    setIsAnswerVisible(false);
  }, [selectedCardId]);

  async function handleReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      await submitReviewItem(card.cardId, rating);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const resourceErrorMessage = reviewQueueState.status === "error"
    ? reviewQueueState.errorMessage
    : cardsState.status === "error"
      ? cardsState.errorMessage
      : "";

  if (reviewQueueState.status === "loading" && !reviewQueueState.hasLoaded) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Review</h1>
          <p className="subtitle">Loading review queue…</p>
        </section>
      </main>
    );
  }

  if (reviewQueueState.status === "error" && !reviewQueueState.hasLoaded) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Review</h1>
          <p className="error-banner">{reviewQueueState.errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshReviewQueue()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel">
        {resourceErrorMessage !== "" ? <p className="error-banner">{resourceErrorMessage}</p> : null}
        <div className="screen-head">
          <div>
            <h1 className="title">Review</h1>
            <p className="subtitle">Queue table plus a focused flip flow.</p>
          </div>
          <span className="badge">{formatQueueBadge(reviewQueue.length, queueCards.length)}</span>
        </div>

        <div className="review-layout">
          <section className="review-pane">
            {selectedCard === null ? (
              <div className="review-empty">
                <h2 className="panel-subtitle">Nothing to review</h2>
                <p className="subtitle">Create more cards or come back when the queue is due again.</p>
              </div>
            ) : (
              <>
                <div className="review-pane-head">
                  <span className="badge">{selectedCard.effortLevel}</span>
                  <span className="badge">{renderTags(selectedCard.tags)}</span>
                </div>
                <div className="review-card-surface">
                  <div className="review-label">Front</div>
                  <div className="review-front">{selectedCard.frontText}</div>
                </div>

                {isAnswerVisible ? (
                  <div className="review-card-surface review-card-answer">
                    <div className="review-label">Back</div>
                    <div className="review-back">{selectedCard.backText}</div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => setIsAnswerVisible(true)}
                  >
                    Reveal answer
                  </button>
                )}

                <div className="review-meta">
                  <span>Due {formatTimestamp(selectedCard.dueAt)}</span>
                  <span>Reps {selectedCard.reps}</span>
                  <span>Lapses {selectedCard.lapses}</span>
                </div>

                {isAnswerVisible ? (
                  <div className="rating-bar">
                    {[0, 1, 2, 3].map((rating) => (
                      <button
                        key={rating}
                        type="button"
                        className="rating-btn"
                        disabled={isSubmitting}
                        onClick={() => void handleReview(selectedCard, rating as 0 | 1 | 2 | 3)}
                      >
                        {isSubmitting ? "…" : rating}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>

          <div className="txn-scroll">
            <table className="txn-table">
              <thead>
                <tr>
                  <th className="txn-th">Front</th>
                  <th className="txn-th">Tags</th>
                  <th className="txn-th">Effort</th>
                  <th className="txn-th">Due</th>
                </tr>
              </thead>
              <tbody>
                {queueCards.map((card) => {
                  const isDue = isCardDue(card, nowTimestamp);

                  return (
                    <tr
                      key={card.cardId}
                      className={`txn-row${isDue ? " review-row" : " review-row-upcoming"}${selectedCard?.cardId === card.cardId ? " review-row-active" : ""}`}
                      onClick={() => {
                        if (isDue) {
                          setSelectedCardId(card.cardId);
                        }
                      }}
                    >
                      <td className="txn-cell">
                        <div className="cell-stack">
                          <span className="cell-primary">{card.frontText}</span>
                          {isDue ? null : <span className="cell-secondary">Upcoming</span>}
                        </div>
                      </td>
                      <td className="txn-cell txn-cell-mono">{renderTags(card.tags)}</td>
                      <td className="txn-cell txn-cell-mono">{card.effortLevel}</td>
                      <td className="txn-cell txn-cell-mono">{formatTimestamp(card.dueAt)}</td>
                    </tr>
                  );
                })}
                {queueCards.length === 0 ? (
                  <tr>
                    <td className="txn-cell txn-empty" colSpan={4}>No cards yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
