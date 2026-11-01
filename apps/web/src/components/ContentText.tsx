import { memo, type ReactElement } from "react";
import { ReviewCardMarkdown } from "../screens/review/components/card/ReviewCardSide";
import { classifyReviewContentPresentation } from "../screens/review/components/card/reviewContentPresentation";
import { normalizeReviewPlainTextEscapedDollars } from "../screens/review/components/card/reviewMathBlocks";

export const ContentText = memo(function ContentText(props: Readonly<{
  text: string;
  workspaceId: string | null;
  localReadVersion: number;
}>): ReactElement {
  const isMarkdown = classifyReviewContentPresentation(props.text) === "markdown";
  return (
    <div className={`content-text${isMarkdown ? " content-text-markdown" : ""}`}>
      {isMarkdown
        ? <ReviewCardMarkdown {...props} />
        : normalizeReviewPlainTextEscapedDollars(props.text)}
    </div>
  );
});
