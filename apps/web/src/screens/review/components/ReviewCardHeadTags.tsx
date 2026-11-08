import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import {
  AnchoredFloatingOverlay,
  useAnchoredFloatingHiddenTriggerDismiss,
  useAnchoredFloatingOutsidePointerDismiss,
} from "../../../floating";
import { useI18n } from "../../../i18n";
import { ReviewTagChip } from "./ReviewCardTags";

const REVIEW_TAG_OVERFLOW_MENU_OFFSET_PX = 8;
const REVIEW_TAG_OVERFLOW_MENU_VIEWPORT_PADDING_PX = 16;
const REVIEW_TAG_OVERFLOW_MENU_MAX_WIDTH_PX = 320;

type ReviewCardHeadTagsProps = Readonly<{
  isOverflowMenuOpen: boolean;
  onOverflowMenuOpenChange: (isOpen: boolean) => void;
  onRequestTagFilter: (tag: string) => void;
  tags: ReadonlyArray<string>;
}>;

/**
 * Whole chips that fit beside a trailing "+N" control; every chip fits when no control is needed.
 */
function countWholeChipsThatFit(
  chipWidths: ReadonlyArray<number>,
  overflowControlWidth: number,
  gapWidth: number,
  availableWidth: number,
): number {
  const allChipsWidth = chipWidths.reduce(
    (totalWidth, chipWidth, index) => totalWidth + chipWidth + (index > 0 ? gapWidth : 0),
    0,
  );
  if (allChipsWidth <= availableWidth) {
    return chipWidths.length;
  }

  let usedWidth = 0;
  let fittingChipsCount = 0;
  for (const chipWidth of chipWidths) {
    const nextUsedWidth = usedWidth + (fittingChipsCount > 0 ? gapWidth : 0) + chipWidth;
    if (nextUsedWidth + gapWidth + overflowControlWidth > availableWidth) {
      break;
    }
    usedWidth = nextUsedWidth;
    fittingChipsCount += 1;
  }

  return fittingChipsCount;
}

function readRowGapWidth(row: HTMLElement): number {
  const columnGap = window.getComputedStyle(row).columnGap;
  const gapWidth = Number.parseFloat(columnGap);
  if (!Number.isFinite(gapWidth)) {
    throw new Error(`Review card tag row has no pixel column-gap: "${columnGap}"`);
  }

  return gapWidth;
}

/**
 * The card header's one-line tag row: it never clips a chip, and tags that do not fit stay
 * reachable from the "+N" menu, where choosing one behaves exactly like its chip.
 */
