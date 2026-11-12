import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { FirstReviewOnboardingOverlay } from "../onboarding/FirstReviewOnboardingOverlay";
import { Link } from "react-router";
import type { ReviewRating } from "../../../../../backend/src/scheduling";
import { track } from "../../../analytics";
import { useI18n } from "../../../i18n";
import {
  discardReviewNextCardVisibleSpan,
  finishReviewNextCardVisibleSpan,
} from "../../../observability/reviewTimingSpans";
import { cardsRoute, chatRoute } from "../../../routes";
import { useWorkspacePath } from "../../../useWorkspacePath";
import type { Card } from "../../../types";
import type { ReviewLoadingSnapshot } from "../../shared/loadingSnapshots";
import type { ReviewCardCopyButtonHandle } from "./card/ReviewCardCopyButton";
import {
  ReviewCardEditButton,
  ReviewCardSide,
  ReviewCardSpeechButton,
  type ReviewCardShortcutTarget,
} from "./card/ReviewCardSide";
import { ReviewCardHeadTags, ReviewCardTagsLink } from "./ReviewCardHeadTags";
import { ReviewShortcutHint } from "./ReviewShortcutHint";
import { ReviewEyeIcon, ReviewRatingIcon } from "./ReviewIcons";
import { reviewRatingShortcutKeys } from "../input/reviewShortcutKeys";
import type { ReviewShortcutPointerEnterHandler } from "../input/useReviewKeyboardShortcuts";
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
const REVIEW_REVEAL_SHORTCUT_ARIA_KEYS = "Space Enter";
const REVIEW_SCROLL_INTO_VIEW_OPTIONS = {
  behavior: "instant",
  block: "start",
  container: "nearest",
  inline: "nearest",
} as const satisfies ScrollIntoViewOptions & { container: "nearest" };

export type ReviewPaneProps = Readonly<{
  showFirstReviewOnboarding: boolean;
  activeSideCopyButtonRef: RefObject<ReviewCardCopyButtonHandle | null>;
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
  onRequestTagFilter: (tag: string) => void;
  onRequestTextSelection: (side: ReviewSpeechSide) => void;
  onRevealAnswer: () => void;
  onReview: (card: Card, rating: ReviewRating) => Promise<void>;
  onShortcutButtonPointerEnter: ReviewShortcutPointerEnterHandler;
  onSwitchToAllCards: () => void;
  onToggleSpeech: (side: ReviewSpeechSide, sourceText: string) => void;
  reviewButtonErrorMessage: string;
  reviewButtonOptions: ReadonlyArray<ReviewButtonOption>;
  reviewLoadingSnapshot: ReviewLoadingSnapshot | null;
  reviewRatingErrorMessage: string;
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
  onRequestTagFilter: (tag: string) => void;
  onRequestTextSelection: (side: ReviewSpeechSide) => void;
  reviewLoadingSnapshot: ReviewLoadingSnapshot | null;
  workspaceId: string | null;
}>;

type ReviewEmptyPaneProps = Readonly<{
  hasCards: boolean;
  onSwitchToAllCards: () => void;
  shouldShowSwitchToAllCardsAction: boolean;
}>;

type ReviewActiveCardPaneProps = Readonly<{
  showFirstReviewOnboarding: boolean;
  surfaceRef: RefObject<HTMLElement | null>;
  activeSideCopyButtonRef: RefObject<ReviewCardCopyButtonHandle | null>;
  activeSpeechSide: ReviewSpeechSide | null;
  isAnswerVisible: boolean;
  isSubmitting: boolean;
  localReadVersion: number;
  onAiHandoff: (card: Card) => Promise<boolean>;
  onEditCard: (card: Card) => void;
  onRequestTagFilter: (tag: string) => void;
  onRequestTextSelection: (side: ReviewSpeechSide) => void;
  onRevealAnswer: () => void;
  onReview: (card: Card, rating: ReviewRating) => Promise<void>;
  onShortcutButtonPointerEnter: ReviewShortcutPointerEnterHandler;
  onToggleSpeech: (side: ReviewSpeechSide, sourceText: string) => void;
  reviewButtonErrorMessage: string;
  reviewButtonOptions: ReadonlyArray<ReviewButtonOption>;
  reviewRatingErrorMessage: string;
  selectedBackSpeakableText: string;
  selectedCard: Card;
  selectedFrontSpeakableText: string;
  workspaceId: string | null;
}>;

