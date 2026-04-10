import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAppData } from "../appData";
import { ALL_CARDS_REVIEW_FILTER, currentReviewCard, isCardDue } from "../appData/domain";
import { useI18n } from "../i18n";
import type { Card, WorkspaceSchedulerSettings } from "../types";
import { computeReviewSchedule, type ReviewRating } from "../../../backend/src/schedule";
import { classifyReviewContentPresentation } from "./reviewContentPresentation";
import { cardsRoute, chatRoute } from "../routes";
import { ReviewEditorModal } from "./ReviewEditorModal";
import { ReviewHardReminderDialog } from "./ReviewHardReminderDialog";
import { ReviewFilterMenu } from "./ReviewFilterMenu";
import { useAiCardHandoff } from "../chat/useAiCardHandoff";
import { useTransientMessage } from "../useTransientMessage";
import { formatQueueBadge, useReviewFilterMenu } from "./useReviewFilterMenu";
import {
  appendRecentReviewRatings,
  loadReviewHardReminderLastShownAt,
  saveReviewHardReminderLastShownAt,
  shouldShowReviewHardReminder,
} from "./reviewHardReminder";
import { useReviewCardEditor } from "./useReviewCardEditor";
import { useReviewKeyboardShortcuts } from "./useReviewKeyboardShortcuts";
import { useReviewScreenData } from "./useReviewScreenData";
import { makeReviewSpeakableText, type ReviewSpeechSide, useReviewSpeech } from "./reviewSpeech";
import { isCardFormStateDirty } from "./CardForm";
import { formatEffortLevelLabel, formatNullableDateTime, formatTagSummary } from "./featureFormatting";

type ReviewButtonOption = Readonly<{
  intervalDescription: string;
  rating: 0 | 1 | 2 | 3;
  testId: "again" | "good" | "hard" | "easy";
  title: string;
}>;

