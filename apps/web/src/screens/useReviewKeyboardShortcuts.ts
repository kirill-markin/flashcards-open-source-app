import { useEffect, useEffectEvent } from "react";
import type { Card } from "../types";

type UseReviewKeyboardShortcutsParams = Readonly<{
  handleReview: (card: Card, rating: 0 | 1 | 2 | 3) => Promise<void>;
  isAnswerVisible: boolean;
  isEditorPresented: boolean;
  isHardReminderVisible: boolean;
  isReviewFilterMenuOpen: boolean;
  isSubmitting: boolean;
  selectedCard: Card | null;
  setIsAnswerVisible: (value: boolean) => void;
}>;

const reviewShortcutRatingsByKey: Readonly<Record<string, 0 | 1 | 2 | 3>> = {
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
};

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
    isHardReminderVisible,
    isReviewFilterMenuOpen,
    isSubmitting,
    selectedCard,
    setIsAnswerVisible,
  } = params;

  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      selectedCard === null
      || isSubmitting
      || isEditorPresented
      || isHardReminderVisible
      || isReviewFilterMenuOpen
      || isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    if (event.key === " ") {
      if (isAnswerVisible) {
        return;
      }

      event.preventDefault();
      setIsAnswerVisible(true);
      return;
    }

    const rating = reviewShortcutRatingsByKey[event.key];
    if (rating === undefined || !isAnswerVisible) {
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
