import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import { Link } from "react-router";
import { useI18n } from "../../../i18n";
import { libraryTagsRoute } from "../../../routes";
import { useWorkspacePath } from "../../../useWorkspacePath";
import { ReviewTagChip } from "./ReviewCardTags";
import { ReviewTagIcon } from "./ReviewIcons";

// Firefox reports mouse wheel steps in lines rather than pixels.
const REVIEW_TAG_ROW_WHEEL_LINE_PX = 16;

type ReviewCardHeadTagsProps = Readonly<{
  onRequestTagFilter: (tag: string) => void;
  tags: ReadonlyArray<string>;
}>;

/** The tag icon that starts the card header and opens Library > Tags. */
export function ReviewCardTagsLink(): ReactElement {
  const { t } = useI18n();
  const workspacePath = useWorkspacePath();
  const label = t("settingsWorkspace.tags.title");

  return (
    <Link className="review-card-tags-link" to={workspacePath(libraryTagsRoute)} aria-label={label} title={label}>
      <ReviewTagIcon />
    </Link>
  );
}

/**
 * A plain mouse wheel only scrolls vertically, so over the row it moves the chips along the line until
 * they reach an end, and then the pane scrolls as usual. Trackpads, touch and Shift+wheel already scroll
 * sideways, and keyboard focus scrolls a chip into view.
 */
function useVerticalWheelScrollsRow(rowRef: RefObject<HTMLDivElement | null>, hasTags: boolean): void {
  useEffect(() => {
    const row = rowRef.current;
    if (row === null) {
      return undefined;
    }
    const scrolledRow: HTMLDivElement = row;

    function handleWheel(event: WheelEvent): void {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
        return;
      }

      const maxScrollPx = scrolledRow.scrollWidth - scrolledRow.clientWidth;
      // In a right-to-left row scrollLeft runs from 0 at the first tag to negative values.
      const scrolledPx = Math.abs(scrolledRow.scrollLeft);
      const isTowardLastTag = event.deltaY > 0;
      if (isTowardLastTag ? scrolledPx >= maxScrollPx - 1 : scrolledPx <= 1) {
        return;
      }

      event.preventDefault();
      const deltaPx = event.deltaMode === event.DOM_DELTA_LINE
        ? event.deltaY * REVIEW_TAG_ROW_WHEEL_LINE_PX
        : event.deltaMode === event.DOM_DELTA_PAGE ? event.deltaY * scrolledRow.clientWidth : event.deltaY;
      const directionSign = window.getComputedStyle(scrolledRow).direction === "rtl" ? -1 : 1;
      scrolledRow.scrollBy({ left: deltaPx * directionSign, behavior: "instant" });
    }

    // Passive listeners cannot cancel the pane's own vertical scroll.
    scrolledRow.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrolledRow.removeEventListener("wheel", handleWheel);
  }, [hasTags, rowRef]);
}

/**
 * The card header: the Library Tags link, then every tag chip on one horizontally scrolling line.
 * Keyed by card, so a new card starts from its first tag.
 */
export function ReviewCardHeadTags(props: ReviewCardHeadTagsProps): ReactElement {
  const { onRequestTagFilter, tags } = props;
  const { t } = useI18n();
  const rowRef = useRef<HTMLDivElement | null>(null);
  useVerticalWheelScrollsRow(rowRef, tags.length > 0);

  return (
    <>
      <ReviewCardTagsLink />
      {tags.length === 0 ? (
        <div className="review-pane-head-meta">
          <span className="tag-value-empty">{t("common.noTags")}</span>
        </div>
      ) : (
        <div className="review-pane-head-meta review-card-head-tags" ref={rowRef}>
          {tags.map((tag) => (
            <ReviewTagChip key={tag} onRequestTagFilter={onRequestTagFilter} tag={tag} />
          ))}
        </div>
      )}
    </>
  );
}
