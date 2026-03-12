import { useEffect, useRef, type ReactElement, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAppData } from "../appData";
import {
  ALL_CARDS_REVIEW_FILTER,
  currentReviewCard,
  isCardDue,
  makeWorkspaceTagsSummary,
} from "../appData/domain";
import { CardFormFields, toCardFormState, type CardFormState } from "./CardForm";
import type { Card, Deck, ReviewFilter, WorkspaceSchedulerSettings, WorkspaceTagSummary } from "../types";
import {
  computeReviewSchedule,
  type ReviewRating,
} from "../../../backend/src/schedule";
import {
  classifyReviewContentPresentation,
  type ReviewContentPresentationMode,
} from "./reviewContentPresentation";
import { settingsDecksRoute } from "../routes";

type ReviewButtonOption = Readonly<{
  title: string;
  rating: 0 | 1 | 2 | 3;
  intervalDescription: string;
}>;

const EMPTY_BACK_TEXT_PLACEHOLDER = "No back text";
const REVIEW_BUTTONS_PER_COLUMN = 2;
const REVIEW_FILTER_DECK_PREFIX = "deck:";
const REVIEW_FILTER_TAG_PREFIX = "tag:";

type ReviewFilterMenuItem =
  | Readonly<{
    kind: "filter";
    key: string;
    label: string;
    reviewFilter: ReviewFilter;
    isSelected: boolean;
  }>
  | Readonly<{
    kind: "action";
    key: "edit-decks";
    label: string;
    href: string;
  }>
  | Readonly<{
    kind: "separator";
    key: "tags-separator";
  }>;

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

function toReviewFilterMenuItemKey(reviewFilter: ReviewFilter): string {
  if (reviewFilter.kind === "allCards") {
    return "allCards";
  }

  if (reviewFilter.kind === "deck") {
    return `${REVIEW_FILTER_DECK_PREFIX}${reviewFilter.deckId}`;
  }

  return `${REVIEW_FILTER_TAG_PREFIX}${reviewFilter.tag}`;
}

