import { useEffect, useEffectEvent } from "react";
import type { Card } from "../../../types";
import { reviewRevealShortcutKey, reviewShortcutRatingsByKey } from "./reviewShortcutKeys";

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

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
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

export function useReviewKeyboardShortcuts(params: UseReviewKeyboardShortcutsParams): void {
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

  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      selectedCard === null
      || isSubmitting
      || isEditorPresented
      || isFeedbackDialogOpen
      || isHardReminderVisible
      || isMobileAppPromotionDialogOpen
      || isReviewFilterMenuOpen
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
}
