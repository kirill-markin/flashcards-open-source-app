import { useCallback, useEffect, useEffectEvent, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Card } from "../../../types";
import { reviewRevealShortcutKey, reviewShortcutRatingsByKey } from "./reviewShortcutKeys";

export type ReviewShortcutPointerEnterHandler = (event: ReactPointerEvent<HTMLButtonElement>) => void;

type UseReviewKeyboardShortcutsParams = Readonly<{
  handleReview: (card: Card, rating: 0 | 1 | 2 | 3) => Promise<void>;
  isAnswerVisible: boolean;
  isEditorPresented: boolean;
  isFeedbackDialogOpen: boolean;
  isHardReminderVisible: boolean;
  isMobileAppPromotionDialogOpen: boolean;
  isReviewFilterMenuOpen: boolean;
  isSubmitting: boolean;
  onShortcutInputStart: () => void;
  selectedCard: Card | null;
  setIsAnswerVisible: (value: boolean) => void;
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
    handleReview,
    isAnswerVisible,
    isEditorPresented,
    isFeedbackDialogOpen,
    isHardReminderVisible,
    isMobileAppPromotionDialogOpen,
    isReviewFilterMenuOpen,
    isSubmitting,
    onShortcutInputStart,
    selectedCard,
    setIsAnswerVisible,
  } = params;
  const isImeCompositionActiveRef = useRef<boolean>(false);
  const areShortcutsSuppressed = isSubmitting
    || isEditorPresented
    || isFeedbackDialogOpen
    || isHardReminderVisible
    || isMobileAppPromotionDialogOpen
    || isReviewFilterMenuOpen;

  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      selectedCard === null
      || areShortcutsSuppressed
      || isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    if (event.key === reviewRevealShortcutKey) {
      onShortcutInputStart();
      if (isAnswerVisible) {
        return;
      }

      event.preventDefault();
      setIsAnswerVisible(true);
      return;
    }

    const rating = reviewShortcutRatingsByKey[event.key];
    if (rating === undefined) {
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
