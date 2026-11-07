import { useCallback, useEffect, useEffectEvent, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Card } from "../../../types";
import type { ReviewCardCopyButtonHandle } from "../components/card/ReviewCardCopyButton";
import type { ReviewSpeechSide } from "../speech/reviewSpeech";
import {
  reviewCopyShortcutKey,
  reviewFilterShortcutKey,
  reviewRevealShortcutKeys,
  reviewShortcutLetter,
  reviewShortcutRatingsByKey,
  reviewSpeechShortcutKey,
} from "./reviewShortcutKeys";

export type ReviewShortcutPointerEnterHandler = (event: ReactPointerEvent<HTMLButtonElement>) => void;

type UseReviewKeyboardShortcutsParams = Readonly<{
  activeSideCopyButtonRef: RefObject<ReviewCardCopyButtonHandle | null>;
  handleReview: (card: Card, rating: 0 | 1 | 2 | 3) => Promise<void>;
  isAnswerVisible: boolean;
  isEditorPresented: boolean;
  isFeedbackDialogOpen: boolean;
  isHardReminderVisible: boolean;
  isGuestSignInPromptVisible: boolean;
  isMobileAppPromotionDialogOpen: boolean;
  isReviewFilterMenuOpen: boolean;
  isReviewMoreActionsMenuOpen: boolean;
  isSubmitting: boolean;
  isTagFilterDialogOpen: boolean;
  isTextSelectionDialogOpen: boolean;
  onShortcutInputStart: () => void;
  openReviewFilterMenu: () => void;
  selectedBackSpeakableText: string;
  selectedCard: Card | null;
  selectedFrontSpeakableText: string;
  setIsAnswerVisible: (value: boolean) => void;
  toggleSpeech: (side: ReviewSpeechSide, sourceText: string) => void;
}>;

type UseReviewKeyboardShortcutsResult = Readonly<{
  handleShortcutButtonPointerEnter: ReviewShortcutPointerEnterHandler;
}>;

function isEditableKeyboardTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

export function useReviewKeyboardShortcuts(params: UseReviewKeyboardShortcutsParams): UseReviewKeyboardShortcutsResult {
  const {
    activeSideCopyButtonRef,
    handleReview,
    isAnswerVisible,
    isEditorPresented,
    isFeedbackDialogOpen,
    isHardReminderVisible,
    isGuestSignInPromptVisible,
    isMobileAppPromotionDialogOpen,
    isReviewFilterMenuOpen,
    isReviewMoreActionsMenuOpen,
    isSubmitting,
    isTagFilterDialogOpen,
    isTextSelectionDialogOpen,
    onShortcutInputStart,
    openReviewFilterMenu,
    selectedBackSpeakableText,
    selectedCard,
    selectedFrontSpeakableText,
    setIsAnswerVisible,
    toggleSpeech,
  } = params;
  const isImeCompositionActiveRef = useRef<boolean>(false);
  const areShortcutsSuppressed = isSubmitting
    || isEditorPresented
    || isFeedbackDialogOpen
    || isHardReminderVisible
    || isGuestSignInPromptVisible
    || isMobileAppPromotionDialogOpen
    || isReviewFilterMenuOpen
    || isReviewMoreActionsMenuOpen
    || isTagFilterDialogOpen
    || isTextSelectionDialogOpen;

  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.isComposing
      || event.keyCode === 229
      || isImeCompositionActiveRef.current
      || areShortcutsSuppressed
      || isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    const shortcutLetter = reviewShortcutLetter(event);
    // Works without a selected card: an empty queue is when another filter is most wanted.
    if (shortcutLetter === reviewFilterShortcutKey) {
      if (event.shiftKey || event.repeat) {
        return;
      }

      // Without this the letter would be typed into the search field that receives focus.
      event.preventDefault();
      onShortcutInputStart();
      openReviewFilterMenu();
      return;
    }

    if (selectedCard === null) {
      return;
    }

    if (reviewRevealShortcutKeys.includes(event.key)) {
      if (event.shiftKey) {
        return;
      }

      if (event.target instanceof Element && event.target.closest("button, a[href], summary, [role=button], [role=link]") !== null) {
        return;
      }

      event.preventDefault();
      if (event.repeat) {
        return;
      }

      onShortcutInputStart();
      if (!isAnswerVisible) {
        setIsAnswerVisible(true);
      }
      return;
    }

    if (shortcutLetter === reviewSpeechShortcutKey || shortcutLetter === reviewCopyShortcutKey) {
      if (event.shiftKey || event.repeat) {
        return;
      }

      const activeSide: ReviewSpeechSide = isAnswerVisible ? "back" : "front";
      if (shortcutLetter === reviewSpeechShortcutKey) {
        const activeSpeakableText = activeSide === "back" ? selectedBackSpeakableText : selectedFrontSpeakableText;
        if (activeSpeakableText === "") {
          return;
        }

        event.preventDefault();
        onShortcutInputStart();
        toggleSpeech(activeSide, activeSide === "back" ? selectedCard.backText : selectedCard.frontText);
        return;
      }

      // Null until the active card pane has rendered the active side's copy button.
      const copyButton = activeSideCopyButtonRef.current;
      if (copyButton === null) {
        return;
      }

      event.preventDefault();
      onShortcutInputStart();
      // Copying inside this keydown keeps the key press's user activation for the clipboard write.
      void copyButton.copy();
      return;
    }

    const rating = reviewShortcutRatingsByKey[event.key];
    if (rating === undefined || event.repeat) {
      return;
    }

    onShortcutInputStart();
    if (!isAnswerVisible) {
      return;
    }

    event.preventDefault();
    void handleReview(selectedCard, rating);
  });

  useEffect(() => {
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [handleDocumentKeyDown]);

  useEffect(() => {
    function handleCompositionStart(): void {
      isImeCompositionActiveRef.current = true;
    }

    function handleCompositionEnd(): void {
      isImeCompositionActiveRef.current = false;
    }

    document.addEventListener("compositionstart", handleCompositionStart);
    document.addEventListener("compositionend", handleCompositionEnd);
    return () => {
      document.removeEventListener("compositionstart", handleCompositionStart);
      document.removeEventListener("compositionend", handleCompositionEnd);
    };
  }, []);

  // Mouse hover over a review action button releases text-field focus so the document-level
  // shortcuts start working. Focus is only released, never moved onto the hovered button,
  // because a focused rating button would be natively activated by Space or Enter.
  const handleShortcutButtonPointerEnter = useCallback(function handleShortcutButtonPointerEnter(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (
      event.pointerType !== "mouse"
      || isImeCompositionActiveRef.current
      || selectedCard === null
      || areShortcutsSuppressed
    ) {
      return;
    }

    const activeElement = document.activeElement;
    if (!isEditableKeyboardTarget(activeElement)) {
      return;
    }

    activeElement.blur();
  }, [areShortcutsSuppressed, selectedCard]);

  return { handleShortcutButtonPointerEnter };
}
