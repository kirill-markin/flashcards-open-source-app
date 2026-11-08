import { memo, useMemo, type ReactElement } from "react";
import { useI18n } from "../i18n";
import { ReviewMathBlock } from "../screens/review/components/card/ReviewMathBlock";
import { makeCardPreviewSegments, type CardPreviewSegment } from "./cardPreviewMarkdown";

/** Keeps compact labels free of links and media controls inside their row action. */
export function CardPreviewSegments({ segments }: Readonly<{ segments: ReadonlyArray<CardPreviewSegment> }>): ReactElement {
  return <>{segments.map((segment, index) => segment.kind === "prose"
    ? <span key={index}>{segment.value}</span>
    : <ReviewMathBlock
        key={index}
        compact
        delimitedSource={segment.delimitedSource}
        formulaSource={segment.value}
        inline
      />)}</>;
}

/** Memoized because the preview parses Markdown and list rows re-render often. */
export const CardPreviewText = memo(function CardPreviewText({ text }: Readonly<{ text: string }>): ReactElement {
  const { t } = useI18n();
  const emptyImageAltText = t("common.image");
  const segments = useMemo(() => makeCardPreviewSegments(text, emptyImageAltText), [text, emptyImageAltText]);

  return <CardPreviewSegments segments={segments} />;
});
