import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";

type ReviewCardTagsProps = Readonly<{
  tags: ReadonlyArray<string>;
}>;

export function ReviewCardTags(props: ReviewCardTagsProps): ReactElement {
  const { tags } = props;
  const { t } = useI18n();

  if (tags.length === 0) {
    return <span className="tag-value-empty">{t("common.noTags")}</span>;
  }

  return (
    <>
      {tags.map((tag) => (
        <span className="badge review-metadata-chip" key={tag}>{tag}</span>
      ))}
    </>
  );
}
