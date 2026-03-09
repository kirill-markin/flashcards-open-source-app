import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import { CardFormFields, toCardFormState, type CardFormState } from "./CardForm";
import type { Card, WorkspaceSchedulerSettings } from "../types";
import {
  computeReviewSchedule,
  type ReviewRating,
} from "../../../backend/src/schedule";

type ReviewButtonOption = Readonly<{
  title: string;
  rating: 0 | 1 | 2 | 3;
  intervalDescription: string;
}>;

const EMPTY_BACK_TEXT_PLACEHOLDER = "No back text";

const reviewAnswerOptions: ReadonlyArray<Readonly<{
  title: string;
  rating: ReviewRating;
}>> = [
  { title: "Easy", rating: 3 },
  { title: "Good", rating: 2 },
  { title: "Hard", rating: 1 },
  { title: "Again", rating: 0 },
];

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

function formatReviewIntervalDescription(now: Date, dueAt: Date): string {
  const durationMilliseconds = Math.max(dueAt.getTime() - now.getTime(), 0);
  const durationSeconds = Math.floor(durationMilliseconds / 1000);

  if (durationSeconds < 60) {
    return "in less than a minute";
  }

  const durationMinutes = Math.floor(durationSeconds / 60);
  if (durationMinutes < 60) {
    return `in ${durationMinutes} minute${durationMinutes === 1 ? "" : "s"}`;
  }

  const durationHours = Math.floor(durationMinutes / 60);
  if (durationHours < 24) {
    return `in ${durationHours} hour${durationHours === 1 ? "" : "s"}`;
  }

  const durationDays = Math.floor(durationHours / 24);
  return `in ${durationDays} day${durationDays === 1 ? "" : "s"}`;
}

function buildReviewButtonOptions(card: Card, schedulerSettings: WorkspaceSchedulerSettings, now: Date): Array<ReviewButtonOption> {
  return reviewAnswerOptions.map((option) => {
    const schedule = computeReviewSchedule(
      {
        cardId: card.cardId,
        reps: card.reps,
        lapses: card.lapses,
        fsrsCardState: card.fsrsCardState,
        fsrsStepIndex: card.fsrsStepIndex,
        fsrsStability: card.fsrsStability,
        fsrsDifficulty: card.fsrsDifficulty,
        fsrsLastReviewedAt: card.fsrsLastReviewedAt === null ? null : new Date(card.fsrsLastReviewedAt),
        fsrsScheduledDays: card.fsrsScheduledDays,
      },
      {
        algorithm: schedulerSettings.algorithm,
        desiredRetention: schedulerSettings.desiredRetention,
        learningStepsMinutes: schedulerSettings.learningStepsMinutes,
        relearningStepsMinutes: schedulerSettings.relearningStepsMinutes,
        maximumIntervalDays: schedulerSettings.maximumIntervalDays,
        enableFuzz: schedulerSettings.enableFuzz,
      },
      option.rating,
      now,
    );

    return {
      title: option.title,
      rating: option.rating,
      intervalDescription: formatReviewIntervalDescription(now, schedule.dueAt),
    };
  });
}

