import { memo, useMemo, type ReactElement } from "react";
import { ReviewMathBlock } from "../screens/review/components/card/ReviewMathBlock";
import { splitEligibleReviewMathContent } from "../screens/review/components/card/reviewMathBlocks";

/** Keeps compact labels free of links and media controls inside their row action. */
export const MathText = memo(function MathText({ text }: Readonly<{ text: string }>): ReactElement {
  const segments = useMemo(() => text.includes("$") ? splitEligibleReviewMathContent(text) : null, [text]);
  if (segments === null) {
    return <>{text}</>;
  }

  return <>{segments.map((segment, index) => segment.kind === "prose"
    ? <span key={index}>{segment.value}</span>
    : <ReviewMathBlock
        key={index}
        compact
        delimitedSource={segment.delimitedSource}
        formulaSource={segment.value}
        inline={segment.inline}
      />)}</>;
});