type ReviewRatingButtonColumnProps = Readonly<{
  onAgainButton: (button: HTMLButtonElement | null) => void;
  isSubmitting: boolean;
  onReview: (rating: ReviewRating) => void;
  onShortcutButtonPointerEnter: ReviewShortcutPointerEnterHandler;
  options: ReadonlyArray<ReviewButtonOption>;
}>;

function handleDisabledAction(): void {
}

function ReviewLoadingPane(props: ReviewLoadingPaneProps): ReactElement {
  const {
    localReadVersion,
    loadingReviewCurrentCard,
    onRequestTagFilter,
    onRequestTextSelection,
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
        {loadingReviewCurrentCard !== null ? (
          <ReviewCardHeadTags
            key={loadingReviewCurrentCard.cardId}
            onRequestTagFilter={onRequestTagFilter}
            tags={loadingReviewCurrentCard.tags}
          />
        ) : (
          <>
            <ReviewCardTagsLink />
            <div className="review-pane-head-meta">
              <span className="badge review-loading-badge">{t("reviewScreen.loading.queue")}</span>
              <span className="badge review-loading-badge">{t("reviewScreen.loading.preparingCard")}</span>
            </div>
          </>
        )}
      </div>
      <div className="review-card-stack">
        {loadingReviewCurrentCard !== null ? (
          <ReviewCardSide
            label={frontSideLabel}
            aiButtonAriaLabel={null}
            text={loadingReviewCurrentCard.frontText}
            contentClassName="review-front"
            copySource={null}
            isSpeaking={false}
            edit={{ disabled: true, onEdit: handleDisabledAction, testId: "review-edit-front" }}
            onOpenAi={null}
            onOpenTextSelection={() => onRequestTextSelection("front")}
            onToggleSpeech={handleDisabledAction}
            repetitionCount={null}
            shortcutTarget={null}
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
                  isShortcutTarget={false}
                  isSpeaking={false}
                  onToggleSpeech={handleDisabledAction}
                />
                <ReviewCardEditButton disabled={true} onEdit={handleDisabledAction} testId="review-edit-front" />
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
          <span className="review-reveal-btn-content">
            <ReviewEyeIcon />
            <span>{t("reviewScreen.actions.revealAnswer")}</span>
          </span>
        </button>
      </div>
    </>
  );
}

function ReviewEmptyPane(props: ReviewEmptyPaneProps): ReactElement {
  const { hasCards, onSwitchToAllCards, shouldShowSwitchToAllCardsAction } = props;
  const { t } = useI18n();
  const workspacePath = useWorkspacePath();

  return (
    <div className="review-empty">
      <h2 className="panel-subtitle">{hasCards ? t("reviewScreen.empty.nothingDueTitle") : t("reviewScreen.empty.noCardsTitle")}</h2>
      <p className="subtitle">
        {hasCards
          ? t("reviewScreen.empty.nothingDueBody")
          : t("reviewScreen.empty.noCardsBody")}
      </p>
      <div className="review-empty-actions">
        <Link
          className="ghost-btn"
          to={workspacePath(`${cardsRoute}/new`)}
          onClick={() => track({ name: "card_create_started", entryPoint: "review" })}
        >
          {t("reviewScreen.actions.createCard")}
        </Link>
        <p className="review-empty-or">{t("reviewScreen.empty.or")}</p>
        <Link className="primary-btn" to={workspacePath(chatRoute)}>
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
  const { isSubmitting, onReview, onShortcutButtonPointerEnter, options, onAgainButton } = props;

  return (
    <div className="rating-bar-column">
      {options.map((option) => (
        <button
          key={option.rating}
          ref={option.rating === 0 ? onAgainButton : undefined}
          type="button"
          className="rating-btn"
          aria-keyshortcuts={reviewRatingShortcutKeys[option.rating]}
          disabled={isSubmitting}
          onClick={() => onReview(option.rating)}
          onPointerEnter={onShortcutButtonPointerEnter}
          data-testid={`review-rate-${option.testId}`}
        >
          <span className="rating-btn-title-row">
            <ReviewRatingIcon rating={option.rating} />
            <span className="rating-btn-title">{option.title}</span>
          </span>
          <span className="rating-btn-subtitle">{option.intervalDescription}</span>
          <ReviewShortcutHint keyLabel={reviewRatingShortcutKeys[option.rating]} />
        </button>
      ))}
    </div>
  );
}

function ReviewActiveCardPane(props: ReviewActiveCardPaneProps): ReactElement {
  const {
    showFirstReviewOnboarding,
    surfaceRef,
    activeSideCopyButtonRef,
    activeSpeechSide,
    isAnswerVisible,
    isSubmitting,
    localReadVersion,
    onAiHandoff,
    onEditCard,
    onRequestTagFilter,
    onRequestTextSelection,
    onRevealAnswer,
    onReview,
    onShortcutButtonPointerEnter,
    onToggleSpeech,
    reviewButtonErrorMessage,
    reviewButtonOptions,
    reviewRatingErrorMessage,
    selectedBackSpeakableText,
    selectedCard,
    selectedFrontSpeakableText,
    workspaceId,
  } = props;
  const { t } = useI18n();
  const frontSideLabel = t("reviewScreen.sides.front");
  const backSideLabel = t("reviewScreen.sides.back");
  const leftReviewButtonOptions = reviewButtonOptions.slice(0, REVIEW_BUTTONS_PER_COLUMN);
  const rightReviewButtonOptions = reviewButtonOptions.slice(REVIEW_BUTTONS_PER_COLUMN, REVIEW_BUTTONS_PER_COLUMN * 2);
  const [revealButton, setRevealButton] = useState<HTMLButtonElement | null>(null);
  const [againButton, setAgainButton] = useState<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const frontTargetRef = useRef<HTMLDivElement>(null);
  const backTargetRef = useRef<HTMLDivElement>(null);
  const previousCardIdRef = useRef<string | null>(null);
  const wasAnswerVisibleRef = useRef(false);
  const shortcutTarget: ReviewCardShortcutTarget = { copyButtonRef: activeSideCopyButtonRef };

  function openSelectedCardEditor(): void {
    onEditCard(selectedCard);
  }

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
      <div className="review-pane-head" ref={headerRef}>
        <ReviewCardHeadTags
          key={selectedCard.cardId}
          onRequestTagFilter={onRequestTagFilter}
          tags={selectedCard.tags}
        />
      </div>
      <div className="review-card-stack" ref={contentRef}>
        <div className="review-card-scroll-target" ref={frontTargetRef}>
          <ReviewCardSide
            label={frontSideLabel}
            aiButtonAriaLabel={null}
            text={selectedCard.frontText}
            contentClassName="review-front"
            copySource={{ cardId: selectedCard.cardId, side: "front", sourceText: selectedCard.frontText }}
            edit={{ disabled: false, onEdit: openSelectedCardEditor, testId: "review-edit-front" }}
            isSpeaking={activeSpeechSide === "front"}
            onOpenAi={null}
            onOpenTextSelection={() => onRequestTextSelection("front")}
            onToggleSpeech={() => onToggleSpeech("front", selectedCard.frontText)}
            repetitionCount={selectedCard.reps}
            shortcutTarget={isAnswerVisible ? null : shortcutTarget}
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
              copySource={{ cardId: selectedCard.cardId, side: "back", sourceText: selectedCard.backText }}
              edit={{ disabled: false, onEdit: openSelectedCardEditor, testId: "review-edit-back" }}
              isSpeaking={activeSpeechSide === "back"}
              onOpenAi={() => void onAiHandoff(selectedCard)}
              onOpenTextSelection={() => onRequestTextSelection("back")}
              onToggleSpeech={() => onToggleSpeech("back", selectedCard.backText)}
              repetitionCount={null}
              shortcutTarget={shortcutTarget}
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

      <div className="review-actions-dock" ref={controlsRef}>
        {reviewRatingErrorMessage === "" ? null : (
          <p className="error-banner" role="alert">{reviewRatingErrorMessage}</p>
        )}
        {isAnswerVisible ? (
          reviewButtonErrorMessage !== "" ? (
            <p className="error-banner">{reviewButtonErrorMessage}</p>
          ) : (
            <div className="rating-bar">
              <ReviewRatingButtonColumn
                onAgainButton={setAgainButton}
                isSubmitting={isSubmitting}
                onReview={(rating) => {
                  void onReview(selectedCard, rating);
                }}
                onShortcutButtonPointerEnter={onShortcutButtonPointerEnter}
                options={leftReviewButtonOptions}
              />
              <ReviewRatingButtonColumn
                onAgainButton={setAgainButton}
                isSubmitting={isSubmitting}
                onReview={(rating) => {
                  void onReview(selectedCard, rating);
                }}
                onShortcutButtonPointerEnter={onShortcutButtonPointerEnter}
                options={rightReviewButtonOptions}
              />
            </div>
          )
        ) : (
          <button
            type="button"
            className="primary-btn review-reveal-btn"
            ref={setRevealButton}
            aria-keyshortcuts={REVIEW_REVEAL_SHORTCUT_ARIA_KEYS}
            onClick={onRevealAnswer}
            onPointerEnter={onShortcutButtonPointerEnter}
            data-testid="review-reveal-answer"
          >
            <span className="review-reveal-btn-content">
              <ReviewEyeIcon />
              <span>{t("reviewScreen.actions.revealAnswer")}</span>
            </span>
            <ReviewShortcutHint keyLabel={`${t("reviewScreen.shortcuts.spaceKey")} / ${t("reviewScreen.shortcuts.enterKey")}`} />
          </button>
        )}
      </div>
      {showFirstReviewOnboarding && !isSubmitting && reviewButtonErrorMessage === "" && reviewRatingErrorMessage === "" ? (
        <FirstReviewOnboardingOverlay
          target={isAnswerVisible ? againButton : revealButton}
          surfaceRef={surfaceRef}
          contentRef={contentRef}
          headerRef={headerRef}
          controlsRef={controlsRef}
          stage={isAnswerVisible ? "again" : "reveal"}
        />
      ) : null}
    </>
  );
}

export function ReviewPane(props: ReviewPaneProps): ReactElement {
  const surfaceRef = useRef<HTMLElement>(null);
  const {
    showFirstReviewOnboarding,
    activeSideCopyButtonRef,
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
    onRequestTagFilter,
    onRequestTextSelection,
    onRevealAnswer,
    onReview,
    onShortcutButtonPointerEnter,
    onSwitchToAllCards,
    onToggleSpeech,
    reviewButtonErrorMessage,
    reviewButtonOptions,
    reviewLoadingSnapshot,
    reviewRatingErrorMessage,
    reviewSubmitState,
    selectedBackSpeakableText,
    selectedCard,
    selectedFrontSpeakableText,
    shouldShowSwitchToAllCardsAction,
    workspaceId,
  } = props;
  const reviewPaneState = resolveReviewPaneState(isInitialReviewLoad, selectedCard);
  const reviewPaneEmptyReason = resolveReviewPaneEmptyReason(isInitialReviewLoad, selectedCard, hasCards);

  useEffect(() => {
    if (reviewPaneState === "empty") {
      discardReviewNextCardVisibleSpan();
      return;
    }
    if (reviewPaneState === "card" && selectedCard !== null) {
      finishReviewNextCardVisibleSpan(selectedCard.cardId, selectedCard.frontText);
    }
  }, [reviewPaneState, selectedCard?.cardId]);

  return (
    <section
      className="review-pane"
      ref={surfaceRef}
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
          onRequestTagFilter={onRequestTagFilter}
          onRequestTextSelection={onRequestTextSelection}
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
          showFirstReviewOnboarding={showFirstReviewOnboarding}
          surfaceRef={surfaceRef}
          activeSideCopyButtonRef={activeSideCopyButtonRef}
          activeSpeechSide={activeSpeechSide}
          isAnswerVisible={isAnswerVisible}
          isSubmitting={isSubmitting}
          localReadVersion={localReadVersion}
          onAiHandoff={onAiHandoff}
          onEditCard={onEditCard}
          onRequestTagFilter={onRequestTagFilter}
          onRequestTextSelection={onRequestTextSelection}
          onRevealAnswer={onRevealAnswer}
          onReview={onReview}
          onShortcutButtonPointerEnter={onShortcutButtonPointerEnter}
          onToggleSpeech={onToggleSpeech}
          reviewButtonErrorMessage={reviewButtonErrorMessage}
          reviewButtonOptions={reviewButtonOptions}
          reviewRatingErrorMessage={reviewRatingErrorMessage}
          selectedBackSpeakableText={selectedBackSpeakableText}
          selectedCard={selectedCard}
          selectedFrontSpeakableText={selectedFrontSpeakableText}
          workspaceId={workspaceId}
        />
      ) : null}
    </section>
  );
}