export function ReviewScreen(): ReactElement {
  const {
    cards,
    cardsState,
    reviewQueue,
    reviewQueueState,
    workspaceSettings,
    ensureCardsLoaded,
    ensureReviewQueueLoaded,
    refreshReviewQueue,
    submitReviewItem,
    updateCardItem,
    deleteCardItem,
    setErrorMessage,
  } = useAppData();
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [isAnswerVisible, setIsAnswerVisible] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isEditorPresented, setIsEditorPresented] = useState<boolean>(false);
  const [editingCardId, setEditingCardId] = useState<string>("");
  const [editorFormState, setEditorFormState] = useState<CardFormState>(toCardFormState(null));
  const [editorErrorMessage, setEditorErrorMessage] = useState<string>("");
  const [isEditorSaving, setIsEditorSaving] = useState<boolean>(false);
  const nowTimestamp = Date.now();
  const queueCards = cardsState.hasLoaded ? sortCardsForReviewQueue(cards, nowTimestamp) : reviewQueue;
  const selectedCard = reviewQueue.find((card) => card.cardId === selectedCardId) ?? reviewQueue[0] ?? null;
  const editingCard = cards.find((card) => card.cardId === editingCardId && card.deletedAt === null) ?? null;
  const reviewButtonsNow = new Date();
  let reviewButtonOptions: Array<ReviewButtonOption> = [];
  let reviewButtonErrorMessage: string = "";

  if (isAnswerVisible && selectedCard !== null && workspaceSettings !== null) {
    try {
      reviewButtonOptions = buildReviewButtonOptions(selectedCard, workspaceSettings, reviewButtonsNow);
    } catch (error) {
      reviewButtonErrorMessage = error instanceof Error ? error.message : String(error);
    }
  } else if (isAnswerVisible && selectedCard !== null) {
    reviewButtonErrorMessage = "Workspace scheduler settings are not loaded";
  }

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

  function openEditor(card: Card): void {
    setSelectedCardId(card.cardId);
    setEditingCardId(card.cardId);
    setEditorFormState(toCardFormState(card));
    setEditorErrorMessage("");
    setIsEditorPresented(true);
  }

  async function handleEditorSave(): Promise<void> {
    if (editingCardId === "") {
      setEditorErrorMessage("Card not found");
      return;
    }

    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      await updateCardItem(editingCardId, {
        frontText: editorFormState.frontText,
        backText: editorFormState.backText,
        tags: editorFormState.tags,
        effortLevel: editorFormState.effortLevel,
      });
      setSelectedCardId(editingCardId);
      setIsEditorPresented(false);
    } catch (error) {
      setEditorErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function handleEditorDelete(): Promise<void> {
    if (editingCardId === "") {
      setEditorErrorMessage("Card not found");
      return;
    }

    if (window.confirm("Delete this card?") === false) {
      return;
    }

    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      await deleteCardItem(editingCardId);
      setIsEditorPresented(false);
    } catch (error) {
      setEditorErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEditorSaving(false);
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
                <h2 className="panel-subtitle">Nothing to review right now</h2>
                <p className="subtitle">You're all caught up, or you haven't added any cards yet. Add cards or come back later.</p>
              </div>
            ) : (
              <>
                <div className="review-pane-head">
                  <div className="review-pane-head-meta">
                    <span className="badge">{selectedCard.effortLevel}</span>
                    <span className="badge">{renderTags(selectedCard.tags)}</span>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn review-pane-edit-btn"
                    onClick={() => openEditor(selectedCard)}
                  >
                    Edit
                  </button>
                </div>
                <div className="review-card-surface">
                  <div className="review-label">Front</div>
                  <div className="review-front">{selectedCard.frontText}</div>
                </div>

                {isAnswerVisible ? (
                  <div className="review-card-surface review-card-answer">
                    <div className="review-label">Back</div>
                    <div className="review-back">{selectedCard.backText === "" ? EMPTY_BACK_TEXT_PLACEHOLDER : selectedCard.backText}</div>
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
                  reviewButtonErrorMessage !== "" ? (
                    <p className="error-banner">{reviewButtonErrorMessage}</p>
                  ) : (
                    <div className="rating-bar">
                      {reviewButtonOptions.map((option) => (
                        <button
                          key={option.rating}
                          type="button"
                          className="rating-btn"
                          disabled={isSubmitting}
                          onClick={() => void handleReview(selectedCard, option.rating)}
                        >
                          <span className="rating-btn-title">{option.title}</span>
                          <span className="rating-btn-subtitle">{option.intervalDescription}</span>
                        </button>
                      ))}
                    </div>
                  )
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
                    <td className="txn-cell txn-empty" colSpan={4}>No cards to review right now.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {isEditorPresented && editingCard !== null ? (
        <div className="review-editor-overlay">
          <section className="panel review-editor-modal" role="dialog" aria-modal="true" aria-labelledby="review-editor-title">
            <div className="screen-head">
              <div>
                <h2 id="review-editor-title" className="title">Edit card</h2>
                <p className="subtitle">Update the current review card without leaving review.</p>
              </div>
              <div className="screen-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={isEditorSaving}
                  onClick={() => setIsEditorPresented(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ghost-btn review-editor-delete-btn"
                  disabled={isEditorSaving}
                  onClick={() => void handleEditorDelete()}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={isEditorSaving}
                  onClick={() => void handleEditorSave()}
                >
                  {isEditorSaving ? "Saving…" : "Save card"}
                </button>
              </div>
            </div>

            {editorErrorMessage !== "" ? <p className="error-banner">{editorErrorMessage}</p> : null}

            <CardFormFields
              cards={cards}
              currentCard={editingCard}
              formState={editorFormState}
              formIdPrefix="review-card-editor"
              isSaving={isEditorSaving}
              onChange={setEditorFormState}
            />
          </section>
        </div>
      ) : null}
    </main>
  );
}
