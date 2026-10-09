import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";

type ReviewCardTagsProps = Readonly<{
  onRequestTagFilter: (tag: string) => void;
  tags: ReadonlyArray<string>;
}>;

export function ReviewCardTags(props: ReviewCardTagsProps): ReactElement {
  const { onRequestTagFilter, tags } = props;
  const { t } = useI18n();

  if (tags.length === 0) {
    return <span className="tag-value-empty">{t("common.noTags")}</span>;
  }

  return (
    <>
      {tags.map((tag) => (
        <button
          className="badge review-metadata-chip review-tag-button"
          key={tag}
          type="button"
          aria-haspopup="dialog"
          aria-label={`${t("deckDetail.actions.openReview")}: ${tag}`}
          // A pointer click (detail > 0) releases focus so Space and 1-4 reach the review shortcuts again.
          onClick={(event) => {
            if (event.detail > 0) {
              event.currentTarget.blur();
            }
            onRequestTagFilter(tag);
          }}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.stopPropagation();
            }
          }}
        >
          {tag}
        </button>
      ))}
    </>
  );
}
