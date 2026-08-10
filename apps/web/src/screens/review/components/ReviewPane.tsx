import { useLayoutEffect, useRef, type ReactElement } from "react";
import { Link } from "react-router";
import type { ReviewRating } from "../../../../../backend/src/scheduling";
import { useI18n } from "../../../i18n";
import { cardsRoute, chatRoute } from "../../../routes";
import type { Card } from "../../../types";
import type { ReviewLoadingSnapshot } from "../../shared/loadingSnapshots";
import { formatTagSummary } from "../../shared/featureFormatting";
import { ReviewCardSide, ReviewCardSpeechButton, ReviewEditIcon } from "./card/ReviewCardSide";
import type { ReviewButtonOption } from "./reviewRatingOptions";
import type { ReviewSpeechSide } from "../speech/reviewSpeech";
import {
  formatReviewSubmitRating,
  resolveReviewPaneEmptyReason,
  resolveReviewPaneState,
  type LastSubmittedReview,
  type ReviewSubmitState,
} from "./reviewScreenTypes";

const REVIEW_BUTTONS_PER_COLUMN = 2;
const REVIEW_SCROLL_INTO_VIEW_OPTIONS = {
  behavior: "instant",
  block: "start",
  container: "nearest",
  inline: "nearest",
} as const satisfies ScrollIntoViewOptions & { container: "nearest" };

export type ReviewPaneProps = Readonly<{
  activeSpeechSide: ReviewSpeechSide | null;
  hasCards: boolean;
  isAnswerVisible: boolean;
  isInitialReviewLoad: boolean;
  isSubmitting: boolean;
  lastSubmittedReview: LastSubmittedReview | null;
  localReadVersion: number;
  loadingReviewCurrentCard: ReviewLoadingSnapshot["currentCard"];
  onAiHandoff: (card: Card) => Promise<boolean>;
  onEditCard: (card: Card) => void;
  onRevealAnswer: () => void;
  onReview: (card: Card, rating: ReviewRating) => Promise<void>;
  onSwitchToAllCards: () => void;
  onToggleSpeech: (side: ReviewSpeechSide, sourceText: string) => void;
  reviewButtonErrorMessage: string;
  reviewButtonOptions: ReadonlyArray<ReviewButtonOption>;
  reviewLoadingSnapshot: ReviewLoadingSnapshot | null;
  reviewSubmitState: ReviewSubmitState;
  selectedBackSpeakableText: string;
  selectedCard: Card | null;
  selectedFrontSpeakableText: string;
  shouldShowSwitchToAllCardsAction: boolean;
  workspaceId: string | null;
}>;

type ReviewLoadingPaneProps = Readonly<{
  localReadVersion: number;
  loadingReviewCurrentCard: ReviewLoadingSnapshot["currentCard"];
  reviewLoadingSnapshot: ReviewLoadingSnapshot | null;
  workspaceId: string | null;
}>;

type ReviewEmptyPaneProps = Readonly<{
  hasCards: boolean;
  onSwitchToAllCards: () => void;
  shouldShowSwitchToAllCardsAction: boolean;
}>;

type ReviewActiveCardPaneProps = Readonly<{
  activeSpeechSide: ReviewSpeechSide | null;
  isAnswerVisible: boolean;
  isSubmitting: boolean;
  localReadVersion: number;
  onAiHandoff: (card: Card) => Promise<boolean>;
  onEditCard: (card: Card) => void;
  onRevealAnswer: () => void;
  onReview: (card: Card, rating: ReviewRating) => Promise<void>;
  onToggleSpeech: (side: ReviewSpeechSide, sourceText: string) => void;
  reviewButtonErrorMessage: string;
  reviewButtonOptions: ReadonlyArray<ReviewButtonOption>;
  selectedBackSpeakableText: string;
  selectedCard: Card;
  selectedFrontSpeakableText: string;
  workspaceId: string | null;
}>;

type ReviewRatingButtonColumnProps = Readonly<{
  isSubmitting: boolean;
  onReview: (rating: ReviewRating) => void;
  options: ReadonlyArray<ReviewButtonOption>;
}>;

function handleDisabledSpeechToggle(): void {
}

