import { useEffect, useRef, type ReactElement, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAppData } from "../appData";
import {
  ALL_CARDS_REVIEW_FILTER,
  currentReviewCard,
  isCardDue,
} from "../appData/domain";
import { CardFormFields, toCardFormState, type CardFormState } from "./CardForm";
import {
  loadDecksListSnapshot,
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
  loadWorkspaceTagsSummary,
} from "../syncStorage";
import type { Card, DeckSummary, ReviewCounts, ReviewFilter, WorkspaceSchedulerSettings, WorkspaceTagSummary, TagSuggestion } from "../types";
import {
  computeReviewSchedule,
  type ReviewRating,
} from "../../../backend/src/schedule";
import {
  classifyReviewContentPresentation,
  type ReviewContentPresentationMode,
} from "./reviewContentPresentation";
import { cardsRoute, chatRoute, settingsDecksRoute } from "../routes";

type ReviewButtonOption = Readonly<{
  title: string;
  rating: 0 | 1 | 2 | 3;
  intervalDescription: string;
}>;

const EMPTY_BACK_TEXT_PLACEHOLDER = "No back text";
const REVIEW_BUTTONS_PER_COLUMN = 2;
const REVIEW_FILTER_DECK_PREFIX = "deck:";
const REVIEW_FILTER_TAG_PREFIX = "tag:";
const REVIEW_MARKDOWN_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN = /^(\s{0,3}[-*+]\s+)([+*\-#>])(\s*)$/;

type MarkdownFenceMarker = "`" | "~";

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
  decks: ReadonlyArray<DeckSummary>,
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
  const [isEditorPresented, setIsEditorPresented] = useState<boolean>(false);
  const [editingCardId, setEditingCardId] = useState<string>("");
  const [editorFormState, setEditorFormState] = useState<CardFormState>(toCardFormState(null));
  const [editorErrorMessage, setEditorErrorMessage] = useState<string>("");
  const [isEditorSaving, setIsEditorSaving] = useState<boolean>(false);
  const [isReviewFilterMenuOpen, setIsReviewFilterMenuOpen] = useState<boolean>(false);
  const [selectedReviewFilterTitle, setSelectedReviewFilterTitle] = useState<string>("All cards");
  const [activeReviewQueue, setActiveReviewQueue] = useState<ReadonlyArray<Card>>([]);
  const [queueCards, setQueueCards] = useState<ReadonlyArray<Card>>([]);
  const [reviewCounts, setReviewCounts] = useState<ReviewCounts>({
    dueCount: 0,
    totalCount: 0,
  });
  const [reviewQueueCursor, setReviewQueueCursor] = useState<string | null>(null);
  const [reviewTagSummaries, setReviewTagSummaries] = useState<ReadonlyArray<WorkspaceTagSummary>>([]);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [deckSummaries, setDeckSummaries] = useState<ReadonlyArray<DeckSummary>>([]);
  const [resolvedReviewFilter, setResolvedReviewFilter] = useState<ReviewFilter>(ALL_CARDS_REVIEW_FILTER);
  const [isReviewLoading, setIsReviewLoading] = useState<boolean>(true);
  const [reviewLoadErrorMessage, setReviewLoadErrorMessage] = useState<string>("");
  const reviewFilterMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const reviewFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const nowTimestamp = Date.now();
  const selectedCard = currentReviewCard(activeReviewQueue);
  const editingCard = queueCards.find((card) => card.cardId === editingCardId) ?? selectedCard ?? null;
  const reviewFilterMenuItems = buildReviewFilterMenuItems(deckSummaries, reviewTagSummaries, resolvedReviewFilter);
  const shouldShowSwitchToAllCardsAction = resolvedReviewFilter.kind !== "allCards";
  const hasCards = localCardCount > 0;
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
    let isCancelled = false;

    async function loadReviewData(): Promise<void> {
      setIsReviewLoading(true);
      setReviewLoadErrorMessage("");

      try {
        const [
          reviewQueueSnapshot,
          reviewTimelinePage,
          tagsSummary,
          decksSnapshot,
        ] = await Promise.all([
          loadReviewQueueSnapshot(selectedReviewFilter, 8),
          loadReviewTimelinePage(selectedReviewFilter, 200, 0),
          loadWorkspaceTagsSummary(),
          loadDecksListSnapshot(),
        ]);
        if (isCancelled) {
          return;
        }

        const nextResolvedReviewFilter = reviewQueueSnapshot.resolvedReviewFilter;
        const nextReviewFilterTitle = nextResolvedReviewFilter.kind === "allCards"
          ? "All cards"
          : nextResolvedReviewFilter.kind === "tag"
            ? nextResolvedReviewFilter.tag
            : decksSnapshot.deckSummaries.find((deck) => deck.deckId === nextResolvedReviewFilter.deckId)?.name ?? "All cards";

        setResolvedReviewFilter(nextResolvedReviewFilter);
        setSelectedReviewFilterTitle(nextReviewFilterTitle);
        setActiveReviewQueue(reviewQueueSnapshot.cards);
        setReviewCounts(reviewQueueSnapshot.reviewCounts);
        setReviewQueueCursor(reviewQueueSnapshot.nextCursor);
        setQueueCards(reviewTimelinePage.cards);
        setReviewTagSummaries(tagsSummary.tags);
        setTagSuggestions(tagsSummary.tags.map((tagSummary) => ({
          tag: tagSummary.tag,
          countState: "ready",
          cardsCount: tagSummary.cardsCount,
        })));
        setDeckSummaries(decksSnapshot.deckSummaries);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setReviewLoadErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled) {
          setIsReviewLoading(false);
        }
      }
    }

    void loadReviewData();

    return () => {
      isCancelled = true;
    };
  }, [localReadVersion, selectedReviewFilter]);

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
      const nextReviewQueue = activeReviewQueue.filter((queuedCard) => queuedCard.cardId !== card.cardId);
      setActiveReviewQueue(nextReviewQueue);
      setQueueCards((currentCards) => currentCards.filter((queuedCard) => queuedCard.cardId !== card.cardId));
      setReviewCounts((currentCounts) => ({
        dueCount: Math.max(0, currentCounts.dueCount - 1),
        totalCount: Math.max(0, currentCounts.totalCount - 1),
      }));

      if (nextReviewQueue.length <= 4 && reviewQueueCursor !== null) {
        const nextChunk = await loadReviewQueueChunk(
          resolvedReviewFilter,
          reviewQueueCursor,
          8 - nextReviewQueue.length,
          new Set(nextReviewQueue.map((queuedCard) => queuedCard.cardId)),
        );
        setActiveReviewQueue([...nextReviewQueue, ...nextChunk.cards]);
        setReviewQueueCursor(nextChunk.nextCursor);
      }
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

  if (isReviewLoading) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Review</h1>
          <p className="subtitle">Loading review queue…</p>
        </section>
      </main>
    );
  }

  if (reviewLoadErrorMessage !== "") {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Review</h1>
          <p className="error-banner">{reviewLoadErrorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel">
        <div className="screen-head">
          <div>
            <h1 className="title">Review</h1>
            <p className="subtitle">Queue table plus a focused flip flow.</p>
          </div>
          <div className="screen-actions review-screen-actions">
            <div className="review-filter-summary-wrap">
              <span className="review-filter-label">Queue</span>
              <span className="badge review-filter-summary">{formatQueueBadge(reviewCounts.dueCount, reviewCounts.totalCount)}</span>
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
              tagSuggestions={tagSuggestions}
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
