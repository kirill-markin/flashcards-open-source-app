import type { ReactElement } from "react";
import { Link } from "react-router";
import { useI18n } from "../../../i18n";
import { libraryTagsRoute } from "../../../routes";
import { useWorkspacePath } from "../../../useWorkspacePath";
import { ReviewCardTags } from "./ReviewCardTags";
import { ReviewTagIcon } from "./ReviewIcons";

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
 * The card header: the Library Tags link, then every tag chip on one horizontally scrolling line.
 * Keyed by card, so a new card starts from its first tag.
 */
export function ReviewCardHeadTags(props: ReviewCardHeadTagsProps): ReactElement {
  const { onRequestTagFilter, tags } = props;

  return (
    <>
      <ReviewCardTagsLink />
      <div className="review-pane-head-meta">
        <ReviewCardTags onRequestTagFilter={onRequestTagFilter} tags={tags} />
      </div>
    </>
  );
}
