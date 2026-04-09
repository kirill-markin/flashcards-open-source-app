import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import type { ReviewFilter } from "../types";
import type { ReviewFilterChoiceMenuItem, ReviewFilterMenuItem } from "./useReviewFilterMenu";

type ReviewFilterMenuProps = Readonly<{
  handleCloseMenu: () => void;
  handleReviewFilterMenuToggle: () => void;
  handleReviewFilterSelect: (reviewFilter: ReviewFilter) => void;
  hasVisibleReviewFilterChoices: boolean;
  isReviewFilterMenuOpen: boolean;
  reviewDeckSearchInputRef: React.RefObject<HTMLInputElement | null>;
  reviewDeckSearchText: string;
  reviewFilterMenuItems: ReadonlyArray<ReviewFilterMenuItem>;
  reviewFilterMenuWrapRef: React.RefObject<HTMLDivElement | null>;
  reviewFilterTriggerRef: React.RefObject<HTMLButtonElement | null>;
  selectedReviewFilterTitle: string;
  setReviewDeckSearchText: (value: string) => void;
  shouldShowReviewDeckSearch: boolean;
  visibleReviewDeckFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
  visibleReviewEffortFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
  visibleReviewTagFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
}>;

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

export function ReviewFilterMenu(props: ReviewFilterMenuProps): ReactElement {
  const {
    handleCloseMenu,
    handleReviewFilterMenuToggle,
    handleReviewFilterSelect,
    hasVisibleReviewFilterChoices,
    isReviewFilterMenuOpen,
    reviewDeckSearchInputRef,
    reviewDeckSearchText,
    reviewFilterMenuItems,
    reviewFilterMenuWrapRef,
    reviewFilterTriggerRef,
    selectedReviewFilterTitle,
    setReviewDeckSearchText,
    shouldShowReviewDeckSearch,
    visibleReviewDeckFilterMenuItems,
    visibleReviewEffortFilterMenuItems,
    visibleReviewTagFilterMenuItems,
  } = props;
  const { t } = useI18n();

  return (
    <div ref={reviewFilterMenuWrapRef} className="review-filter-menu-wrap">
      <span className="review-filter-label">{t("reviewFilterMenu.scopeLabel")}</span>
      <button
        ref={reviewFilterTriggerRef}
        className={`ghost-btn review-filter-trigger${isReviewFilterMenuOpen ? " review-filter-trigger-open" : ""}`}
        type="button"
        aria-expanded={isReviewFilterMenuOpen}
        aria-haspopup="menu"
        aria-label={t("reviewFilterMenu.openAriaLabel")}
        onClick={handleReviewFilterMenuToggle}
        data-testid="review-filter-trigger"
      >
        <span className="review-filter-trigger-value">{selectedReviewFilterTitle}</span>
        <span className="review-filter-trigger-chevron" aria-hidden="true">▾</span>
      </button>
      {isReviewFilterMenuOpen ? (
        <div className="review-filter-menu" role="menu" aria-label={t("reviewFilterMenu.menuAriaLabel")}>
          {shouldShowReviewDeckSearch ? (
            <label className="review-filter-search-field">
              <span className="review-filter-search-label">{t("reviewFilterMenu.searchLabel")}</span>
              <input
                ref={reviewDeckSearchInputRef}
                type="search"
                name="review-filter-search"
                className="review-filter-search-input"
                placeholder={t("reviewFilterMenu.searchPlaceholder")}
                value={reviewDeckSearchText}
                onChange={(event) => setReviewDeckSearchText(event.target.value)}
              />
            </label>
          ) : null}
          {hasVisibleReviewFilterChoices === false ? (
            <div className="review-filter-menu-empty" aria-live="polite">{t("reviewFilterMenu.empty")}</div>
          ) : null}
          {visibleReviewDeckFilterMenuItems.map((item) => (
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
          ))}
          {reviewFilterMenuItems.map((item) => (
            <Link
              key={item.key}
              className="review-filter-menu-entry review-filter-menu-entry-action"
              to={item.href}
              role="menuitem"
              onClick={handleCloseMenu}
            >
              <span className="review-filter-menu-item-slot" aria-hidden="true">
                <ReviewFilterDecksIcon />
              </span>
              <span className="review-filter-menu-item-label">{item.label}</span>
            </Link>
          ))}
          {visibleReviewEffortFilterMenuItems.length > 0 ? (
            <div className="review-filter-menu-divider" role="separator" />
          ) : null}
          {visibleReviewEffortFilterMenuItems.map((effortItem) => (
            <button
              key={effortItem.key}
              className={`review-filter-menu-entry${effortItem.isSelected ? " review-filter-menu-entry-active" : ""}`}
              type="button"
              role="menuitemradio"
              aria-checked={effortItem.isSelected}
              data-review-filter-key={effortItem.key}
              onClick={() => handleReviewFilterSelect(effortItem.reviewFilter)}
            >
              <span className="review-filter-menu-item-slot" aria-hidden="true">
                <span className={`review-filter-menu-item-check${effortItem.isSelected ? " review-filter-menu-item-check-visible" : ""}`}>
                  <ReviewFilterCheckIcon />
                </span>
              </span>
              <span className="review-filter-menu-item-label">{effortItem.label}</span>
            </button>
          ))}
          {visibleReviewTagFilterMenuItems.length > 0 ? (
            <div className="review-filter-menu-divider" role="separator" />
          ) : null}
          {visibleReviewTagFilterMenuItems.map((tagItem) => (
            <button
              key={tagItem.key}
              className={`review-filter-menu-entry${tagItem.isSelected ? " review-filter-menu-entry-active" : ""}`}
              type="button"
              role="menuitemradio"
              aria-checked={tagItem.isSelected}
              data-review-filter-key={tagItem.key}
              onClick={() => handleReviewFilterSelect(tagItem.reviewFilter)}
            >
              <span className="review-filter-menu-item-slot" aria-hidden="true">
                <span className={`review-filter-menu-item-check${tagItem.isSelected ? " review-filter-menu-item-check-visible" : ""}`}>
                  <ReviewFilterCheckIcon />
                </span>
              </span>
              <span className="review-filter-menu-item-label">{tagItem.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
