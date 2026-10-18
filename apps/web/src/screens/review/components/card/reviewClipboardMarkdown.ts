import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { parseManagedMediaUrlReference } from "../../../../media/managedMediaMarkdown";
import { escapeRejectedReviewMathDollars } from "./reviewMathBlocks";

const clipboardMarkdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

type ClipboardReplacement = Readonly<{
  startIndex: number;
  endIndex: number;
  text: string;
}>;

type ClipboardMediaLabels = Readonly<{
  image: string;
  attachment: string;
}>;

type ClipboardSourceRange = Readonly<{
  startIndex: number;
  endIndex: number;
}>;

function readClipboardSourceOffsets(source: string, parsedSource: string): ReadonlyArray<number> {
  const offsets: Array<number> = [0];
  let sourceIndex = 0;
  for (let index = 0; index < parsedSource.length; index += 1) {
    if (parsedSource[index] === source[sourceIndex]) {
      sourceIndex += 1;
    } else if (parsedSource[index] !== "\\" || parsedSource[index + 1] !== "$" || source[sourceIndex] !== "$") {
      throw new Error("Review clipboard math escaping changed a non-delimiter source character");
    }
    offsets.push(sourceIndex);
  }
  if (sourceIndex !== source.length) {
    throw new Error("Review clipboard math escaping did not preserve the complete source");
  }
  return offsets;
}

function readBackslashMathRanges(
  source: string,
  tree: Root,
  sourceOffsets: ReadonlyArray<number>,
): ReadonlyArray<ClipboardSourceRange> {
  const codeRanges: Array<ClipboardSourceRange> = [];
  visit(tree, (node) => {
    if (node.type === "code" || node.type === "inlineCode" || node.type === "math" || node.type === "inlineMath") {
      codeRanges.push(requireClipboardSourceRange(node, sourceOffsets));
    }
  });

  const ranges: Array<ClipboardSourceRange> = [];
  let protectedIndex = 0;
  let index = 0;
  while (index < source.length) {
    const protectedRange = codeRanges[protectedIndex];
    if (protectedRange !== undefined && index >= protectedRange.startIndex) {
      index = protectedRange.endIndex;
      protectedIndex += 1;
      continue;
    }
    if (source[index] !== "\\") {
      index += 1;
      continue;
    }

    const opening = source[index + 1];
    const closing = opening === "(" ? "\\)" : opening === "[" ? "\\]" : null;
    const end = closing === null ? -1 : source.indexOf(closing, index + 2);
    if (end !== -1) {
      ranges.push({ startIndex: index, endIndex: end + 2 });
      index = end + 2;
      while (codeRanges[protectedIndex] !== undefined && codeRanges[protectedIndex].endIndex <= index) {
        protectedIndex += 1;
      }
    } else {
      index += 2;
    }
  }
  return ranges;
}

function requireClipboardSourceRange(node: Nodes, sourceOffsets: ReadonlyArray<number>): ClipboardSourceRange {
  const parsedStart = node.position?.start.offset;
  const parsedEnd = node.position?.end.offset;
  const startIndex = parsedStart === undefined ? undefined : sourceOffsets[parsedStart];
  const endIndex = parsedEnd === undefined ? undefined : sourceOffsets[parsedEnd];
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error(`Review clipboard parser returned a ${node.type} without source offsets`);
  }
  return { startIndex, endIndex };
}

function readClipboardLinkLabel(node: Nodes): string {
  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }
  if ("value" in node) {
    return node.value;
  }
  return "children" in node ? node.children.map(readClipboardLinkLabel).join("") : "";
}

export function reviewSideMarkdownForClipboard(source: string, labels: ClipboardMediaLabels): string {
  const parsedSource = escapeRejectedReviewMathDollars(source);
  const sourceOffsets = readClipboardSourceOffsets(source, parsedSource);
  const tree = clipboardMarkdownProcessor.parse(parsedSource);
  const backslashMathRanges = readBackslashMathRanges(source, tree, sourceOffsets);
  const definitions = new Map<string, string>();
  const replacements: Array<ClipboardReplacement> = [];

  visit(tree, "definition", (node) => {
    const range = requireClipboardSourceRange(node, sourceOffsets);
    if (backslashMathRanges.some((math) => range.startIndex >= math.startIndex && range.endIndex <= math.endIndex)) {
      return;
    }
    if (definitions.has(node.identifier) === false) {
      definitions.set(node.identifier, node.url);
    }
  });

  visit(tree, (node) => {
    if (node.type !== "image" && node.type !== "link" && node.type !== "imageReference" && node.type !== "linkReference") {
      return;
    }

    const destination = node.type === "image" || node.type === "link"
      ? node.url
      : definitions.get(node.identifier);
    if (parseManagedMediaUrlReference(destination) === null) {
      return;
    }

    const { startIndex, endIndex } = requireClipboardSourceRange(node, sourceOffsets);
    if (backslashMathRanges.some((math) => startIndex >= math.startIndex && endIndex <= math.endIndex)) {
      return SKIP;
    }

    const kind = node.type === "image" || node.type === "imageReference" ? labels.image : labels.attachment;
    const sourceLabel = readClipboardLinkLabel(node).trim();
    const label = sourceLabel === destination ? "" : sourceLabel;
    replacements.push({
      startIndex,
      endIndex,
      text: label === "" ? `[${kind}]` : `[${kind}: ${label}]`,
    });
    return SKIP;
  });

  // Slice the original source: serialization would normalize Markdown, math and whitespace.
  let result = "";
  let cursor = 0;
  for (const replacement of replacements) {
    result += source.slice(cursor, replacement.startIndex) + replacement.text;
    cursor = replacement.endIndex;
  }
  return result + source.slice(cursor);
}