function ReviewRepetitionIcon(): ReactElement {
  return (
    <svg className="review-repetition-badge-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M21 12A9 9 0 1 1 18.36 5.64L21 8M21 3V8H16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReviewLoadingPane(props: ReviewLoadingPaneProps): ReactElement {
  const {
    localReadVersion,
    loadingReviewCurrentCard,
    reviewLoadingSnapshot,
    workspaceId,
  } = props;
  const { t } = useI18n();
  const frontSideLabel = t("reviewScreen.sides.front");
  const frontSpeechButtonAriaLabel = t("reviewScreen.speakAriaLabel.start", {
    side: frontSideLabel.toLowerCase(),
  });

  return (
    <>
      <div className="review-pane-head">
        <div className="review-pane-head-meta">
          {loadingReviewCurrentCard !== null ? (
            <>
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
            aria-label={t("reviewScreen.actions.edit")}
            title={t("reviewScreen.actions.edit")}
            disabled
          >
            <ReviewEditIcon />
          </button>
        </div>
      </div>
      <div className="review-card-stack">
        {loadingReviewCurrentCard !== null ? (
          <ReviewCardSide
            label={frontSideLabel}
            aiButtonAriaLabel={null}
            text={loadingReviewCurrentCard.frontText}
            contentClassName="review-front"
            isSpeaking={false}
            onOpenAi={null}
            onToggleSpeech={handleDisabledSpeechToggle}
            showAiButton={false}
            showSpeechButton={true}
            speechButtonAriaLabel={frontSpeechButtonAriaLabel}
            speechButtonDisabled={true}
            localReadVersion={localReadVersion}
            surfaceCardId={loadingReviewCurrentCard.cardId}
            surfaceClassName="review-card-surface review-card-surface-front"
            surfaceFrontText={loadingReviewCurrentCard.frontText}
            surfaceTestId="review-current-front-card"
            workspaceId={workspaceId}
          />
        ) : (
          <div className="review-card-surface review-card-surface-front review-loading-card-surface" aria-hidden="true">
            <div className="review-label">{frontSideLabel}</div>
            <div className="review-card-body">
              <div className="review-loading-card-lines">
                <span className="review-loading-line review-loading-line-title" />
                <span className="review-loading-line" />
                <span className="review-loading-line review-loading-line-short" />
              </div>
              <div className="review-card-actions">
                <ReviewCardSpeechButton
                  ariaLabel={frontSpeechButtonAriaLabel}
                  disabled={true}
                  isSpeaking={false}
                  onToggleSpeech={handleDisabledSpeechToggle}
                />
              </div>
            </div>
          </div>
        )}
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
  );
}

function ReviewEmptyPane(props: ReviewEmptyPaneProps): ReactElement {
  const { hasCards, onSwitchToAllCards, shouldShowSwitchToAllCardsAction } = props;
  const { t } = useI18n();

  return (
    <div className="review-empty">
      <h2 className="panel-subtitle">{hasCards ? t("reviewScreen.empty.nothingDueTitle") : t("reviewScreen.empty.noCardsTitle")}</h2>
      <p className="subtitle">
        {hasCards
          ? t("reviewScreen.empty.nothingDueBody")
          : t("reviewScreen.empty.noCardsBody")}
      </p>
      <div className="review-empty-actions">
        <Link className="ghost-btn" to={`${cardsRoute}/new`}>
          {t("reviewScreen.actions.createCard")}
        </Link>
        <p className="review-empty-or">{t("reviewScreen.empty.or")}</p>
        <Link className="primary-btn" to={chatRoute}>
          {t("reviewScreen.actions.createWithAi")}
        </Link>
        {shouldShowSwitchToAllCardsAction ? (
          <>
            <p className="review-empty-or">{t("reviewScreen.empty.or")}</p>
            <button
              type="button"
              className="ghost-btn"
              onClick={onSwitchToAllCards}
            >
              {t("reviewScreen.actions.switchToAllCards")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ReviewRatingButtonColumn(props: ReviewRatingButtonColumnProps): ReactElement {
  const { isSubmitting, onReview, options } = props;

  return (
    <div className="rating-bar-column">
      {options.map((option) => (
        <button
          key={option.rating}
          type="button"
          className="rating-btn"
          disabled={isSubmitting}
          onClick={() => onReview(option.rating)}
          data-testid={`review-rate-${option.testId}`}
        >
          <span className="rating-btn-title">{option.title}</span>
          <span className="rating-btn-subtitle">{option.intervalDescription}</span>
        </button>
      ))}
    </div>
  );
}

function ReviewActiveCardPane(props: ReviewActiveCardPaneProps): ReactElement {
  const {
    activeSpeechSide,
    isAnswerVisible,
    isSubmitting,
    localReadVersion,
    onAiHandoff,
    onEditCard,
    onRevealAnswer,
    onReview,
    onToggleSpeech,
    reviewButtonErrorMessage,
    reviewButtonOptions,
    selectedBackSpeakableText,
    selectedCard,
    selectedFrontSpeakableText,
    workspaceId,
  } = props;
  const { t, formatNumber } = useI18n();
  const frontSideLabel = t("reviewScreen.sides.front");
  const backSideLabel = t("reviewScreen.sides.back");
  const repetitionValue = selectedCard.reps === 0 ? t("reviewScreen.repetitionBadgeNew") : formatNumber(selectedCard.reps);
  const leftReviewButtonOptions = reviewButtonOptions.slice(0, REVIEW_BUTTONS_PER_COLUMN);
  const rightReviewButtonOptions = reviewButtonOptions.slice(REVIEW_BUTTONS_PER_COLUMN, REVIEW_BUTTONS_PER_COLUMN * 2);
  const frontTargetRef = useRef<HTMLDivElement>(null);
  const backTargetRef = useRef<HTMLDivElement>(null);
  const previousCardIdRef = useRef<string | null>(null);
  const wasAnswerVisibleRef = useRef(false);

  useLayoutEffect(() => {
    const didCardChange = previousCardIdRef.current !== selectedCard.cardId;
    const didRevealAnswer = !didCardChange && !wasAnswerVisibleRef.current && isAnswerVisible;

    previousCardIdRef.current = selectedCard.cardId;
    wasAnswerVisibleRef.current = isAnswerVisible;

    if (didCardChange) {
      frontTargetRef.current?.scrollIntoView(REVIEW_SCROLL_INTO_VIEW_OPTIONS);
      return;
    }

    if (didRevealAnswer) {
      backTargetRef.current?.scrollIntoView(REVIEW_SCROLL_INTO_VIEW_OPTIONS);
    }
  }, [isAnswerVisible, selectedCard.cardId]);

  return (
    <>
      <div className="review-pane-head">
        <div className="review-pane-head-meta">
          <span className="badge review-pane-tag-badge">{formatTagSummary(selectedCard.tags)}</span>
          <span className={`badge review-repetition-badge${selectedCard.reps === 0 ? " review-repetition-badge-new" : ""}`}>
            <ReviewRepetitionIcon />
            <span aria-hidden="true">{repetitionValue}</span>
            <span className="review-repetition-badge-accessible-label">
              {t("reviewScreen.repetitionBadgeAriaLabel", { value: repetitionValue })}
            </span>
          </span>
        </div>
        <div className="review-pane-head-actions">
          <button
            type="button"
            className="ghost-btn review-pane-edit-btn"
            aria-label={t("reviewScreen.actions.edit")}
            title={t("reviewScreen.actions.edit")}
            onClick={() => onEditCard(selectedCard)}
          >
            <ReviewEditIcon />
          </button>
        </div>
      </div>
      <div className="review-card-stack">
        <div className="review-card-scroll-target" ref={frontTargetRef}>
          <ReviewCardSide
            label={frontSideLabel}
            aiButtonAriaLabel={null}
            text={selectedCard.frontText}
            contentClassName="review-front"
            isSpeaking={activeSpeechSide === "front"}
            onOpenAi={null}
            onToggleSpeech={() => onToggleSpeech("front", selectedCard.frontText)}
            showAiButton={false}
            showSpeechButton={selectedFrontSpeakableText !== ""}
            speechButtonAriaLabel={t(activeSpeechSide === "front" ? "reviewScreen.speakAriaLabel.stop" : "reviewScreen.speakAriaLabel.start", {
              side: frontSideLabel.toLowerCase(),
            })}
            speechButtonDisabled={false}
            localReadVersion={localReadVersion}
            surfaceCardId={selectedCard.cardId}
            surfaceClassName="review-card-surface review-card-surface-front"
            surfaceFrontText={selectedCard.frontText}
            surfaceTestId="review-current-front-card"
            workspaceId={workspaceId}
          />
        </div>

        {isAnswerVisible ? (
          <div className="review-card-scroll-target" ref={backTargetRef}>
            <ReviewCardSide
              label={backSideLabel}
              aiButtonAriaLabel={t("reviewScreen.aiOpenAriaLabel", {
                side: backSideLabel.toLowerCase(),
              })}
              text={selectedCard.backText === "" ? t("common.noBackText") : selectedCard.backText}
              contentClassName="review-back"
              isSpeaking={activeSpeechSide === "back"}
              onOpenAi={() => void onAiHandoff(selectedCard)}
              onToggleSpeech={() => onToggleSpeech("back", selectedCard.backText)}
              showAiButton={true}
              showSpeechButton={selectedBackSpeakableText !== ""}
              speechButtonAriaLabel={t(activeSpeechSide === "back" ? "reviewScreen.speakAriaLabel.stop" : "reviewScreen.speakAriaLabel.start", {
                side: backSideLabel.toLowerCase(),
              })}
              speechButtonDisabled={false}
              localReadVersion={localReadVersion}
              surfaceClassName="review-card-surface review-card-answer"
              workspaceId={workspaceId}
            />
          </div>
        ) : null}
      </div>

      <div className="review-actions-dock">
        {isAnswerVisible ? (
          reviewButtonErrorMessage !== "" ? (
            <p className="error-banner">{reviewButtonErrorMessage}</p>
          ) : (
            <div className="rating-bar">
              <ReviewRatingButtonColumn
                isSubmitting={isSubmitting}
                onReview={(rating) => {
                  void onReview(selectedCard, rating);
                }}
                options={leftReviewButtonOptions}
              />
              <ReviewRatingButtonColumn
                isSubmitting={isSubmitting}
                onReview={(rating) => {
                  void onReview(selectedCard, rating);
                }}
                options={rightReviewButtonOptions}
              />
            </div>
          )
        ) : (
          <button
            type="button"
            className="primary-btn review-reveal-btn"
            onClick={onRevealAnswer}
            data-testid="review-reveal-answer"
          >
            {t("reviewScreen.actions.revealAnswer")}
          </button>
        )}
      </div>
    </>
  );
}

export function ReviewPane(props: ReviewPaneProps): ReactElement {
  const {
    activeSpeechSide,
    hasCards,
    isAnswerVisible,
    isInitialReviewLoad,
    isSubmitting,
    lastSubmittedReview,
    localReadVersion,
    loadingReviewCurrentCard,
    onAiHandoff,
    onEditCard,
    onRevealAnswer,
    onReview,
    onSwitchToAllCards,
    onToggleSpeech,
    reviewButtonErrorMessage,
    reviewButtonOptions,
    reviewLoadingSnapshot,
    reviewSubmitState,
    selectedBackSpeakableText,
    selectedCard,
    selectedFrontSpeakableText,
    shouldShowSwitchToAllCardsAction,
    workspaceId,
  } = props;
  const reviewPaneState = resolveReviewPaneState(isInitialReviewLoad, selectedCard);
  const reviewPaneEmptyReason = resolveReviewPaneEmptyReason(isInitialReviewLoad, selectedCard, hasCards);

  return (
    <section
      className="review-pane"
      data-testid="review-pane"
      data-review-pane-state={reviewPaneState}
      data-review-pane-empty-reason={reviewPaneEmptyReason}
      data-review-current-card-id={selectedCard?.cardId ?? ""}
      data-review-submit-state={reviewSubmitState}
      data-review-last-submitted-card-id={lastSubmittedReview?.cardId ?? ""}
      data-review-last-submitted-rating={formatReviewSubmitRating(lastSubmittedReview)}
    >
      {reviewPaneState === "loading" ? (
        <ReviewLoadingPane
          localReadVersion={localReadVersion}
          loadingReviewCurrentCard={loadingReviewCurrentCard}
          reviewLoadingSnapshot={reviewLoadingSnapshot}
          workspaceId={workspaceId}
        />
      ) : null}
      {reviewPaneState === "empty" ? (
        <ReviewEmptyPane
          hasCards={hasCards}
          onSwitchToAllCards={onSwitchToAllCards}
          shouldShowSwitchToAllCardsAction={shouldShowSwitchToAllCardsAction}
        />
      ) : null}
      {reviewPaneState === "card" && selectedCard !== null ? (
        <ReviewActiveCardPane
          activeSpeechSide={activeSpeechSide}
          isAnswerVisible={isAnswerVisible}
          isSubmitting={isSubmitting}
          localReadVersion={localReadVersion}
          onAiHandoff={onAiHandoff}
          onEditCard={onEditCard}
          onRevealAnswer={onRevealAnswer}
          onReview={onReview}
          onToggleSpeech={onToggleSpeech}
          reviewButtonErrorMessage={reviewButtonErrorMessage}
          reviewButtonOptions={reviewButtonOptions}
          selectedBackSpeakableText={selectedBackSpeakableText}
          selectedCard={selectedCard}
          selectedFrontSpeakableText={selectedFrontSpeakableText}
          workspaceId={workspaceId}
        />
      ) : null}
    </section>
  );
}
