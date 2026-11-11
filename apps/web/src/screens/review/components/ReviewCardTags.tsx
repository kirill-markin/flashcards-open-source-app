import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";

type ReviewCardTagsProps = Readonly<{
  onRequestTagFilter: (tag: string) => void;
  tags: ReadonlyArray<string>;
}>;

type ReviewTagChipProps = Readonly<{
  onRequestTagFilter: (tag: string) => void;
  tag: string;
}>;

export function ReviewTagChip(props: ReviewTagChipProps): ReactElement {
  const { onRequestTagFilter, tag } = props;
  const { t } = useI18n();

  return (
    <button
      className="badge review-metadata-chip review-tag-button"
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
  );
}

export function ReviewCardTags(props: ReviewCardTagsProps): ReactElement {
  const { onRequestTagFilter, tags } = props;
  const { t } = useI18n();

  if (tags.length === 0) {
    return <span className="tag-value-empty">{t("common.noTags")}</span>;
  }

  return (
    <>
      {tags.map((tag) => (
        <ReviewTagChip key={tag} onRequestTagFilter={onRequestTagFilter} tag={tag} />
      ))}
    </>
  );
}
