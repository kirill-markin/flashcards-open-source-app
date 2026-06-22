import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../../i18n";
import type { ReviewFilter } from "../../../types";
import type { ReviewFilterChoiceMenuItem, ReviewFilterMenuItem } from "./useReviewFilterMenu";

type ReviewFilterMenuProps = Readonly<{
  activeReviewFilterOptionId: string | null;
  activeReviewFilterOptionKey: string | null;
  getReviewFilterOptionId: (optionKey: string) => string;
  handleCloseMenu: () => void;
  handleReviewFilterComboboxKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  handleReviewFilterListboxKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  handleReviewFilterMenuToggle: () => void;
  handleReviewFilterSelect: (reviewFilter: ReviewFilter) => void;
  hasVisibleReviewFilterChoices: boolean;
  isReviewFilterMenuOpen: boolean;
  reviewDeckSearchInputRef: React.RefObject<HTMLInputElement | null>;
  reviewDeckSearchText: string;
  reviewFilterListboxId: string;
  reviewFilterListboxRef: React.RefObject<HTMLDivElement | null>;
  reviewFilterMenuItems: ReadonlyArray<ReviewFilterMenuItem>;
  reviewFilterMenuWrapRef: React.RefObject<HTMLDivElement | null>;
  reviewFilterTriggerRef: React.RefObject<HTMLButtonElement | null>;
  selectedReviewFilterTitle: string;
  setReviewDeckSearchText: (value: string) => void;
  shouldShowReviewDeckSearch: boolean;
  visibleReviewDeckFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
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

function reviewFilterChoiceClassName(item: ReviewFilterChoiceMenuItem, activeReviewFilterOptionKey: string | null): string {
  const classNames = ["review-filter-menu-entry"];
  if (item.isSelected) {
    classNames.push("review-filter-menu-entry-active");
  }

  if (activeReviewFilterOptionKey === item.key) {
    classNames.push("review-filter-menu-entry-keyboard-active");
  }

  return classNames.join(" ");
}

export function ReviewFilterMenu(props: ReviewFilterMenuProps): ReactElement {
  const {
    activeReviewFilterOptionId,
    activeReviewFilterOptionKey,
    getReviewFilterOptionId,
    handleCloseMenu,
    handleReviewFilterComboboxKeyDown,
    handleReviewFilterListboxKeyDown,
    handleReviewFilterMenuToggle,
    handleReviewFilterSelect,
    hasVisibleReviewFilterChoices,
    isReviewFilterMenuOpen,
    reviewDeckSearchInputRef,
    reviewDeckSearchText,
    reviewFilterListboxId,
    reviewFilterListboxRef,
    reviewFilterMenuItems,
    reviewFilterMenuWrapRef,
    reviewFilterTriggerRef,
    selectedReviewFilterTitle,
    setReviewDeckSearchText,
    shouldShowReviewDeckSearch,
    visibleReviewDeckFilterMenuItems,
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
        aria-controls={isReviewFilterMenuOpen ? reviewFilterListboxId : undefined}
        aria-haspopup="listbox"
        aria-label={t("reviewFilterMenu.openAriaLabel")}
        onClick={handleReviewFilterMenuToggle}
        data-testid="review-filter-trigger"
      >
        <span className="review-filter-trigger-value">{selectedReviewFilterTitle}</span>
        <span className="review-filter-trigger-chevron" aria-hidden="true">▾</span>
      </button>
      {isReviewFilterMenuOpen ? (
        <div className="review-filter-menu">
          {shouldShowReviewDeckSearch ? (
            <label className="review-filter-search-field">
              <span className="review-filter-search-label">{t("reviewFilterMenu.searchLabel")}</span>
              <input
                ref={reviewDeckSearchInputRef}
                type="search"
                role="combobox"
                name="review-filter-search"
                className="review-filter-search-input"
                placeholder={t("reviewFilterMenu.searchPlaceholder")}
                value={reviewDeckSearchText}
                aria-autocomplete="list"
                aria-controls={reviewFilterListboxId}
                aria-expanded={isReviewFilterMenuOpen}
                aria-haspopup="listbox"
                aria-activedescendant={activeReviewFilterOptionId ?? undefined}
                onChange={(event) => setReviewDeckSearchText(event.target.value)}
                onKeyDown={handleReviewFilterComboboxKeyDown}
              />
            </label>
          ) : null}
          {hasVisibleReviewFilterChoices === false ? (
            <div className="review-filter-menu-empty" aria-live="polite">{t("reviewFilterMenu.empty")}</div>
          ) : null}
          <div
            ref={reviewFilterListboxRef}
            id={reviewFilterListboxId}
            className="review-filter-listbox"
            role="listbox"
            tabIndex={shouldShowReviewDeckSearch ? undefined : 0}
            aria-label={t("reviewFilterMenu.menuAriaLabel")}
            aria-activedescendant={shouldShowReviewDeckSearch ? undefined : activeReviewFilterOptionId ?? undefined}
            onKeyDown={shouldShowReviewDeckSearch ? undefined : handleReviewFilterListboxKeyDown}
          >
            {visibleReviewDeckFilterMenuItems.map((item) => (
              <div
                key={item.key}
                id={getReviewFilterOptionId(item.key)}
                className={reviewFilterChoiceClassName(item, activeReviewFilterOptionKey)}
                role="option"
                aria-selected={item.isSelected}
                aria-label={item.subtitle === null ? undefined : `${item.label}. ${item.subtitle}`}
                data-review-filter-key={item.key}
                onClick={() => handleReviewFilterSelect(item.reviewFilter)}
              >
                <span className="review-filter-menu-item-slot" aria-hidden="true">
                  <span className={`review-filter-menu-item-check${item.isSelected ? " review-filter-menu-item-check-visible" : ""}`}>
                    <ReviewFilterCheckIcon />
                  </span>
                </span>
                <span className="review-filter-menu-item-label">
                  <span>{item.label}</span>
                  {item.subtitle === null ? null : (
                    <>
                      <br />
                      <span className="review-filter-label">{item.subtitle}</span>
                    </>
                  )}
                </span>
              </div>
            ))}
            {visibleReviewDeckFilterMenuItems.length > 0 && visibleReviewTagFilterMenuItems.length > 0 ? (
              <div className="review-filter-menu-divider" aria-hidden="true" />
            ) : null}
            {visibleReviewTagFilterMenuItems.map((tagItem) => (
              <div
                key={tagItem.key}
                id={getReviewFilterOptionId(tagItem.key)}
                className={reviewFilterChoiceClassName(tagItem, activeReviewFilterOptionKey)}
                role="option"
                aria-selected={tagItem.isSelected}
                data-review-filter-key={tagItem.key}
                onClick={() => handleReviewFilterSelect(tagItem.reviewFilter)}
              >
                <span className="review-filter-menu-item-slot" aria-hidden="true">
                  <span className={`review-filter-menu-item-check${tagItem.isSelected ? " review-filter-menu-item-check-visible" : ""}`}>
                    <ReviewFilterCheckIcon />
                  </span>
                </span>
                <span className="review-filter-menu-item-label">{tagItem.label}</span>
              </div>
            ))}
          </div>
          {reviewFilterMenuItems.length > 0 && hasVisibleReviewFilterChoices ? (
            <div className="review-filter-menu-divider" aria-hidden="true" />
          ) : null}
          {reviewFilterMenuItems.map((item) => (
            <Link
              key={item.key}
              className="review-filter-menu-entry review-filter-menu-entry-action"
              to={item.href}
              onClick={handleCloseMenu}
            >
              <span className="review-filter-menu-item-slot" aria-hidden="true">
                <ReviewFilterDecksIcon />
              </span>
              <span className="review-filter-menu-item-label">{item.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
