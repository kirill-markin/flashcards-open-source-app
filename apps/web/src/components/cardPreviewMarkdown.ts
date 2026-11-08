import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { normalizeReviewMarkdownForWeb } from "../screens/review/components/card/ReviewCardSide";
import { classifyReviewContentPresentation } from "../screens/review/components/card/reviewContentPresentation";
import {
  escapeRejectedReviewMathDollars,
  normalizeReviewPlainTextEscapedDollars,
  transformReviewMathBlocks,
} from "../screens/review/components/card/reviewMathBlocks";

/** Display formulas are rendered inline too, because a preview is one line of text. */
export type CardPreviewSegment =
  | Readonly<{ kind: "prose"; value: string }>
  | Readonly<{ kind: "formula"; delimitedSource: string; value: string }>;

const previewMarkdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const MARKDOWN_ESCAPED_PUNCTUATION_PATTERN = /\\([!-/:-@[-`{-~])/g;
const MARKDOWN_IMAGE_PATTERN = /!\[((?:\\.|[^\\\]])*)\]\((?:<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
const BLOCK_SEPARATOR_SEGMENT: CardPreviewSegment = { kind: "prose", value: " " };

function collapsePreviewWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

function previewImageLabel(altText: string, emptyImageAltText: string): string {
  const label = altText.trim();
  return label === "" ? emptyImageAltText : label;
}

function readNodeSourceText(source: string, node: Nodes): string {
  const startOffset = node.position?.start.offset;
  const endOffset = node.position?.end.offset;
  if (startOffset === undefined || endOffset === undefined) {
    throw new Error(`Card preview ${node.type} node has no source position`);
  }
  return source.slice(startOffset, endOffset);
}

function collectChildSegments(
  children: ReadonlyArray<Nodes>,
  source: string,
  emptyImageAltText: string,
  separator: ReadonlyArray<CardPreviewSegment>,
): ReadonlyArray<CardPreviewSegment> {
  return children.flatMap((child, index) => [
    ...(index === 0 ? [] : separator),
    ...collectPreviewSegments(child, source, emptyImageAltText),
  ]);
}

/**
 * Walks the tree Review renders: math nodes left after the review math transform are the
 * accepted formulas, and raw HTML stays literal text exactly as Review shows it.
 */
function collectPreviewSegments(node: Nodes, source: string, emptyImageAltText: string): ReadonlyArray<CardPreviewSegment> {
  switch (node.type) {
    case "inlineMath":
    case "math":
      return [{
        kind: "formula",
        delimitedSource: collapsePreviewWhitespace(readNodeSourceText(source, node)),
        value: node.value,
      }];
    case "text":
    case "inlineCode":
    case "code":
    case "html":
      return [{ kind: "prose", value: node.value }];
    case "image":
    case "imageReference":
      return [{ kind: "prose", value: previewImageLabel(node.alt ?? "", emptyImageAltText) }];
    case "break":
      return [BLOCK_SEPARATOR_SEGMENT];
    case "definition":
    case "footnoteDefinition":
    case "footnoteReference":
    case "thematicBreak":
    case "yaml":
      return [];
    case "root":
    case "blockquote":
    case "list":
    case "listItem":
    case "table":
    case "tableRow":
      return collectChildSegments(node.children, source, emptyImageAltText, [BLOCK_SEPARATOR_SEGMENT]);
    default:
      return collectChildSegments(node.children, source, emptyImageAltText, []);
  }
}

/** Merges adjacent prose, collapses whitespace to single spaces and trims the line ends. */
function normalizePreviewSegments(segments: ReadonlyArray<CardPreviewSegment>): ReadonlyArray<CardPreviewSegment> {
  const mergedSegments = segments.reduce<ReadonlyArray<CardPreviewSegment>>((merged, segment) => {
    const previousSegment = merged.at(-1);
    if (segment.kind === "prose" && previousSegment?.kind === "prose") {
      return [...merged.slice(0, -1), { kind: "prose", value: previousSegment.value + segment.value }];
    }
    return [...merged, segment];
  }, []);
  const lastIndex = mergedSegments.length - 1;

  return mergedSegments.flatMap((segment, index): ReadonlyArray<CardPreviewSegment> => {
    if (segment.kind === "formula") {
      return [segment];
    }
    const collapsedValue = collapsePreviewWhitespace(segment.value);
    const trimmedStart = index === 0 ? collapsedValue.trimStart() : collapsedValue;
    const value = index === lastIndex ? trimmedStart.trimEnd() : trimmedStart;
    return value === "" ? [] : [{ kind: "prose", value }];
  });
}

/**
 * One-line card text for compact rows: Markdown syntax is dropped, images become their alt text,
 * and the formulas Review accepts stay formulas. An empty side yields no segments.
 */
export function makeCardPreviewSegments(text: string, emptyImageAltText: string): ReadonlyArray<CardPreviewSegment> {
  if (classifyReviewContentPresentation(text) !== "markdown") {
    return normalizePreviewSegments([{ kind: "prose", value: normalizeReviewPlainTextEscapedDollars(text) }]);
  }

  const normalizedText = normalizeReviewMarkdownForWeb(text);
  if (normalizedText.includes("$") === false) {
    return normalizePreviewSegments(
      collectPreviewSegments(previewMarkdownProcessor.parse(normalizedText), normalizedText, emptyImageAltText),
    );
  }

  const markdownText = escapeRejectedReviewMathDollars(normalizedText);
  const tree = transformReviewMathBlocks(previewMarkdownProcessor.parse(markdownText), markdownText);
  return normalizePreviewSegments(collectPreviewSegments(tree, markdownText, emptyImageAltText));
}

/** Replaces inline Markdown images with their alt text, or `emptyImageAltText` when the alt is blank. */
export function replaceMarkdownImagesWithAltText(text: string, emptyImageAltText: string): string {
  return text.replace(MARKDOWN_IMAGE_PATTERN, (_image, altText: string) => previewImageLabel(
    altText.replace(MARKDOWN_ESCAPED_PUNCTUATION_PATTERN, "$1"),
    emptyImageAltText,
  ));
}