function buildReviewFilterMenuItems(
  decks: ReadonlyArray<Deck>,
  reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>,
  selectedReviewFilter: ReviewFilter,
): Array<ReviewFilterMenuItem> {
  const items: Array<ReviewFilterMenuItem> = [
    {
      kind: "filter",
      key: toReviewFilterMenuItemKey(ALL_CARDS_REVIEW_FILTER),
      label: "All cards",
      reviewFilter: ALL_CARDS_REVIEW_FILTER,
      isSelected: toReviewFilterMenuItemKey(selectedReviewFilter) === toReviewFilterMenuItemKey(ALL_CARDS_REVIEW_FILTER),
    },
    ...decks.map((deck) => {
      const reviewFilter: ReviewFilter = {
        kind: "deck",
        deckId: deck.deckId,
      };

      return {
        kind: "filter" as const,
        key: toReviewFilterMenuItemKey(reviewFilter),
        label: deck.name,
        reviewFilter,
        isSelected: toReviewFilterMenuItemKey(selectedReviewFilter) === toReviewFilterMenuItemKey(reviewFilter),
      };
    }),
    {
      kind: "action",
      key: "edit-decks",
      label: "Edit decks",
      href: settingsDecksRoute,
    },
  ];

  if (reviewTagSummaries.length === 0) {
    return items;
  }

  return [
    ...items,
    {
      kind: "separator",
      key: "tags-separator",
    },
    ...reviewTagSummaries.map((tagSummary) => {
      const reviewFilter: ReviewFilter = {
        kind: "tag",
        tag: tagSummary.tag,
      };

      return {
        kind: "filter" as const,
        key: toReviewFilterMenuItemKey(reviewFilter),
        label: `${tagSummary.tag} (${tagSummary.cardsCount})`,
        reviewFilter,
        isSelected: toReviewFilterMenuItemKey(selectedReviewFilter) === toReviewFilterMenuItemKey(reviewFilter),
      };
    }),
  ];
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

type ReviewCardSideProps = Readonly<{
  label: string;
  text: string;
  contentClassName: string;
  surfaceClassName?: string;
}>;

function reviewMarkdownClassName(tagName: string): string {
  return `review-markdown-${tagName}`;
}

function ReviewCardMarkdown({ text }: Readonly<{ text: string }>): ReactElement {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className={reviewMarkdownClassName("h1")}>{children}</h1>,
        h2: ({ children }) => <h2 className={reviewMarkdownClassName("h2")}>{children}</h2>,
        h3: ({ children }) => <h3 className={reviewMarkdownClassName("h3")}>{children}</h3>,
        h4: ({ children }) => <h4 className={reviewMarkdownClassName("h4")}>{children}</h4>,
        h5: ({ children }) => <h5 className={reviewMarkdownClassName("h5")}>{children}</h5>,
        h6: ({ children }) => <h6 className={reviewMarkdownClassName("h6")}>{children}</h6>,
        p: ({ children }) => <p className={reviewMarkdownClassName("p")}>{children}</p>,
        ul: ({ children }) => <ul className={reviewMarkdownClassName("ul")}>{children}</ul>,
        ol: ({ children }) => <ol className={reviewMarkdownClassName("ol")}>{children}</ol>,
        li: ({ children }) => <li className={reviewMarkdownClassName("li")}>{children}</li>,
        blockquote: ({ children }) => <blockquote className={reviewMarkdownClassName("blockquote")}>{children}</blockquote>,
        hr: () => <hr className={reviewMarkdownClassName("hr")} />,
        table: ({ children }) => <table className={reviewMarkdownClassName("table")}>{children}</table>,
        thead: ({ children }) => <thead className={reviewMarkdownClassName("thead")}>{children}</thead>,
        tbody: ({ children }) => <tbody className={reviewMarkdownClassName("tbody")}>{children}</tbody>,
        tr: ({ children }) => <tr className={reviewMarkdownClassName("tr")}>{children}</tr>,
        th: ({ children }) => <th className={reviewMarkdownClassName("th")}>{children}</th>,
        td: ({ children }) => <td className={reviewMarkdownClassName("td")}>{children}</td>,
        pre: ({ children }) => <pre className={reviewMarkdownClassName("pre")}>{children}</pre>,
        code: ({ children, className }) => (
          <code className={`${reviewMarkdownClassName("code")}${className === undefined ? "" : ` ${className}`}`}>
            {children}
          </code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function ReviewCardSide({ label, text, contentClassName, surfaceClassName }: ReviewCardSideProps): ReactElement {
  const presentationMode = classifyReviewContentPresentation(text);

  return (
    <div className={surfaceClassName === undefined ? "review-card-surface" : surfaceClassName}>
      <div className="review-label">{label}</div>
      <div className="review-card-body">
        <div
          className={[
            "review-card-content",
            contentClassName,
            `review-card-content-${presentationMode}`,
          ].join(" ")}
          data-presentation-mode={presentationMode}
        >
          {presentationMode === "markdown" ? <ReviewCardMarkdown text={text} /> : text}
        </div>
      </div>
    </div>
  );
}

function ReviewFilterDecksIcon(): ReactElement {
  return (
    <svg className="review-filter-menu-item-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7.5L12 3L21 7.5L12 12L3 7.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12.5L12 17L21 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 17.5L12 22L21 17.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReviewFilterCheckIcon(): ReactElement {
  return (
    <svg className="review-filter-menu-item-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 6L9 17L4 12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReviewScreen(): ReactElement {
  const {
    cards,
    cardsState,
    decks,
    reviewQueue,
    reviewTimeline,
    reviewQueueState,
    selectedReviewFilter,
    selectedReviewFilterTitle,
    workspaceSettings,
    ensureCardsLoaded,
    ensureDecksLoaded,
    ensureReviewQueueLoaded,
    refreshReviewQueue,
    selectReviewFilter,
    submitReviewItem,
    updateCardItem,
    deleteCardItem,
    setErrorMessage,
  } = useAppData();
  const [isAnswerVisible, setIsAnswerVisible] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isEditorPresented, setIsEditorPresented] = useState<boolean>(false);
  const [editingCardId, setEditingCardId] = useState<string>("");
  const [editorFormState, setEditorFormState] = useState<CardFormState>(toCardFormState(null));
  const [editorErrorMessage, setEditorErrorMessage] = useState<string>("");
  const [isEditorSaving, setIsEditorSaving] = useState<boolean>(false);
  const [isReviewFilterMenuOpen, setIsReviewFilterMenuOpen] = useState<boolean>(false);
  const reviewFilterMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const reviewFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const nowTimestamp = Date.now();
  const activeReviewQueue = reviewQueue;
  const queueCards = cardsState.hasLoaded ? reviewTimeline : reviewQueue;
  const selectedCard = currentReviewCard(activeReviewQueue);
  const editingCard = cards.find((card) => card.cardId === editingCardId && card.deletedAt === null) ?? null;
  const reviewTagSummaries = makeWorkspaceTagsSummary(cards).tags;
  const reviewFilterMenuItems = buildReviewFilterMenuItems(decks, reviewTagSummaries, selectedReviewFilter);
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

  const leftReviewButtonOptions = reviewButtonOptions.slice(0, REVIEW_BUTTONS_PER_COLUMN);
  const rightReviewButtonOptions = reviewButtonOptions.slice(REVIEW_BUTTONS_PER_COLUMN, REVIEW_BUTTONS_PER_COLUMN * 2);

  useEffect(() => {
    void ensureCardsLoaded();
    void ensureDecksLoaded();
    void ensureReviewQueueLoaded();
  }, [ensureCardsLoaded, ensureDecksLoaded, ensureReviewQueueLoaded]);

  useEffect(() => {
    setIsAnswerVisible(false);
  }, [selectedCard?.cardId]);

  useEffect(() => {
    if (!isReviewFilterMenuOpen) {
      return;
    }

    function handleMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (reviewFilterMenuWrapRef.current !== null && !reviewFilterMenuWrapRef.current.contains(target)) {
        setIsReviewFilterMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isReviewFilterMenuOpen]);

  useEffect(() => {
    if (!isReviewFilterMenuOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsReviewFilterMenuOpen(false);
        reviewFilterTriggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isReviewFilterMenuOpen]);

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

  function handleReviewFilterMenuToggle(): void {
    setIsReviewFilterMenuOpen((currentValue) => !currentValue);
  }

  function handleReviewFilterSelect(reviewFilter: ReviewFilter): void {
    selectReviewFilter(reviewFilter);
    setIsReviewFilterMenuOpen(false);
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
          <div className="screen-actions review-screen-actions">
            <div className="review-filter-summary-wrap">
              <span className="review-filter-label">Queue</span>
              <span className="badge review-filter-summary">{formatQueueBadge(activeReviewQueue.length, queueCards.length)}</span>
            </div>
            <div ref={reviewFilterMenuWrapRef} className="review-filter-menu-wrap">
              <span className="review-filter-label">Deck</span>
              <button
                ref={reviewFilterTriggerRef}
                className={`ghost-btn review-filter-trigger${isReviewFilterMenuOpen ? " review-filter-trigger-open" : ""}`}
                type="button"
                aria-expanded={isReviewFilterMenuOpen}
                aria-haspopup="menu"
                aria-label="Open review filter"
                onClick={handleReviewFilterMenuToggle}
              >
                <span className="review-filter-trigger-value">{selectedReviewFilterTitle}</span>
                <span className="review-filter-trigger-chevron" aria-hidden="true">▾</span>
              </button>
              {isReviewFilterMenuOpen ? (
                <div className="review-filter-menu" role="menu" aria-label="Review filter">
                  {reviewFilterMenuItems.map((item) => {
                    if (item.kind === "separator") {
                      return <div key={item.key} className="review-filter-menu-divider" role="separator" />;
                    }

                    if (item.kind === "action") {
                      return (
                        <Link
                          key={item.key}
                          className="review-filter-menu-entry review-filter-menu-entry-action"
                          to={item.href}
                          role="menuitem"
                          onClick={() => setIsReviewFilterMenuOpen(false)}
                        >
                          <span className="review-filter-menu-item-slot" aria-hidden="true">
                            <ReviewFilterDecksIcon />
                          </span>
                          <span className="review-filter-menu-item-label">{item.label}</span>
                        </Link>
                      );
                    }

                    return (
                      <button
                        key={item.key}
                        className={`review-filter-menu-entry${item.isSelected ? " review-filter-menu-entry-active" : ""}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={item.isSelected}
                        data-review-filter-key={item.key}
                        onClick={() => handleReviewFilterSelect(item.reviewFilter)}
                      >
                        <span className="review-filter-menu-item-slot" aria-hidden="true">
                          <span className={`review-filter-menu-item-check${item.isSelected ? " review-filter-menu-item-check-visible" : ""}`}>
                            <ReviewFilterCheckIcon />
                          </span>
                        </span>
                        <span className="review-filter-menu-item-label">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
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
                <div className="review-card-stack">
                  <ReviewCardSide
                    label="Front"
                    text={selectedCard.frontText}
                    contentClassName="review-front"
                  />

                  {isAnswerVisible ? (
                    <ReviewCardSide
                      label="Back"
                      text={selectedCard.backText === "" ? EMPTY_BACK_TEXT_PLACEHOLDER : selectedCard.backText}
                      contentClassName="review-back"
                      surfaceClassName="review-card-surface review-card-answer"
                    />
                  ) : null}
                </div>

                <div className="review-meta">
                  <span>Due {formatTimestamp(selectedCard.dueAt)}</span>
                  <span>Reps {selectedCard.reps}</span>
                  <span>Lapses {selectedCard.lapses}</span>
                </div>

                <div className="review-actions-dock">
                  {isAnswerVisible ? (
                    reviewButtonErrorMessage !== "" ? (
                      <p className="error-banner">{reviewButtonErrorMessage}</p>
                    ) : (
                      <div className="rating-bar">
                        <div className="rating-bar-column">
                          {leftReviewButtonOptions.map((option) => (
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
                        <div className="rating-bar-column">
                          {rightReviewButtonOptions.map((option) => (
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
                      </div>
                    )
                  ) : (
                    <button
                      type="button"
                      className="primary-btn review-reveal-btn"
                      onClick={() => setIsAnswerVisible(true)}
                    >
                      Reveal answer
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="review-queue-panel">
            <div className="review-queue-head">
              <div>
                <h2 className="panel-subtitle">Queue</h2>
                <p className="subtitle review-queue-subtitle">{selectedReviewFilterTitle}</p>
              </div>
              <span className="review-queue-caption">{queueCards.length} cards</span>
            </div>
            {queueCards.length === 0 ? (
              <p className="subtitle">No cards to review right now.</p>
            ) : (
              <div className="review-queue-list">
                {queueCards.map((card) => {
                  const isDue = isCardDue(card, nowTimestamp);

                  return (
                    <div
                      key={card.cardId}
                      className={`review-queue-card${isDue ? "" : " review-queue-card-upcoming"}${selectedCard?.cardId === card.cardId ? " review-queue-card-active" : ""}`}
                    >
                      <span className="review-queue-card-title">{card.frontText}</span>
                      <span className="review-queue-card-tags">{renderTags(card.tags)}</span>
                      <span className="review-queue-card-meta">
                        <span>{card.effortLevel}</span>
                        <span>{formatTimestamp(card.dueAt)}</span>
                        {isDue ? null : <span>Upcoming</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
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
