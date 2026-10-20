import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  AnchoredFloatingOverlay,
  useAnchoredFloatingHiddenTriggerDismiss,
  useAnchoredFloatingOutsidePointerDismiss,
} from "../../../floating";
import { useI18n } from "../../../i18n";

const REVIEW_MORE_ACTIONS_MENU_OFFSET_PX = 10;
const REVIEW_MORE_ACTIONS_MENU_VIEWPORT_PADDING_PX = 16;
const REVIEW_MORE_ACTIONS_MENU_MAX_WIDTH_PX = 320;

type ReviewMoreActionsMenuProps = Readonly<{
  isReviewFilterMenuOpen: boolean;
  isReviewQueueShortcutDisabled: boolean;
  onCloseReviewFilterMenu: () => void;
  onOpenReviewFilterMenu: () => void;
  onReviewQueueShortcutClick: () => void;
  selectedReviewFilterTitle: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}>;

function ReviewMoreActionsIcon(): ReactElement {
  return (
    <svg className="review-progress-badge-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="19" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function ReviewMoreActionsChevronIcon(): ReactElement {
  return (
    <svg className="review-more-actions-chevron" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6.75 4.5L11.25 9L6.75 13.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Phone-width entry point to the review scope list and queue, which the compact header hides.
export function ReviewMoreActionsMenu(props: ReviewMoreActionsMenuProps): ReactElement {
  const {
    isReviewFilterMenuOpen,
    isReviewQueueShortcutDisabled,
    onCloseReviewFilterMenu,
    onOpenReviewFilterMenu,
    onReviewQueueShortcutClick,
    selectedReviewFilterTitle,
    triggerRef,
  } = props;
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerAriaLabel = t("reviewScreen.moreActions.ariaLabel");

  const closeMenu = useCallback(function closeMenu(): void {
    setIsOpen(false);
  }, []);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef,
    overlayRef: menuRef,
    enabled: isOpen,
    onClose: closeMenu,
  });

  useAnchoredFloatingHiddenTriggerDismiss({
    triggerRef,
    enabled: isOpen,
    onClose: closeMenu,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, triggerRef]);

  function handleTriggerClick(): void {
    if (isReviewFilterMenuOpen) {
      onCloseReviewFilterMenu();
      return;
    }

    setIsOpen((currentValue) => !currentValue);
  }

  function handleScopeClick(): void {
    setIsOpen(false);
    onOpenReviewFilterMenu();
  }

  function handleQueueClick(): void {
    setIsOpen(false);
    onReviewQueueShortcutClick();
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="badge review-progress-badge review-screen-head-badge review-more-actions-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={triggerAriaLabel}
        title={triggerAriaLabel}
        data-testid="review-more-actions-trigger"
        onClick={handleTriggerClick}
      >
        <ReviewMoreActionsIcon />
      </button>
      <AnchoredFloatingOverlay
        isOpen={isOpen}
        referenceRef={triggerRef}
        floatingRef={menuRef}
        placement="bottom-end"
        viewportPaddingPx={REVIEW_MORE_ACTIONS_MENU_VIEWPORT_PADDING_PX}
        offsetPx={REVIEW_MORE_ACTIONS_MENU_OFFSET_PX}
        minimumWidth={null}
        maxWidthPx={REVIEW_MORE_ACTIONS_MENU_MAX_WIDTH_PX}
        maxHeightPx={null}
        className="review-filter-menu"
        id={null}
        role={null}
        ariaLabel={null}
        ariaLabelledBy={null}
        ariaDescribedBy={null}
        ariaModal={null}
      >
        <button
          className="review-filter-menu-entry review-more-actions-entry"
          type="button"
          data-testid="review-more-actions-scope"
          onClick={handleScopeClick}
        >
          <span className="review-filter-menu-item-label">
            {`${t("reviewFilterMenu.scopeLabel")}: ${selectedReviewFilterTitle}`}
          </span>
          <ReviewMoreActionsChevronIcon />
        </button>
        <button
          className="review-filter-menu-entry review-more-actions-entry"
          type="button"
          data-testid="review-more-actions-queue"
          disabled={isReviewQueueShortcutDisabled}
          onClick={handleQueueClick}
        >
          <span className="review-filter-menu-item-label">{t("reviewScreen.queue.title")}</span>
        </button>
      </AnchoredFloatingOverlay>
    </>
  );
}
