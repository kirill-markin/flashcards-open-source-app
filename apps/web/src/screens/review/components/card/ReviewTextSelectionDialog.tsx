import { useEffect, useRef, type ReactElement } from "react";
import { useI18n } from "../../../../i18n";
import { trapFocusInsideDialog } from "../../reviewDialogFocus";
import type { ReviewSpeechSide } from "../../speech/reviewSpeech";

export type ReviewTextSelectionRequest = Readonly<{
  cardId: string;
  side: ReviewSpeechSide;
  text: string;
  workspaceId: string | null;
}>;

export type ReviewTextSelectionDialogProps = Readonly<{
  onDismiss: () => void;
  request: ReviewTextSelectionRequest | null;
}>;

export function ReviewTextSelectionDialog(props: ReviewTextSelectionDialogProps): ReactElement | null {
  const { onDismiss, request } = props;
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isOpen = request !== null;

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (isOpen === false) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    textareaRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onDismissRef.current();
        return;
      }

      if (event.key === "Tab" && dialogRef.current !== null) {
        trapFocusInsideDialog(event, dialogRef.current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown);
      const previousFocus = previousFocusRef.current;
      if (previousFocus !== null && previousFocus.isConnected) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  if (request === null) {
    return null;
  }

  const sideLabel = t(request.side === "front" ? "reviewScreen.sides.front" : "reviewScreen.sides.back");

  return (
    <div className="review-text-selection-overlay">
      <section
        ref={dialogRef}
        className="panel review-text-selection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-text-selection-title"
        tabIndex={-1}
        data-testid="review-text-selection-dialog"
      >
        <h2 id="review-text-selection-title" className="title">{sideLabel}</h2>
        <textarea
          ref={textareaRef}
          className="review-text-selection-source"
          aria-labelledby="review-text-selection-title"
          readOnly
          value={request.text}
          wrap="soft"
          dir="auto"
          spellCheck={false}
          data-testid="review-text-selection-source"
        />
        <div className="review-text-selection-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={onDismiss}
            data-testid="review-text-selection-close"
          >
            {t("common.close")}
          </button>
        </div>
      </section>
    </div>
  );
}
