import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAppData } from "../appData";
import { ALL_CARDS_REVIEW_FILTER, currentReviewCard, isCardDue } from "../appData/domain";
import type { Card, WorkspaceSchedulerSettings } from "../types";
import { computeReviewSchedule, type ReviewRating } from "../../../backend/src/schedule";
import { classifyReviewContentPresentation } from "./reviewContentPresentation";
import { cardsRoute, chatRoute } from "../routes";
import { ReviewEditorModal } from "./ReviewEditorModal";
import { ReviewFilterMenu } from "./ReviewFilterMenu";
import { formatQueueBadge, useReviewFilterMenu } from "./useReviewFilterMenu";
import { useReviewCardEditor } from "./useReviewCardEditor";
import { useReviewKeyboardShortcuts } from "./useReviewKeyboardShortcuts";
import { useReviewScreenData } from "./useReviewScreenData";

type ReviewButtonOption = Readonly<{
  intervalDescription: string;
  rating: 0 | 1 | 2 | 3;
  title: string;
}>;

const EMPTY_BACK_TEXT_PLACEHOLDER = "No back text";
const REVIEW_BUTTONS_PER_COLUMN = 2;
const REVIEW_MARKDOWN_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN = /^(\s{0,3}[-*+]\s+)([+*\-#>])(\s*)$/;

type MarkdownFenceMarker = "`" | "~";

const reviewAnswerOptions: ReadonlyArray<Readonly<{
  rating: ReviewRating;
  title: string;
}>> = [
  { title: "Again", rating: 0 },
  { title: "Good", rating: 2 },
  { title: "Hard", rating: 1 },
  { title: "Easy", rating: 3 },
];

type ReviewCardSideProps = Readonly<{
  contentClassName: string;
  label: string;
  surfaceClassName?: string;
  text: string;
}>;

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

function renderTags(tags: ReadonlyArray<string>): string {
  return tags.length === 0 ? "—" : tags.join(", ");
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

function isReviewLoadingPreviewDue(dueAt: string | null, nowTimestamp: number): boolean {
  if (dueAt === null) {
    return true;
  }

  return new Date(dueAt).getTime() <= nowTimestamp;
}

function reviewMarkdownClassName(tagName: string): string {
  return `review-markdown-${tagName}`;
}

function toMarkdownFenceMarker(line: string): MarkdownFenceMarker | null {
  const match = REVIEW_MARKDOWN_FENCE_PATTERN.exec(line);

  if (match === null) {
    return null;
  }

  const marker = match[1]?.[0];
  if (marker === "`" || marker === "~") {
    return marker;
  }

  return null;
}

function escapeSymbolOnlyListItem(line: string): string {
  const match = REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN.exec(line);

  if (match === null) {
    return line;
  }

  const listMarker = match[1];
  const symbolToken = match[2];
  const trailingWhitespace = match[3];

  return `${listMarker}\\${symbolToken}${trailingWhitespace}`;
}

export function normalizeReviewMarkdownForWeb(text: string): string {
  const lines = text.split("\n");
  const normalizedLines: Array<string> = [];
  let activeFenceMarker: MarkdownFenceMarker | null = null;

  for (const line of lines) {
    const lineFenceMarker = toMarkdownFenceMarker(line);

    if (activeFenceMarker !== null) {
      normalizedLines.push(line);

      if (lineFenceMarker === activeFenceMarker) {
        activeFenceMarker = null;
      }

      continue;
    }

    if (lineFenceMarker !== null) {
      activeFenceMarker = lineFenceMarker;
      normalizedLines.push(line);
      continue;
    }

    normalizedLines.push(escapeSymbolOnlyListItem(line));
  }

  return normalizedLines.join("\n");
}

function ReviewCardMarkdown({ text }: Readonly<{ text: string }>): ReactElement {
  const normalizedText = normalizeReviewMarkdownForWeb(text);

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
      {normalizedText}
    </ReactMarkdown>
  );
}

function ReviewCardSide(props: ReviewCardSideProps): ReactElement {
  const { contentClassName, label, surfaceClassName, text } = props;
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

export function ReviewScreen(): ReactElement {
  const {
    activeWorkspace,
    selectedReviewFilter,
    workspaceSettings,
    localReadVersion,
    localCardCount,
    refreshLocalData,
    selectReviewFilter,
    submitReviewItem,
    updateCardItem,
    deleteCardItem,
    setErrorMessage,
  } = useAppData();
  const [isAnswerVisible, setIsAnswerVisible] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const {
    activeReviewQueue,
    deckSummaries,
    handleReview: handleReviewData,
    hasLoadedReviewData,
    isInitialReviewLoad,
    queueCards,
    resolvedReviewFilter,
    reviewCounts,
    reviewLoadErrorMessage,
    reviewLoadingSnapshot,
    reviewTagSummaries,
    selectedReviewFilterTitle,
    tagSuggestions,
  } = useReviewScreenData({
    activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
    localReadVersion,
    selectedReviewFilter,
    setErrorMessage,
    submitReviewItem,
  });
  const {
    handleCloseMenu,
    handleReviewFilterMenuToggle,
    handleReviewFilterSelect,
    hasVisibleReviewFilterChoices,
    isReviewFilterMenuOpen,
    reviewDeckSearchInputRef,
    reviewDeckSearchText,
    reviewFilterMenuItems,
    reviewFilterMenuWrapRef,
    reviewFilterTriggerRef,
    setReviewDeckSearchText,
    shouldShowReviewDeckSearch,
    visibleReviewDeckFilterMenuItems,
    visibleReviewTagFilterMenuItems,
  } = useReviewFilterMenu({
    deckSummaries,
    onSelectReviewFilter: selectReviewFilter,
    reviewTagSummaries,
    selectedReviewFilter: resolvedReviewFilter,
  });
  const {
    editorErrorMessage,
    editingCard,
    editorFormState,
    handleEditorDelete,
    handleEditorSave,
    handleOpenEditor,
    isEditorPresented,
    isEditorSaving,
    setEditorFormState,
    setIsEditorPresented,
  } = useReviewCardEditor({
    deleteCardItem,
    queueCards,
    selectedCard: currentReviewCard(activeReviewQueue),
    setErrorMessage,
    updateCardItem,
  });
  const nowTimestamp = Date.now();
  const selectedCard = currentReviewCard(activeReviewQueue);
  const hasCards = localCardCount > 0;
  const shouldShowSwitchToAllCardsAction = resolvedReviewFilter.kind !== "allCards";
  const loadingReviewCurrentCard = reviewLoadingSnapshot?.currentCard ?? reviewLoadingSnapshot?.queuePreview[0] ?? null;
  const visibleReviewCounts = isInitialReviewLoad && reviewLoadingSnapshot !== null
    ? reviewLoadingSnapshot.reviewCounts
    : reviewCounts;
  const visibleSelectedReviewFilterTitle = isInitialReviewLoad && reviewLoadingSnapshot !== null
    ? reviewLoadingSnapshot.resolvedReviewFilterTitle
    : selectedReviewFilterTitle;
  const visibleQueueCardsCount = isInitialReviewLoad && reviewLoadingSnapshot !== null
    ? reviewLoadingSnapshot.queuePreview.length
    : queueCards.length;
  const reviewButtonsNow = new Date();
  let reviewButtonOptions: Array<ReviewButtonOption> = [];
  let reviewButtonErrorMessage: string = "";

  useEffect(() => {
    setIsAnswerVisible(false);
  }, [selectedCard?.cardId]);

  useReviewKeyboardShortcuts({
    handleReview: async (card, rating) => {
      setIsSubmitting(true);

      try {
        await handleReviewData(card, rating);
      } finally {
        setIsSubmitting(false);
      }
    },
    isAnswerVisible,
    isEditorPresented,
    isReviewFilterMenuOpen,
    isSubmitting,
    selectedCard,
    setIsAnswerVisible,
  });

  async function handleReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<void> {
    setIsSubmitting(true);

    try {
      await handleReviewData(card, rating);
    } finally {
      setIsSubmitting(false);
    }
  }

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

  return (
    <main className="container">
      <section className="panel review-screen-panel">
        <div className="screen-head">
          <div>
            <h1 className="title">Review</h1>
            <p className="subtitle">Queue table plus a focused flip flow.</p>
            {reviewLoadErrorMessage !== "" ? <p className="error-banner">{reviewLoadErrorMessage}</p> : null}
            {reviewLoadErrorMessage !== "" && hasLoadedReviewData === false ? (
              <button className="primary-btn review-loading-retry-btn" type="button" onClick={() => void refreshLocalData()}>
                Retry
              </button>
            ) : null}
          </div>
          <div className="screen-actions review-screen-actions">
            <div className="review-filter-summary-wrap">
              <span className="review-filter-label">Queue</span>
              <span className="badge review-filter-summary">{formatQueueBadge(visibleReviewCounts.dueCount, visibleReviewCounts.totalCount)}</span>
            </div>
            <ReviewFilterMenu
              handleCloseMenu={handleCloseMenu}
              handleReviewFilterMenuToggle={handleReviewFilterMenuToggle}
              handleReviewFilterSelect={handleReviewFilterSelect}
              hasVisibleReviewFilterChoices={hasVisibleReviewFilterChoices}
              isReviewFilterMenuOpen={isReviewFilterMenuOpen}
              reviewDeckSearchInputRef={reviewDeckSearchInputRef}
              reviewDeckSearchText={reviewDeckSearchText}
              reviewFilterMenuItems={reviewFilterMenuItems}
              reviewFilterMenuWrapRef={reviewFilterMenuWrapRef}
              reviewFilterTriggerRef={reviewFilterTriggerRef}
              selectedReviewFilterTitle={visibleSelectedReviewFilterTitle}
              setReviewDeckSearchText={setReviewDeckSearchText}
              shouldShowReviewDeckSearch={shouldShowReviewDeckSearch}
              visibleReviewDeckFilterMenuItems={visibleReviewDeckFilterMenuItems}
              visibleReviewTagFilterMenuItems={visibleReviewTagFilterMenuItems}
            />
          </div>
        </div>

        <div className="review-layout">
          <section className="review-pane">
            {isInitialReviewLoad ? (
              <>
                <div className="review-pane-head">
                  <div className="review-pane-head-meta">
                    {loadingReviewCurrentCard !== null ? (
                      <>
                        <span className="badge">{loadingReviewCurrentCard.effortLevel}</span>
                        <span className="badge">{renderTags(loadingReviewCurrentCard.tags)}</span>
                      </>
                    ) : (
                      <>
                        <span className="badge review-loading-badge">Loading queue</span>
                        <span className="badge review-loading-badge">Preparing card</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="ghost-btn review-pane-edit-btn"
                    disabled
                  >
                    Edit
                  </button>
                </div>
                <div className="review-card-stack">
                  {loadingReviewCurrentCard !== null ? (
                    <ReviewCardSide
                      label="Front"
                      text={loadingReviewCurrentCard.frontText}
                      contentClassName="review-front"
                      surfaceClassName="review-card-surface review-card-surface-front"
                    />
                  ) : (
                    <div className="review-card-surface review-card-surface-front review-loading-card-surface" aria-hidden="true">
                      <div className="review-label">Front</div>
                      <div className="review-card-body">
                        <div className="review-loading-card-lines">
                          <span className="review-loading-line review-loading-line-title" />
                          <span className="review-loading-line" />
                          <span className="review-loading-line review-loading-line-short" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="review-card-surface review-card-answer review-loading-card-surface" aria-hidden="true">
                    <div className="review-label">Back</div>
                    <div className="review-card-body">
                      <div className="review-loading-card-lines">
                        <span className="review-loading-line" />
                        <span className="review-loading-line review-loading-line-short" />
                        <span className="review-loading-line review-loading-line-shorter" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="review-meta review-meta-loading">
                  <span>{reviewLoadingSnapshot === null ? "Loading review queue…" : "Showing a recent local snapshot…"}</span>
                </div>
                <div className="review-actions-dock">
                  <button
                    type="button"
                    className="primary-btn review-reveal-btn"
                    disabled
                  >
                    Reveal answer
                  </button>
                </div>
              </>
            ) : selectedCard === null ? (
              <div className="review-empty">
                <h2 className="panel-subtitle">{hasCards ? "Nothing Due" : "No Cards Yet"}</h2>
                <p className="subtitle">
                  {hasCards
                    ? "You're all caught up for now. Come back later or add more cards."
                    : "You haven't created any cards yet. Add your first card to start studying."}
                </p>
                <div className="review-empty-actions">
                  <Link className="primary-btn" to={`${cardsRoute}/new`}>
                    Create card
                  </Link>
                  <p className="review-empty-or">or</p>
                  <Link className="ghost-btn" to={chatRoute}>
                    Create with AI
                  </Link>
                  {shouldShowSwitchToAllCardsAction ? (
                    <>
                      <p className="review-empty-or">or</p>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => selectReviewFilter(ALL_CARDS_REVIEW_FILTER)}
                      >
                        switch to all cards deck
                      </button>
                    </>
                  ) : null}
                </div>
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
                    onClick={() => handleOpenEditor(selectedCard)}
                  >
                    Edit
                  </button>
                </div>
                <div className="review-card-stack">
                  <ReviewCardSide
                    label="Front"
                    text={selectedCard.frontText}
                    contentClassName="review-front"
                    surfaceClassName="review-card-surface review-card-surface-front"
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
              <h2 className="panel-subtitle">Queue</h2>
              <span className="review-queue-caption">
                {isInitialReviewLoad && reviewLoadingSnapshot === null ? "loading" : `${visibleQueueCardsCount} cards`}
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

      <ReviewEditorModal
        editingCard={editingCard}
        editorErrorMessage={editorErrorMessage}
        formState={editorFormState}
        isEditorPresented={isEditorPresented}
        isEditorSaving={isEditorSaving}
        onChange={setEditorFormState}
        onClose={() => setIsEditorPresented(false)}
        onDelete={handleEditorDelete}
        onSave={handleEditorSave}
        tagSuggestions={tagSuggestions}
      />
    </main>
  );
}