export function ReviewCardHeadTags(props: ReviewCardHeadTagsProps): ReactElement {
  const { isOverflowMenuOpen, onOverflowMenuOpenChange, onRequestTagFilter, tags } = props;
  const { formatNumber, t } = useI18n();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const overflowTriggerId = useId();
  // Null until the row has a laid-out width; then every tag is rendered.
  const [visibleChipsCount, setVisibleChipsCount] = useState<number | null>(null);
  const tagsKey = JSON.stringify(tags);
  // The widest "+N" this card can show, so the reserved space always fits the real control.
  const widestOverflowLabel = t("reviewScreen.moreTags.label", { count: formatNumber(tags.length) });
  const visibleTags = visibleChipsCount === null ? tags : tags.slice(0, visibleChipsCount);
  const hiddenTags = visibleChipsCount === null ? [] : tags.slice(visibleChipsCount);
  const isMenuOpen = isOverflowMenuOpen && hiddenTags.length > 0;

  const closeMenu = useCallback(function closeMenu(): void {
    onOverflowMenuOpenChange(false);
  }, [onOverflowMenuOpenChange]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (row === null || measure === null) {
      return undefined;
    }
    const measuredRow: HTMLDivElement = row;
    const measuredLayer: HTMLDivElement = measure;

    function updateVisibleChipsCount(): void {
      const availableWidth = measuredRow.getBoundingClientRect().width;
      if (availableWidth === 0) {
        setVisibleChipsCount(null);
        return;
      }

      const chipWidths = [...measuredLayer.querySelectorAll<HTMLElement>("[data-review-tag-measure='chip']")]
        .map((chip) => chip.getBoundingClientRect().width);
      const overflowControl = measuredLayer.querySelector<HTMLElement>("[data-review-tag-measure='overflow']");
      if (overflowControl === null) {
        throw new Error("Review card tag row is missing its measured overflow control");
      }

      setVisibleChipsCount(countWholeChipsThatFit(
        chipWidths,
        overflowControl.getBoundingClientRect().width,
        readRowGapWidth(measuredRow),
        availableWidth,
      ));
    }

    updateVisibleChipsCount();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    // The measured layer also resizes when web fonts finish loading.
    const observer = new ResizeObserver(updateVisibleChipsCount);
    observer.observe(measuredRow);
    observer.observe(measuredLayer);
    return () => observer.disconnect();
  }, [tagsKey, widestOverflowLabel]);

  useEffect(() => {
    if (isOverflowMenuOpen && hiddenTags.length === 0) {
      onOverflowMenuOpenChange(false);
    }
  }, [hiddenTags.length, isOverflowMenuOpen, onOverflowMenuOpenChange]);

  // The controller owns the open state to pause review shortcuts, so it must not outlive this row.
  useEffect(() => () => onOverflowMenuOpenChange(false), [onOverflowMenuOpenChange]);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef: overflowTriggerRef,
    overlayRef: overflowMenuRef,
    enabled: isMenuOpen,
    onClose: closeMenu,
  });

  useAnchoredFloatingHiddenTriggerDismiss({
    triggerRef: overflowTriggerRef,
    enabled: isMenuOpen,
    onClose: closeMenu,
  });

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    overflowMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onOverflowMenuOpenChange(false);
        overflowTriggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen, onOverflowMenuOpenChange]);

  if (tags.length === 0) {
    return <span className="tag-value-empty">{t("common.noTags")}</span>;
  }

  return (
    <div className="review-card-head-tags" ref={rowRef}>
      {visibleTags.map((tag) => (
        <ReviewTagChip key={tag} onRequestTagFilter={onRequestTagFilter} tag={tag} />
      ))}
      {hiddenTags.length > 0 ? (
        <button
          ref={overflowTriggerRef}
          id={overflowTriggerId}
          className="badge review-metadata-chip review-tag-button"
          type="button"
          aria-expanded={isMenuOpen}
          aria-haspopup="true"
          aria-label={t("reviewScreen.moreTags.ariaLabel", { count: formatNumber(hiddenTags.length) })}
          data-testid="review-card-tags-overflow"
          onClick={(event) => {
            if (event.detail > 0 && isMenuOpen) {
              event.currentTarget.blur();
            }
            onOverflowMenuOpenChange(!isMenuOpen);
          }}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.stopPropagation();
            }
          }}
        >
          {t("reviewScreen.moreTags.label", { count: formatNumber(hiddenTags.length) })}
        </button>
      ) : null}
      <div className="review-card-head-tags-measure" ref={measureRef} aria-hidden="true">
        {tags.map((tag) => (
          <button
            key={tag}
            className="badge review-metadata-chip review-tag-button"
            type="button"
            tabIndex={-1}
            data-review-tag-measure="chip"
          >
            {tag}
          </button>
        ))}
        <button
          className="badge review-metadata-chip review-tag-button"
          type="button"
          tabIndex={-1}
          data-review-tag-measure="overflow"
        >
          {widestOverflowLabel}
        </button>
      </div>
      <AnchoredFloatingOverlay
        isOpen={isMenuOpen}
        referenceRef={overflowTriggerRef}
        floatingRef={overflowMenuRef}
        placement="bottom-start"
        viewportPaddingPx={REVIEW_TAG_OVERFLOW_MENU_VIEWPORT_PADDING_PX}
        offsetPx={REVIEW_TAG_OVERFLOW_MENU_OFFSET_PX}
        minimumWidth={null}
        maxWidthPx={REVIEW_TAG_OVERFLOW_MENU_MAX_WIDTH_PX}
        maxHeightPx={null}
        className="review-filter-menu review-tag-overflow-menu"
        id={null}
        role="group"
        ariaLabel={null}
        ariaLabelledBy={overflowTriggerId}
        ariaDescribedBy={null}
        ariaModal={null}
      >
        {hiddenTags.map((tag) => (
          <button
            key={tag}
            className="review-filter-menu-entry review-tag-overflow-entry"
            type="button"
            aria-haspopup="dialog"
            aria-label={`${t("deckDetail.actions.openReview")}: ${tag}`}
            title={tag}
            data-testid="review-card-tags-overflow-entry"
            onClick={(event) => {
              onOverflowMenuOpenChange(false);
              // From the keyboard, the tag dialog returns focus to the trigger instead of the removed entry.
              if (event.detail === 0) {
                overflowTriggerRef.current?.focus();
              }
              onRequestTagFilter(tag);
            }}
          >
            <span className="review-filter-menu-item-label">{tag}</span>
          </button>
        ))}
      </AnchoredFloatingOverlay>
    </div>
  );
}