const REVIEW_BUTTONS_PER_COLUMN = 2;
const REVIEW_MARKDOWN_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN = /^(\s{0,3}[-*+]\s+)([+*\-#>])(\s*)$/;

type MarkdownFenceMarker = "`" | "~";

const reviewAnswerOptions: ReadonlyArray<ReviewRating> = [0, 2, 1, 3];

type ReviewCardSideProps = Readonly<{
  aiButtonAriaLabel: string | null;
  contentClassName: string;
  isSpeaking: boolean;
  label: string;
  onOpenAi: (() => void) | null;
  onToggleSpeech: () => void;
  showAiButton: boolean;
  showSpeechButton: boolean;
  speechButtonAriaLabel: string | null;
  surfaceCardId?: string;
  surfaceClassName?: string;
  surfaceFrontText?: string;
  surfaceTestId?: string;
  text: string;
}>;

function reviewRatingTitle(
  rating: ReviewRating,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (rating === 0) {
    return t("reviewScreen.ratings.again");
  }

  if (rating === 1) {
    return t("reviewScreen.ratings.hard");
  }

  if (rating === 2) {
    return t("reviewScreen.ratings.good");
  }

  return t("reviewScreen.ratings.easy");
}

function reviewRatingTestId(rating: ReviewRating): "again" | "good" | "hard" | "easy" {
  if (rating === 0) {
    return "again";
  }

  if (rating === 1) {
    return "hard";
  }

  if (rating === 2) {
    return "good";
  }

  return "easy";
}

function formatReviewIntervalDescription(
  now: Date,
  dueAt: Date,
  t: ReturnType<typeof useI18n>["t"],
  formatCount: ReturnType<typeof useI18n>["formatCount"],
): string {
  const durationMilliseconds = Math.max(dueAt.getTime() - now.getTime(), 0);
  const durationSeconds = Math.floor(durationMilliseconds / 1000);

  if (durationSeconds < 60) {
    return t("reviewScreen.interval.lessThanMinute");
  }

  const durationMinutes = Math.floor(durationSeconds / 60);
  if (durationMinutes < 60) {
    return t("reviewScreen.interval.inCount", {
      count: formatCount(durationMinutes, {
        one: t("common.countLabels.minute.one"),
        other: t("common.countLabels.minute.other"),
      }),
    });
  }

  const durationHours = Math.floor(durationMinutes / 60);
  if (durationHours < 24) {
    return t("reviewScreen.interval.inCount", {
      count: formatCount(durationHours, {
        one: t("common.countLabels.hour.one"),
        other: t("common.countLabels.hour.other"),
      }),
    });
  }

  const durationDays = Math.floor(durationHours / 24);
  return t("reviewScreen.interval.inCount", {
    count: formatCount(durationDays, {
      one: t("common.countLabels.day.one"),
      other: t("common.countLabels.day.other"),
    }),
  });
}

function buildReviewButtonOptions(
  card: Card,
  schedulerSettings: WorkspaceSchedulerSettings,
  now: Date,
  t: ReturnType<typeof useI18n>["t"],
  formatCount: ReturnType<typeof useI18n>["formatCount"],
): Array<ReviewButtonOption> {
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
      option,
      now,
    );

    return {
      title: reviewRatingTitle(option, t),
      rating: option,
      testId: reviewRatingTestId(option),
      intervalDescription: formatReviewIntervalDescription(now, schedule.dueAt, t, formatCount),
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
  const {
    aiButtonAriaLabel,
    contentClassName,
    isSpeaking,
    label,
    onOpenAi,
    onToggleSpeech,
    showAiButton,
    showSpeechButton,
    speechButtonAriaLabel,
    surfaceCardId,
    surfaceClassName,
    surfaceFrontText,
    surfaceTestId,
    text,
  } = props;
  const presentationMode = classifyReviewContentPresentation(text);

  return (
    <div
      className={surfaceClassName === undefined ? "review-card-surface" : surfaceClassName}
      data-testid={surfaceTestId}
      data-card-id={surfaceCardId}
      data-card-front-text={surfaceFrontText}
    >
      <div className="review-label">{label}</div>
      <div className="review-card-body">
        <div className="review-card-content-wrap">
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

        {showSpeechButton || showAiButton ? (
          <div className="review-card-actions">
            {showSpeechButton ? (
              <button
                type="button"
                className={`review-card-speech-btn${isSpeaking ? " review-card-speech-btn-active" : ""}`}
                onClick={onToggleSpeech}
                aria-label={speechButtonAriaLabel ?? label}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 14H2V10H5L10 6V18L5 14Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 9C15.333 10.2 15.333 13.8 14 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M17.5 6.5C20.5 9.4 20.5 14.6 17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
            {showAiButton && onOpenAi !== null ? (
              <button
                type="button"
                className="review-card-ai-btn"
                onClick={onOpenAi}
                aria-label={aiButtonAriaLabel ?? label}
              >
                AI
              </button>
            ) : null}
          </div>
        ) : null}
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
  const { t, formatCount, formatDateTime, formatNumber } = useI18n();
  const [isAnswerVisible, setIsAnswerVisible] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isHardReminderVisible, setIsHardReminderVisible] = useState<boolean>(false);
  const [hardReminderLastShownAt, setHardReminderLastShownAt] = useState<number | null>(() => loadReviewHardReminderLastShownAt());
  const recentReviewRatingsRef = useRef<Array<ReviewRating>>([]);
  const { message: reviewSpeechMessage, showMessage: showReviewSpeechMessage } = useTransientMessage(3000);
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
    activeSide: activeSpeechSide,
    stopSpeech,
    toggleSpeech,
  } = useReviewSpeech({
    showMessage: showReviewSpeechMessage,
    speechUnavailableMessage: t("reviewScreen.speechUnavailable"),
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
    visibleReviewEffortFilterMenuItems,
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
    handleEditorSaveForAiHandoff,
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
    t,
    updateCardItem,
  });
  const handoffCardToAi = useAiCardHandoff();
  const nowTimestamp = Date.now();
  const selectedCard = currentReviewCard(activeReviewQueue);
  const selectedFrontSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.frontText);
  const selectedBackSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.backText);
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
    stopSpeech();
  }, [selectedCard?.cardId, stopSpeech]);

  useEffect(() => {
    recentReviewRatingsRef.current = [];
    setIsHardReminderVisible(false);
  }, [activeWorkspace?.workspaceId]);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [stopSpeech]);

  useReviewKeyboardShortcuts({
    handleReview: async (card, rating) => {
      await handleReview(card, rating);
    },
    isAnswerVisible,
    isEditorPresented,
    isHardReminderVisible,
    isReviewFilterMenuOpen,
    isSubmitting,
    selectedCard,
    setIsAnswerVisible,
  });

  async function handleReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<void> {
    setIsSubmitting(true);

    try {
      const didSaveReview = await handleReviewData(card, rating);
      if (didSaveReview === false) {
        return;
      }

      const nextRecentReviewRatings = appendRecentReviewRatings(recentReviewRatingsRef.current, rating);
      recentReviewRatingsRef.current = nextRecentReviewRatings;
      if (rating !== 1) {
        return;
      }

      const nowMillis = Date.now();
      if (shouldShowReviewHardReminder(nextRecentReviewRatings, hardReminderLastShownAt, nowMillis)) {
        setHardReminderLastShownAt(nowMillis);
        saveReviewHardReminderLastShownAt(nowMillis);
        setIsHardReminderVisible(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isAnswerVisible && selectedCard !== null && workspaceSettings !== null) {
    try {
      reviewButtonOptions = buildReviewButtonOptions(selectedCard, workspaceSettings, reviewButtonsNow, t, formatCount);
    } catch (error) {
      reviewButtonErrorMessage = error instanceof Error ? error.message : String(error);
    }
  } else if (isAnswerVisible && selectedCard !== null) {
    reviewButtonErrorMessage = t("reviewScreen.errors.schedulerUnavailable");
  }

  const leftReviewButtonOptions = reviewButtonOptions.slice(0, REVIEW_BUTTONS_PER_COLUMN);
  const rightReviewButtonOptions = reviewButtonOptions.slice(REVIEW_BUTTONS_PER_COLUMN, REVIEW_BUTTONS_PER_COLUMN * 2);

  return (
    <main className="container" data-testid="review-screen">
      <section className="panel review-screen-panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{t("reviewScreen.title")}</h1>
            <p className="subtitle">{t("reviewScreen.subtitle")}</p>
            {reviewLoadErrorMessage !== "" ? <p className="error-banner">{reviewLoadErrorMessage}</p> : null}
            {reviewSpeechMessage !== "" ? <p className="review-transient-message" role="status">{reviewSpeechMessage}</p> : null}
            {reviewLoadErrorMessage !== "" && hasLoadedReviewData === false ? (
              <button className="primary-btn review-loading-retry-btn" type="button" onClick={() => void refreshLocalData()}>
                {t("reviewScreen.actions.retry")}
              </button>
            ) : null}
          </div>
          <div className="screen-actions review-screen-actions">
            <div className="review-filter-summary-wrap">
              <span className="review-filter-label">{t("reviewScreen.queue.title")}</span>
              <span className="badge review-filter-summary">{formatQueueBadge(visibleReviewCounts.dueCount, visibleReviewCounts.totalCount, formatNumber, t)}</span>
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
              visibleReviewEffortFilterMenuItems={visibleReviewEffortFilterMenuItems}
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
                        <span className="badge">{formatEffortLevelLabel(t, loadingReviewCurrentCard.effortLevel)}</span>
                        <span className="badge">{formatTagSummary(loadingReviewCurrentCard.tags)}</span>
                      </>
                    ) : (
                      <>
                        <span className="badge review-loading-badge">{t("reviewScreen.loading.queue")}</span>
                        <span className="badge review-loading-badge">{t("reviewScreen.loading.preparingCard")}</span>
                      </>
                    )}
                  </div>
                  <div className="review-pane-head-actions">
                    <button
                      type="button"
                      className="ghost-btn review-pane-edit-btn"
                      disabled
                    >
                      {t("reviewScreen.actions.edit")}
                    </button>
                  </div>
                </div>
                <div className="review-card-stack">
                  {loadingReviewCurrentCard !== null ? (
                    <ReviewCardSide
                      label={t("reviewScreen.sides.front")}
                      aiButtonAriaLabel={null}
                      text={loadingReviewCurrentCard.frontText}
                      contentClassName="review-front"
                      isSpeaking={false}
                      onOpenAi={null}
                      onToggleSpeech={() => undefined}
                      showAiButton={false}
                      showSpeechButton={false}
                      speechButtonAriaLabel={null}
                      surfaceCardId={loadingReviewCurrentCard.cardId}
                      surfaceClassName="review-card-surface review-card-surface-front"
                      surfaceFrontText={loadingReviewCurrentCard.frontText}
                      surfaceTestId="review-current-front-card"
                    />
                  ) : (
                    <div className="review-card-surface review-card-surface-front review-loading-card-surface" aria-hidden="true">
                      <div className="review-label">{t("reviewScreen.sides.front")}</div>
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
                    <div className="review-label">{t("reviewScreen.sides.back")}</div>
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
                  <span>{reviewLoadingSnapshot === null ? t("reviewScreen.loading.reviewQueue") : t("reviewScreen.loading.snapshot")}</span>
                </div>
                <div className="review-actions-dock">
                  <button
                    type="button"
                    className="primary-btn review-reveal-btn"
                    disabled
                    data-testid="review-reveal-answer"
                  >
                    {t("reviewScreen.actions.revealAnswer")}
                  </button>
                </div>
              </>
            ) : selectedCard === null ? (
              <div className="review-empty">
                <h2 className="panel-subtitle">{hasCards ? t("reviewScreen.empty.nothingDueTitle") : t("reviewScreen.empty.noCardsTitle")}</h2>
                <p className="subtitle">
                  {hasCards
                    ? t("reviewScreen.empty.nothingDueBody")
                    : t("reviewScreen.empty.noCardsBody")}
                </p>
                <div className="review-empty-actions">
                  <Link className="primary-btn" to={`${cardsRoute}/new`}>
                    {t("reviewScreen.actions.createCard")}
                  </Link>
                  <p className="review-empty-or">{t("reviewScreen.empty.or")}</p>
                  <Link className="ghost-btn" to={chatRoute}>
                    {t("reviewScreen.actions.createWithAi")}
                  </Link>
                  {shouldShowSwitchToAllCardsAction ? (
                    <>
                      <p className="review-empty-or">{t("reviewScreen.empty.or")}</p>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => selectReviewFilter(ALL_CARDS_REVIEW_FILTER)}
                      >
                        {t("reviewScreen.actions.switchToAllCards")}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="review-pane-head">
                  <div className="review-pane-head-meta">
                    <span className="badge">{formatEffortLevelLabel(t, selectedCard.effortLevel)}</span>
                    <span className="badge">{formatTagSummary(selectedCard.tags)}</span>
                  </div>
                  <div className="review-pane-head-actions">
                    <button
                      type="button"
                      className="ghost-btn review-pane-edit-btn"
                      onClick={() => handleOpenEditor(selectedCard)}
                    >
                      {t("reviewScreen.actions.edit")}
                    </button>
                  </div>
                </div>
                <div className="review-card-stack">
                  <ReviewCardSide
                    label={t("reviewScreen.sides.front")}
                    aiButtonAriaLabel={null}
                    text={selectedCard.frontText}
                    contentClassName="review-front"
                    isSpeaking={activeSpeechSide === "front"}
                    onOpenAi={null}
                    onToggleSpeech={() => toggleSpeech("front", selectedCard.frontText)}
                    showAiButton={false}
                    showSpeechButton={selectedFrontSpeakableText !== ""}
                    speechButtonAriaLabel={t(activeSpeechSide === "front" ? "reviewScreen.speakAriaLabel.stop" : "reviewScreen.speakAriaLabel.start", {
                      side: t("reviewScreen.sides.front").toLowerCase(),
                    })}
                    surfaceCardId={selectedCard.cardId}
                    surfaceClassName="review-card-surface review-card-surface-front"
                    surfaceFrontText={selectedCard.frontText}
                    surfaceTestId="review-current-front-card"
                  />

                  {isAnswerVisible ? (
                    <ReviewCardSide
                      label={t("reviewScreen.sides.back")}
                      aiButtonAriaLabel={t("reviewScreen.aiOpenAriaLabel", {
                        side: t("reviewScreen.sides.back").toLowerCase(),
                      })}
                      text={selectedCard.backText === "" ? t("common.noBackText") : selectedCard.backText}
                      contentClassName="review-back"
                      isSpeaking={activeSpeechSide === "back"}
                      onOpenAi={() => void handoffCardToAi(selectedCard)}
                      onToggleSpeech={() => toggleSpeech("back", selectedCard.backText)}
                      showAiButton={true}
                      showSpeechButton={selectedBackSpeakableText !== ""}
                      speechButtonAriaLabel={t(activeSpeechSide === "back" ? "reviewScreen.speakAriaLabel.stop" : "reviewScreen.speakAriaLabel.start", {
                        side: t("reviewScreen.sides.back").toLowerCase(),
                      })}
                      surfaceClassName="review-card-surface review-card-answer"
                    />
                  ) : null}
                </div>

                <div className="review-meta">
                  <span>{t("reviewScreen.meta.due", { value: formatNullableDateTime(selectedCard.dueAt, formatDateTime, t) })}</span>
                  <span>{t("reviewScreen.meta.reps", { count: formatNumber(selectedCard.reps) })}</span>
                  <span>{t("reviewScreen.meta.lapses", { count: formatNumber(selectedCard.lapses) })}</span>
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
                              data-testid={`review-rate-${option.testId}`}
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
                              data-testid={`review-rate-${option.testId}`}
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
                      data-testid="review-reveal-answer"
                    >
                      {t("reviewScreen.actions.revealAnswer")}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="review-queue-panel">
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
                      className={`review-queue-card${isDue ? "" : " review-queue-card-upcoming"}${selectedCard?.cardId === card.cardId ? " review-queue-card-active" : ""}`}
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
        </div>
      </section>

      <ReviewEditorModal
        editingCard={editingCard}
        editorErrorMessage={editorErrorMessage}
        formState={editorFormState}
        isEditorPresented={isEditorPresented}
        isEditorSaving={isEditorSaving}
        onEditWithAi={async () => {
          if (editingCard === null) {
            return;
          }

          const cardForHandoff = isCardFormStateDirty(editingCard, editorFormState)
            ? await handleEditorSaveForAiHandoff()
            : editingCard;
          if (cardForHandoff === null) {
            return;
          }

          const didHandoff = await handoffCardToAi(cardForHandoff);
          if (didHandoff) {
            setIsEditorPresented(false);
          }
        }}
        onChange={setEditorFormState}
        onClose={() => setIsEditorPresented(false)}
        onDelete={handleEditorDelete}
        onSave={handleEditorSave}
        tagSuggestions={tagSuggestions}
      />

      <ReviewHardReminderDialog
        isOpen={isHardReminderVisible}
        onDismiss={() => {
          setIsHardReminderVisible(false);
        }}
      />
    </main>
  );
}
