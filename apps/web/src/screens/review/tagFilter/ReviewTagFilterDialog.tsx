import { useEffect, useRef, type ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { trapFocusInsideDialog } from "../reviewDialogFocus";

/**
 * Captured when the chip is clicked, so the dialog variant and wording stay fixed while it is open.
 */
export type ReviewTagFilterRequest = Readonly<{
  currentFilterTitle: string;
  isRequestedTagFilterSelected: boolean;
  tag: string;
}>;

export type ReviewTagFilterDialogProps = Readonly<{
  onConfirm: (tag: string) => void;
  onDismiss: () => void;
  request: ReviewTagFilterRequest | null;
}>;

/**
 * Confirms switching the review filter to a card tag, or explains that the tag is already the filter.
 */
export function ReviewTagFilterDialog(props: ReviewTagFilterDialogProps): ReactElement | null {
  const { onConfirm, onDismiss, request } = props;
  const { t } = useI18n();
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
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
    initialFocusRef.current?.focus();

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

  const { currentFilterTitle, isRequestedTagFilterSelected, tag: requestedTag } = request;

  return (
    <div className="review-tag-filter-overlay">
      <section
        ref={dialogRef}
        className="panel review-tag-filter-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-tag-filter-title"
        aria-describedby="review-tag-filter-body"
        tabIndex={-1}
        data-testid="review-tag-filter-dialog"
      >
        <div>
          <h2 id="review-tag-filter-title" className="title">{t("reviewTagFilterDialog.title")}</h2>
          <p id="review-tag-filter-body" className="subtitle review-tag-filter-body">
            {isRequestedTagFilterSelected
              ? t("reviewTagFilterDialog.alreadySelectedBody", { tag: requestedTag })
              : t("reviewTagFilterDialog.changeBody", { currentFilter: currentFilterTitle, tag: requestedTag })}
          </p>
        </div>

        {isRequestedTagFilterSelected ? (
          <div className="review-tag-filter-actions">
            <button
              ref={initialFocusRef}
              type="button"
              className="primary-btn"
              onClick={onDismiss}
              data-testid="review-tag-filter-ok"
            >
              {t("common.ok")}
            </button>
          </div>
        ) : (
          <div className="review-tag-filter-actions">
            <button
              ref={initialFocusRef}
              type="button"
              className="ghost-btn"
              onClick={onDismiss}
              data-testid="review-tag-filter-cancel"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => onConfirm(requestedTag)}
              data-testid="review-tag-filter-confirm"
            >
              {t("reviewTagFilterDialog.confirm")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
