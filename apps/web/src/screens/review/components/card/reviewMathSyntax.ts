import type { ElementContent, Properties } from "hast";
import type { Code, Definition, Image, ImageReference, Link, LinkReference, Root } from "mdast";
import type { InlineMath, Math } from "mdast-util-math";
import { parse as parseMicromark, postprocess, preprocess } from "micromark";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified, type Plugin } from "unified";
import type { Parent } from "unist";
import { visit } from "unist-util-visit";

const REVIEW_DISPLAY_MATH_DELIMITER_PATTERN = /^((?:(?: {0,3}>[\t ]?)|(?: {0,3}(?:[-+*]|\d+[.)])[\t ]+))*[\t ]*)\$\$([\t ]*)$/;
const REVIEW_FENCED_CODE_START_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const REVIEW_MATH_SOURCE_PROPERTY = "dataReviewMathSource";
const REVIEW_MATH_DELIMITED_SOURCE_PROPERTY = "dataReviewMathDelimitedSource";
const REVIEW_PLACEHOLDER_START_CODE_POINT = 0x00A1;
const REVIEW_PLACEHOLDER_END_CODE_POINT = 0xFFFD;
const REVIEW_PLACEHOLDER_CHARACTER_PATTERN = /^[\p{P}\p{S}]$/u;

type ReviewMathNode = InlineMath | Math;
type ReviewMathSyntaxOptions = Readonly<{
  preparedSource: PreparedReviewMathSource;
}>;
type SourceLine = Readonly<{
  content: string;
  contentEndOffset: number;
  endOffset: number;
  startOffset: number;
}>;
type DisplayDelimiterLine = SourceLine & Readonly<{
  blockquoteDepth: number;
  delimiterOffset: number;
  listItemDepth: number;
}>;
type ProtectedSourceRange = Readonly<{
  endOffset: number;
  startOffset: number;
}>;
type ImageLabelSourceRange = ProtectedSourceRange & Readonly<{
  imageEndOffset: number;
  imageStartOffset: number;
}>;
type MicromarkToken = ReturnType<typeof postprocess>[number][1];
type MarkdownProtectedSourceRange = ProtectedSourceRange & Readonly<{
  ownerStartOffset: number;
}>;
type ReferenceLookupSourceRange = ProtectedSourceRange & Readonly<{
  identifier: string;
  usesVisibleLabelMath: boolean;
}>;
type SourceScopeRange = ProtectedSourceRange & Readonly<{
  key: string;
}>;
type ReviewMathSourceScopes = Readonly<{
  display: ReadonlyArray<SourceScopeRange>;
  inline: ReadonlyArray<SourceScopeRange>;
}>;
type RecognizedReviewMathSourceRange = ReviewMathSourceRange & Readonly<{
  presentation: "display" | "inline";
}>;
type DecodedImageLabelMathRange = RecognizedReviewMathSourceRange & Readonly<{
  decodedEndOffset: number;
  decodedStartOffset: number;
}>;
type DecodedImageLabel = Readonly<{
  mathRanges: ReadonlyArray<DecodedImageLabelMathRange>;
  text: string;
}>;

export type ReviewMathSourceRange = Readonly<{
  delimitedSource: string;
  endOffset: number;
  source: string;
  startOffset: number;
}>;

export type PreparedReviewMathSource = Readonly<{
  escapedDollarPlaceholder: string;
  literalDollarPlaceholder: string;
  recognizedRanges: ReadonlyArray<RecognizedReviewMathSourceRange>;
  source: string;
  text: string;
}>;

const reviewMarkdownBoundaryParser = unified().use(remarkParse).use(remarkGfm);
const reviewCanonicalMathParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function readSourceLines(source: string): ReadonlyArray<SourceLine> {
  const lines: Array<SourceLine> = [];
  let startOffset = 0;

  while (startOffset < source.length) {
    let contentEndOffset = startOffset;
    while (
      contentEndOffset < source.length
      && source[contentEndOffset] !== "\r"
      && source[contentEndOffset] !== "\n"
    ) {
      contentEndOffset += 1;
    }

    let endOffset = contentEndOffset;
    if (source[endOffset] === "\r") {
      endOffset += 1;
      if (source[endOffset] === "\n") {
        endOffset += 1;
      }
    } else if (source[endOffset] === "\n") {
      endOffset += 1;
    }

    lines.push({
      content: source.slice(startOffset, contentEndOffset),
      contentEndOffset,
      endOffset,
      startOffset,
    });
    startOffset = endOffset;
  }

  return lines;
}

function readNodeSourceRange(node: Readonly<{ position?: ReviewMathNode["position"] }>): ProtectedSourceRange {
  const startOffset = node.position?.start.offset;
  const endOffset = node.position?.end.offset;
  if (startOffset === undefined || endOffset === undefined) {
    throw new Error("Review markdown node is missing source offsets");
  }

  return { startOffset, endOffset };
}

function readMicromarkTokenSourceRange(token: MicromarkToken): ProtectedSourceRange {
  const startOffset = token.start.offset;
  const endOffset = token.end.offset;
  if (startOffset === undefined || endOffset === undefined) {
    throw new Error(`Review micromark token is missing source offsets: tokenType=${token.type}`);
  }

  return { startOffset, endOffset };
}

function readImageLabelSourceRanges(source: string): ReadonlyArray<ImageLabelSourceRange> {
  reviewMarkdownBoundaryParser.freeze();
  const extensions = reviewMarkdownBoundaryParser.data().micromarkExtensions ?? [];
  const events = postprocess(
    parseMicromark({ extensions }).document().write(preprocess()(source, undefined, true)),
  );
  const activeImages: Array<{
    labelRange: ProtectedSourceRange | null;
    token: MicromarkToken;
  }> = [];
  const sourceRanges: Array<ImageLabelSourceRange> = [];

  for (const event of events) {
    const [phase, token] = event;
    if (phase === "enter" && token.type === "image") {
      activeImages.push({ labelRange: null, token });
      continue;
    }

    if (phase === "enter" && token.type === "labelText") {
      const activeImage = activeImages[activeImages.length - 1];
      if (activeImage !== undefined && activeImage.labelRange === null) {
        activeImage.labelRange = readMicromarkTokenSourceRange(token);
      }
      continue;
    }

    if (phase !== "exit" || token.type !== "image") {
      continue;
    }

    const activeImage = activeImages.pop();
    if (activeImage === undefined || activeImage.token !== token) {
      throw new Error("Review micromark image token stack is inconsistent");
    }
    if (activeImage.labelRange === null) {
      throw new Error("Review micromark image token has no label range");
    }

    const imageRange = readMicromarkTokenSourceRange(token);
    sourceRanges.push({
      ...activeImage.labelRange,
      imageEndOffset: imageRange.endOffset,
      imageStartOffset: imageRange.startOffset,
    });
  }

  if (activeImages.length !== 0) {
    throw new Error(`Review micromark image token stack is not empty: count=${activeImages.length}`);
  }

  return sourceRanges;
}

function isFencedCodeNode(node: Code, source: string): boolean {
  const sourceRange = readNodeSourceRange(node);
  const nodeSource = source.slice(sourceRange.startOffset, sourceRange.endOffset);
  const firstLineEndingIndex = nodeSource.search(/[\r\n]/);
  const openingLine = firstLineEndingIndex === -1
    ? nodeSource
    : nodeSource.slice(0, firstLineEndingIndex);
  const openingMatch = REVIEW_FENCED_CODE_START_PATTERN.exec(openingLine);
  if (openingMatch === null) {
    return false;
  }

  const fenceInfo = openingMatch[2]?.trim() ?? "";
  if (fenceInfo !== "") {
    return node.lang !== null && node.lang !== undefined;
  }

  const firstValueLine = node.value.split(/\r?\n/, 1)[0] ?? "";
  return firstValueLine !== openingLine.trimStart();
}

function readLinkNonTextSourceRanges(
  node: Link | LinkReference,
  source: string,
): ReadonlyArray<MarkdownProtectedSourceRange> {
  const linkRange = readNodeSourceRange(node);
  if (source[linkRange.startOffset] !== "[") {
    return [{ ...linkRange, ownerStartOffset: linkRange.startOffset }];
  }

  const protectedRanges: Array<MarkdownProtectedSourceRange> = [];
  let protectedStartOffset = linkRange.startOffset;

  for (const child of node.children) {
    const childRange = readNodeSourceRange(child);
    if (protectedStartOffset < childRange.startOffset) {
      protectedRanges.push({
        endOffset: childRange.startOffset,
        ownerStartOffset: linkRange.startOffset,
        startOffset: protectedStartOffset,
      });
    }

    protectedStartOffset = childRange.endOffset;
  }

  if (protectedStartOffset < linkRange.endOffset) {
    protectedRanges.push({
      endOffset: linkRange.endOffset,
      ownerStartOffset: linkRange.startOffset,
      startOffset: protectedStartOffset,
    });
  }

  return protectedRanges;
}

function readImageVisibleLabelSourceRange(
  node: Image | ImageReference,
  imageLabelRanges: ReadonlyArray<ImageLabelSourceRange>,
): ProtectedSourceRange {
  const imageRange = readNodeSourceRange(node);
  const labelRange = imageLabelRanges.find((sourceRange) => (
    sourceRange.imageStartOffset === imageRange.startOffset
    && sourceRange.imageEndOffset === imageRange.endOffset
  ));
  if (labelRange === undefined) {
    throw new Error(
      `Review image label token range is unavailable: startOffset=${imageRange.startOffset}, endOffset=${imageRange.endOffset}`,
    );
  }

  return {
    startOffset: labelRange.startOffset,
    endOffset: labelRange.endOffset,
  };
}

function readImageNonTextSourceRanges(
  node: Image | ImageReference,
  source: string,
  imageLabelRanges: ReadonlyArray<ImageLabelSourceRange>,
): ReadonlyArray<MarkdownProtectedSourceRange> {
  const imageRange = readNodeSourceRange(node);
  const labelRange = readImageVisibleLabelSourceRange(node, imageLabelRanges);
  const labelSource = source.slice(labelRange.startOffset, labelRange.endOffset);
  const labelProtectedRanges = readMathProtectedSourceRanges(labelSource).map((sourceRange) => ({
    endOffset: sourceRange.endOffset + labelRange.startOffset,
    ownerStartOffset: sourceRange.ownerStartOffset + labelRange.startOffset,
    startOffset: sourceRange.startOffset + labelRange.startOffset,
  }));

  return [
    {
      endOffset: labelRange.startOffset,
      ownerStartOffset: imageRange.startOffset,
      startOffset: imageRange.startOffset,
    },
    {
      endOffset: imageRange.endOffset,
      ownerStartOffset: imageRange.startOffset,
      startOffset: labelRange.endOffset,
    },
    ...labelProtectedRanges,
  ].filter((sourceRange) => sourceRange.startOffset < sourceRange.endOffset);
}

function readMathProtectedSourceRanges(source: string): ReadonlyArray<MarkdownProtectedSourceRange> {
  const tree = reviewMarkdownBoundaryParser.parse(source);
  const imageLabelRanges = readImageLabelSourceRanges(source);
  const protectedRanges: Array<MarkdownProtectedSourceRange> = [];

  visit(tree, [
    "code",
    "inlineCode",
    "link",
    "linkReference",
    "image",
    "imageReference",
    "definition",
  ], (node) => {
    if (node.type === "code" && isFencedCodeNode(node, source) === false) {
      return;
    }

    if (node.type === "link" || node.type === "linkReference") {
      protectedRanges.push(...readLinkNonTextSourceRanges(node, source));
      return;
    }

    if (node.type === "image" || node.type === "imageReference") {
      protectedRanges.push(...readImageNonTextSourceRanges(node, source, imageLabelRanges));
      return;
    }

    const sourceRange = readNodeSourceRange(node);
    protectedRanges.push({ ...sourceRange, ownerStartOffset: sourceRange.startOffset });
  });

  return protectedRanges;
}

function readMathSourceScopes(source: string): ReviewMathSourceScopes {
  const tree = reviewMarkdownBoundaryParser.parse(source);
  const imageLabelRanges = readImageLabelSourceRanges(source);
  const displayScopes: Array<SourceScopeRange> = [];
  const inlineScopes: Array<SourceScopeRange> = [];

  visit(tree, ["paragraph", "heading", "tableCell", "link", "linkReference"], (node) => {
    const sourceRange = readNodeSourceRange(node);
    inlineScopes.push({
      ...sourceRange,
      key: `${node.type}:${sourceRange.startOffset}:${sourceRange.endOffset}`,
    });
  });

  visit(tree, ["image", "imageReference"], (node) => {
    const sourceRange = readImageVisibleLabelSourceRange(node, imageLabelRanges);
    inlineScopes.push({
      ...sourceRange,
      key: `${node.type}:${sourceRange.startOffset}:${sourceRange.endOffset}`,
    });
  });

  visit(tree, ["blockquote", "listItem"], (node) => {
    const sourceRange = readNodeSourceRange(node);
    displayScopes.push({
      ...sourceRange,
      key: `${node.type}:${sourceRange.startOffset}:${sourceRange.endOffset}`,
    });
  });

  return { display: displayScopes, inline: inlineScopes };
}

function isOffsetProtected(offset: number, protectedRanges: ReadonlyArray<ProtectedSourceRange>): boolean {
  return protectedRanges.some((sourceRange) => (
    sourceRange.startOffset <= offset && sourceRange.endOffset > offset
  ));
}

function readDisplayContainerDepths(containerPrefix: string): Readonly<{
  blockquoteDepth: number;
  listItemDepth: number;
}> {
  let blockquoteDepth = 0;
  let listItemDepth = 0;
  let remainingPrefix = containerPrefix;

  while (remainingPrefix !== "") {
    const blockquoteMatch = /^ {0,3}>[\t ]?/.exec(remainingPrefix);
    if (blockquoteMatch !== null) {
      blockquoteDepth += 1;
      remainingPrefix = remainingPrefix.slice(blockquoteMatch[0].length);
      continue;
    }

    const listItemMatch = /^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/.exec(remainingPrefix);
    if (listItemMatch !== null) {
      listItemDepth += 1;
      remainingPrefix = remainingPrefix.slice(listItemMatch[0].length);
      continue;
    }

    if (/^[\t ]+$/.test(remainingPrefix)) {
      break;
    }

    throw new Error(`Review display math container prefix is invalid: prefix=${containerPrefix}`);
  }

  return { blockquoteDepth, listItemDepth };
}

function readDisplayDelimiterLine(line: SourceLine): DisplayDelimiterLine | null {
  const delimiterMatch = REVIEW_DISPLAY_MATH_DELIMITER_PATTERN.exec(line.content);
  if (delimiterMatch === null) {
    return null;
  }

  const containerPrefix = delimiterMatch[1] ?? "";
  const containerDepths = readDisplayContainerDepths(containerPrefix);

  return {
    ...line,
    ...containerDepths,
    delimiterOffset: line.startOffset + containerPrefix.length,
  };
}

function stripDisplayBlockquotePrefix(content: string, blockquoteDepth: number): string {
  let strippedContent = content;

  for (let depth = 0; depth < blockquoteDepth; depth += 1) {
    const prefixMatch = /^ {0,3}>[\t ]?/.exec(strippedContent);
    if (prefixMatch === null) {
      return strippedContent;
    }

    strippedContent = strippedContent.slice(prefixMatch[0].length);
  }

  return strippedContent;
}

function readDisplayMathBodySource(
  source: string,
  openingDelimiterLine: DisplayDelimiterLine,
  closingDelimiterLine: DisplayDelimiterLine,
): string {
  const bodyEndOffset = readDisplayBodyEndOffset(source, closingDelimiterLine.startOffset);
  const bodySource = source.slice(openingDelimiterLine.endOffset, bodyEndOffset);
  if (openingDelimiterLine.blockquoteDepth === 0) {
    return bodySource;
  }

  return readSourceLines(bodySource).map((line) => (
    `${stripDisplayBlockquotePrefix(line.content, openingDelimiterLine.blockquoteDepth)}${bodySource.slice(line.contentEndOffset, line.endOffset)}`
  )).join("");
}

function readInlineSourceScopeKey(
  offset: number,
  sourceScopes: ReadonlyArray<SourceScopeRange>,
  opaqueBodyStartOffset: number | null,
): string {
  const containingScopes = sourceScopes
    .filter((sourceScope) => (
      sourceScope.startOffset <= offset
      && sourceScope.endOffset > offset
      && (opaqueBodyStartOffset === null || sourceScope.startOffset <= opaqueBodyStartOffset)
    ))
    .sort((left, right) => (
      (left.endOffset - left.startOffset) - (right.endOffset - right.startOffset)
    ));

  return containingScopes[0]?.key ?? "root";
}

function readDisplaySourceScopeKeys(
  offset: number,
  sourceScopes: ReadonlyArray<SourceScopeRange>,
  opaqueBodyRanges: ReadonlyArray<ProtectedSourceRange>,
): ReadonlyArray<string> {
  return sourceScopes
    .filter((sourceScope) => {
      const containsOffset = sourceScope.startOffset <= offset && sourceScope.endOffset > offset;
      const startsInFormulaBody = opaqueBodyRanges.some((bodyRange) => (
        sourceScope.startOffset >= bodyRange.startOffset
        && sourceScope.startOffset < bodyRange.endOffset
      ));

      return containsOffset && startsInFormulaBody === false;
    })
    .sort((left, right) => (
      left.startOffset - right.startOffset || right.endOffset - left.endOffset
    ))
    .map((sourceScope) => sourceScope.key);
}

function readDisplayContainerIdentity(
  delimiterLine: DisplayDelimiterLine,
  sourceScopes: ReadonlyArray<SourceScopeRange>,
  opaqueBodyRanges: ReadonlyArray<ProtectedSourceRange>,
): string {
  return JSON.stringify([
    delimiterLine.blockquoteDepth,
    readDisplaySourceScopeKeys(
      delimiterLine.delimiterOffset,
      sourceScopes,
      opaqueBodyRanges,
    ),
  ]);
}

function isSourceLineProtectedOutsideFormulaBodies(
  line: SourceLine,
  protectedRanges: ReadonlyArray<ProtectedSourceRange>,
  opaqueBodyRanges: ReadonlyArray<ProtectedSourceRange>,
): boolean {
  return protectedRanges.some((sourceRange) => (
    sourceRange.startOffset < line.endOffset
    && sourceRange.endOffset > line.startOffset
    && opaqueBodyRanges.every((bodyRange) => (
      sourceRange.startOffset < bodyRange.startOffset
      || sourceRange.startOffset >= bodyRange.endOffset
    ))
  ));
}

function isMatchingDisplayClosingDelimiter(
  openingDelimiterLine: DisplayDelimiterLine,
  closingDelimiterLine: DisplayDelimiterLine,
  sourceScopes: ReadonlyArray<SourceScopeRange>,
  opaqueBodyRanges: ReadonlyArray<ProtectedSourceRange>,
): boolean {
  if (
    closingDelimiterLine.blockquoteDepth !== openingDelimiterLine.blockquoteDepth
    || closingDelimiterLine.listItemDepth !== 0
  ) {
    return false;
  }

  const currentBodyRange = {
    startOffset: openingDelimiterLine.endOffset,
    endOffset: closingDelimiterLine.startOffset,
  };
  const openingIdentity = readDisplayContainerIdentity(
    openingDelimiterLine,
    sourceScopes,
    opaqueBodyRanges,
  );
  const closingIdentity = readDisplayContainerIdentity(
    closingDelimiterLine,
    sourceScopes,
    [...opaqueBodyRanges, currentBodyRange],
  );

  return openingIdentity === closingIdentity;
}

function isEscapedCharacter(source: string, offset: number): boolean {
  let precedingBackslashCount = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    precedingBackslashCount += 1;
  }

  return precedingBackslashCount % 2 === 1;
}

function readFullReferenceIdentifierSourceRange(
  node: LinkReference | ImageReference,
  source: string,
): ProtectedSourceRange {
  const nodeRange = readNodeSourceRange(node);
  const closingBracketOffset = nodeRange.endOffset - 1;
  if (source[closingBracketOffset] !== "]") {
    throw new Error(`Review reference identifier closing bracket is unavailable: startOffset=${nodeRange.startOffset}`);
  }

  for (let offset = closingBracketOffset - 1; offset >= nodeRange.startOffset; offset -= 1) {
    if (source[offset] === "[" && isEscapedCharacter(source, offset) === false) {
      return {
        startOffset: offset + 1,
        endOffset: closingBracketOffset,
      };
    }
  }

  throw new Error(`Review reference identifier opening bracket is unavailable: startOffset=${nodeRange.startOffset}`);
}

function readReferenceVisibleLabelSourceRange(
  node: LinkReference,
  source: string,
): ProtectedSourceRange {
  const nodeRange = readNodeSourceRange(node);
  const openingBracketOffset = source.indexOf("[", nodeRange.startOffset);
  if (openingBracketOffset < nodeRange.startOffset || openingBracketOffset >= nodeRange.endOffset) {
    throw new Error(`Review reference label opening bracket is unavailable: startOffset=${nodeRange.startOffset}`);
  }

  const closingBracketOffset = node.referenceType === "shortcut"
    ? nodeRange.endOffset - 1
    : node.referenceType === "collapsed"
      ? nodeRange.endOffset - 3
      : readFullReferenceIdentifierSourceRange(node, source).startOffset - 2;
  if (source[closingBracketOffset] !== "]") {
    throw new Error(`Review reference label closing bracket is unavailable: startOffset=${nodeRange.startOffset}`);
  }

  return {
    startOffset: openingBracketOffset + 1,
    endOffset: closingBracketOffset,
  };
}

function readDefinitionLabelSourceRange(node: Definition, source: string): ProtectedSourceRange {
  const nodeRange = readNodeSourceRange(node);
  const openingBracketOffset = source.indexOf("[", nodeRange.startOffset);
  if (openingBracketOffset < nodeRange.startOffset || openingBracketOffset >= nodeRange.endOffset) {
    throw new Error(`Review definition label opening bracket is unavailable: startOffset=${nodeRange.startOffset}`);
  }

  for (let offset = openingBracketOffset + 1; offset < nodeRange.endOffset - 1; offset += 1) {
    if (
      source[offset] === "]"
      && source[offset + 1] === ":"
      && isEscapedCharacter(source, offset) === false
    ) {
      return {
        startOffset: openingBracketOffset + 1,
        endOffset: offset,
      };
    }
  }

  throw new Error(`Review definition label closing bracket is unavailable: startOffset=${nodeRange.startOffset}`);
}

function readReferenceLookupSourceRanges(source: string): ReadonlyArray<ReferenceLookupSourceRange> {
  const tree = reviewMarkdownBoundaryParser.parse(source);
  const imageLabelRanges = readImageLabelSourceRanges(source);
  const sourceRanges: Array<ReferenceLookupSourceRange> = [];

  visit(tree, ["definition", "linkReference", "imageReference"], (node) => {
    if (node.type === "definition") {
      sourceRanges.push({
        ...readDefinitionLabelSourceRange(node, source),
        identifier: node.identifier,
        usesVisibleLabelMath: false,
      });
      return;
    }

    const sourceRange = node.referenceType === "full"
      ? readFullReferenceIdentifierSourceRange(node, source)
      : node.type === "imageReference"
        ? readImageVisibleLabelSourceRange(node, imageLabelRanges)
        : readReferenceVisibleLabelSourceRange(node, source);
    sourceRanges.push({
      ...sourceRange,
      identifier: node.identifier,
      usesVisibleLabelMath: node.referenceType !== "full",
    });
  });

  return sourceRanges;
}

export function restoreEscapedReviewDollarSigns(text: string): string {
  let restoredText = "";
  let segmentStartOffset = 0;

  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] !== "$") {
      continue;
    }

    let backslashStartOffset = offset;
    while (backslashStartOffset > 0 && text[backslashStartOffset - 1] === "\\") {
      backslashStartOffset -= 1;
    }

    const backslashCount = offset - backslashStartOffset;
    if (backslashCount === 0) {
      continue;
    }

    restoredText += text.slice(segmentStartOffset, backslashStartOffset);
    restoredText += "\\".repeat(Math.floor(backslashCount / 2));
    restoredText += "$";
    segmentStartOffset = offset + 1;
  }

  return `${restoredText}${text.slice(segmentStartOffset)}`;
}

function isSingleDollar(source: string, offset: number): boolean {
  return source[offset] === "$"
    && source[offset - 1] !== "$"
    && source[offset + 1] !== "$";
}

function readDisplayBodyEndOffset(source: string, closingDelimiterOffset: number): number {
  let bodyEndOffset = closingDelimiterOffset;
  if (source[bodyEndOffset - 1] === "\n") {
    bodyEndOffset -= 1;
    if (source[bodyEndOffset - 1] === "\r") {
      bodyEndOffset -= 1;
    }
  } else if (source[bodyEndOffset - 1] === "\r") {
    bodyEndOffset -= 1;
  }

  return bodyEndOffset;
}

function readRecognizedDisplayMathRanges(
  source: string,
  lines: ReadonlyArray<SourceLine>,
  protectedRanges: ReadonlyArray<ProtectedSourceRange>,
  sourceScopes: ReadonlyArray<SourceScopeRange>,
): ReadonlyArray<RecognizedReviewMathSourceRange> {
  const delimiterLines = lines
    .map(readDisplayDelimiterLine)
    .filter((line): line is DisplayDelimiterLine => line !== null);
  const sourceRanges: Array<RecognizedReviewMathSourceRange> = [];
  const opaqueBodyRanges: Array<ProtectedSourceRange> = [];
  const openingDelimiterLines = new Map<string, DisplayDelimiterLine>();

  for (const delimiterLine of delimiterLines) {
    let matchingOpening: Readonly<{
      identity: string;
      line: DisplayDelimiterLine;
    }> | null = null;

    for (const [identity, openingLine] of openingDelimiterLines) {
      if (
        isMatchingDisplayClosingDelimiter(
          openingLine,
          delimiterLine,
          sourceScopes,
          opaqueBodyRanges,
        )
        && (matchingOpening === null || openingLine.startOffset > matchingOpening.line.startOffset)
      ) {
        matchingOpening = { identity, line: openingLine };
      }
    }

    if (matchingOpening === null) {
      if (isSourceLineProtectedOutsideFormulaBodies(
        delimiterLine,
        protectedRanges,
        opaqueBodyRanges,
      )) {
        continue;
      }

      const containerIdentity = readDisplayContainerIdentity(
        delimiterLine,
        sourceScopes,
        opaqueBodyRanges,
      );
      if (openingDelimiterLines.has(containerIdentity) === false) {
        openingDelimiterLines.set(containerIdentity, delimiterLine);
      }
      continue;
    }

    const openingDelimiterLine = matchingOpening.line;
    openingDelimiterLines.delete(matchingOpening.identity);
    for (const [identity, openingLine] of openingDelimiterLines) {
      if (
        openingLine.startOffset > openingDelimiterLine.startOffset
        && openingLine.startOffset < delimiterLine.startOffset
      ) {
        openingDelimiterLines.delete(identity);
      }
    }

    const startOffset = openingDelimiterLine.startOffset;
    const endOffset = delimiterLine.contentEndOffset;
    for (let index = sourceRanges.length - 1; index >= 0; index -= 1) {
      const sourceRange = sourceRanges[index];
      if (
        sourceRange !== undefined
        && sourceRange.startOffset > startOffset
        && sourceRange.endOffset <= endOffset
      ) {
        sourceRanges.splice(index, 1);
      }
    }

    for (let index = opaqueBodyRanges.length - 1; index >= 0; index -= 1) {
      const bodyRange = opaqueBodyRanges[index];
      if (
        bodyRange !== undefined
        && bodyRange.startOffset >= openingDelimiterLine.endOffset
        && bodyRange.endOffset <= delimiterLine.startOffset
      ) {
        opaqueBodyRanges.splice(index, 1);
      }
    }

    opaqueBodyRanges.push({
      startOffset: openingDelimiterLine.endOffset,
      endOffset: delimiterLine.startOffset,
    });
    sourceRanges.push({
      delimitedSource: source.slice(startOffset, endOffset),
      endOffset,
      presentation: "display",
      source: readDisplayMathBodySource(source, openingDelimiterLine, delimiterLine),
      startOffset,
    });
  }

  return sourceRanges;
}

function readRecognizedInlineMathRanges(
  source: string,
  lines: ReadonlyArray<SourceLine>,
  protectedRanges: ReadonlyArray<MarkdownProtectedSourceRange>,
  displayRanges: ReadonlyArray<RecognizedReviewMathSourceRange>,
  sourceScopes: ReadonlyArray<SourceScopeRange>,
): ReadonlyArray<RecognizedReviewMathSourceRange> {
  const sourceRanges: Array<RecognizedReviewMathSourceRange> = [];

  for (const line of lines) {
    let openingDelimiter: Readonly<{ offset: number; scope: string }> | null = null;

    for (let offset = line.startOffset; offset < line.contentEndOffset; offset += 1) {
      if (
        isSingleDollar(source, offset) === false
        || isEscapedCharacter(source, offset)
      ) {
        continue;
      }

      const isProtectedByMarkdown = isOffsetProtected(offset, protectedRanges);
      const isProtectedByDisplayMath = isOffsetProtected(offset, displayRanges);
      if (openingDelimiter === null) {
        if (isProtectedByMarkdown || isProtectedByDisplayMath) {
          continue;
        }

        openingDelimiter = {
          offset,
          scope: readInlineSourceScopeKey(offset, sourceScopes, null),
        };
        continue;
      }

      const acceptedOpeningDelimiter = openingDelimiter;
      const isProtectedByOuterMarkdown = protectedRanges.some((sourceRange) => (
        sourceRange.startOffset <= offset
        && sourceRange.endOffset > offset
        && sourceRange.ownerStartOffset <= acceptedOpeningDelimiter.offset
      ));
      if (isProtectedByDisplayMath || isProtectedByOuterMarkdown) {
        continue;
      }

      const scope = readInlineSourceScopeKey(
        offset,
        sourceScopes,
        acceptedOpeningDelimiter.offset,
      );
      if (acceptedOpeningDelimiter.scope !== scope) {
        if (isProtectedByMarkdown === false) {
          openingDelimiter = {
            offset,
            scope: readInlineSourceScopeKey(offset, sourceScopes, null),
          };
        }
        continue;
      }

      const endOffset = offset + 1;
      sourceRanges.push({
        delimitedSource: source.slice(acceptedOpeningDelimiter.offset, endOffset),
        endOffset,
        presentation: "inline",
        source: source.slice(acceptedOpeningDelimiter.offset + 1, offset),
        startOffset: acceptedOpeningDelimiter.offset,
      });
      openingDelimiter = null;
    }
  }

  return sourceRanges;
}

function readRecognizedReviewMathRanges(source: string): ReadonlyArray<RecognizedReviewMathSourceRange> {
  const lines = readSourceLines(source);
  const protectedRanges = readMathProtectedSourceRanges(source);
  const sourceScopes = readMathSourceScopes(source);
  const displayRanges = readRecognizedDisplayMathRanges(
    source,
    lines,
    protectedRanges,
    sourceScopes.display,
  );
  const inlineRanges = readRecognizedInlineMathRanges(
    source,
    lines,
    protectedRanges,
    displayRanges,
    sourceScopes.inline,
  );

  return [...displayRanges, ...inlineRanges].sort((left, right) => left.startOffset - right.startOffset);
}

function readAvailablePlaceholder(source: string, unavailablePlaceholders: ReadonlySet<string>): string {
  for (
    let codePoint = REVIEW_PLACEHOLDER_START_CODE_POINT;
    codePoint <= REVIEW_PLACEHOLDER_END_CODE_POINT;
    codePoint += 1
  ) {
    const placeholder = String.fromCharCode(codePoint);
    if (
      REVIEW_PLACEHOLDER_CHARACTER_PATTERN.test(placeholder)
      && source.includes(placeholder) === false
      && unavailablePlaceholders.has(placeholder) === false
    ) {
      return placeholder;
    }
  }

  throw new Error("Review math source has no available parser placeholder");
}

function readDisplayOpeningDelimiterOffset(
  source: string,
  sourceRange: RecognizedReviewMathSourceRange,
): number {
  const openingDelimiterOffset = source.indexOf("$$", sourceRange.startOffset);
  if (openingDelimiterOffset < sourceRange.startOffset || openingDelimiterOffset >= sourceRange.endOffset) {
    throw new Error(`Review display math opening delimiter is unavailable: startOffset=${sourceRange.startOffset}`);
  }

  return openingDelimiterOffset;
}

function readMathDelimiterOffsets(
  source: string,
  sourceRanges: ReadonlyArray<RecognizedReviewMathSourceRange>,
): ReadonlySet<number> {
  const delimiterOffsets = new Set<number>();

  for (const sourceRange of sourceRanges) {
    if (sourceRange.presentation === "inline") {
      delimiterOffsets.add(sourceRange.startOffset);
      delimiterOffsets.add(sourceRange.endOffset - 1);
      continue;
    }

    const openingDelimiterOffset = readDisplayOpeningDelimiterOffset(source, sourceRange);
    const closingDelimiterOffset = source.lastIndexOf("$$", sourceRange.endOffset - 1);
    if (
      openingDelimiterOffset < sourceRange.startOffset
      || closingDelimiterOffset <= openingDelimiterOffset
      || closingDelimiterOffset >= sourceRange.endOffset
    ) {
      throw new Error(`Review display math delimiters are unavailable: startOffset=${sourceRange.startOffset}`);
    }

    delimiterOffsets.add(openingDelimiterOffset);
    delimiterOffsets.add(openingDelimiterOffset + 1);
    delimiterOffsets.add(closingDelimiterOffset);
    delimiterOffsets.add(closingDelimiterOffset + 1);
  }

  return delimiterOffsets;
}

function readDollarOffsetsInSourceRange(
  source: string,
  sourceRange: ProtectedSourceRange,
): ReadonlyArray<number> {
  const dollarOffsets: Array<number> = [];
  for (let offset = sourceRange.startOffset; offset < sourceRange.endOffset; offset += 1) {
    if (source[offset] === "$") {
      dollarOffsets.push(offset);
    }
  }

  return dollarOffsets;
}

function includeReferenceLookupDelimiterOffsets(
  source: string,
  delimiterOffsets: ReadonlySet<number>,
  referenceLookupRanges: ReadonlyArray<ReferenceLookupSourceRange>,
): ReadonlySet<number> {
  const visibleDelimiterOrdinals = new Map<string, Set<number>>();

  for (const sourceRange of referenceLookupRanges) {
    if (sourceRange.usesVisibleLabelMath === false) {
      continue;
    }

    const dollarOffsets = readDollarOffsetsInSourceRange(source, sourceRange);
    for (let ordinal = 0; ordinal < dollarOffsets.length; ordinal += 1) {
      const dollarOffset = dollarOffsets[ordinal];
      if (dollarOffset === undefined || delimiterOffsets.has(dollarOffset) === false) {
        continue;
      }

      const identifierOrdinals = visibleDelimiterOrdinals.get(sourceRange.identifier) ?? new Set<number>();
      identifierOrdinals.add(ordinal);
      visibleDelimiterOrdinals.set(sourceRange.identifier, identifierOrdinals);
    }
  }

  const referenceAwareDelimiterOffsets = new Set(delimiterOffsets);
  for (const sourceRange of referenceLookupRanges) {
    const identifierOrdinals = visibleDelimiterOrdinals.get(sourceRange.identifier);
    if (identifierOrdinals === undefined) {
      continue;
    }

    const dollarOffsets = readDollarOffsetsInSourceRange(source, sourceRange);
    for (const ordinal of identifierOrdinals) {
      const dollarOffset = dollarOffsets[ordinal];
      if (dollarOffset !== undefined) {
        referenceAwareDelimiterOffsets.add(dollarOffset);
      }
    }
  }

  return referenceAwareDelimiterOffsets;
}

function readParsedDisplayMathRanges(source: string): ReadonlyArray<ProtectedSourceRange> {
  const tree = reviewCanonicalMathParser.parse(source);
  const sourceRanges: Array<ProtectedSourceRange> = [];

  visit(tree, "math", (node) => {
    sourceRanges.push(readNodeSourceRange(node));
  });

  return sourceRanges;
}

function isOffsetInsideRecognizedDisplayMath(
  offset: number,
  sourceRanges: ReadonlyArray<RecognizedReviewMathSourceRange>,
): boolean {
  return sourceRanges.some((sourceRange) => (
    sourceRange.presentation === "display"
    && sourceRange.startOffset <= offset
    && sourceRange.endOffset > offset
  ));
}

function isOffsetInsideReferenceLookup(
  offset: number,
  sourceRanges: ReadonlyArray<ReferenceLookupSourceRange>,
): boolean {
  return sourceRanges.some((sourceRange) => (
    sourceRange.startOffset <= offset && sourceRange.endOffset > offset
  ));
}

function maskNoncanonicalDollars(
  source: string,
  delimiterOffsets: ReadonlySet<number>,
  protectedRanges: ReadonlyArray<ProtectedSourceRange>,
  sourceRanges: ReadonlyArray<RecognizedReviewMathSourceRange>,
  referenceLookupRanges: ReadonlyArray<ReferenceLookupSourceRange>,
  escapedDollarPlaceholder: string,
  literalDollarPlaceholder: string,
): string {
  const preparedCharacters = source.split("");

  for (let offset = 0; offset < source.length; offset += 1) {
    if (
      source[offset] !== "$"
      || delimiterOffsets.has(offset)
      || (
        isOffsetProtected(offset, protectedRanges)
        && isOffsetInsideRecognizedDisplayMath(offset, sourceRanges) === false
        && isOffsetInsideReferenceLookup(offset, referenceLookupRanges) === false
      )
    ) {
      continue;
    }

    if (isEscapedCharacter(source, offset)) {
      preparedCharacters[offset - 1] = escapedDollarPlaceholder;
      preparedCharacters[offset] = escapedDollarPlaceholder;
      continue;
    }

    preparedCharacters[offset] = literalDollarPlaceholder;
  }

  return preparedCharacters.join("");
}

function readAbsoluteDisplayDelimiterLines(
  source: string,
  sourceRange: RecognizedReviewMathSourceRange,
): Readonly<{ closingLine: SourceLine; openingLine: SourceLine }> {
  const sourceLines = readSourceLines(source.slice(sourceRange.startOffset, sourceRange.endOffset));
  const openingLine = sourceLines[0];
  const closingLine = sourceLines[sourceLines.length - 1];
  if (openingLine === undefined || closingLine === undefined) {
    throw new Error(`Review display math delimiter lines are unavailable: startOffset=${sourceRange.startOffset}`);
  }

  return {
    openingLine: {
      ...openingLine,
      contentEndOffset: openingLine.contentEndOffset + sourceRange.startOffset,
      endOffset: openingLine.endOffset + sourceRange.startOffset,
      startOffset: openingLine.startOffset + sourceRange.startOffset,
    },
    closingLine: {
      ...closingLine,
      contentEndOffset: closingLine.contentEndOffset + sourceRange.startOffset,
      endOffset: closingLine.endOffset + sourceRange.startOffset,
      startOffset: closingLine.startOffset + sourceRange.startOffset,
    },
  };
}

function countMovableDisplayDelimiterIndentation(line: SourceLine): number {
  const delimiterMatch = REVIEW_DISPLAY_MATH_DELIMITER_PATTERN.exec(line.content);
  if (delimiterMatch === null) {
    throw new Error(`Review display math delimiter became invalid: line=${line.content}`);
  }

  const leadingPrefix = delimiterMatch[1] ?? "";
  const trailingWhitespaceMatch = /[\t ]*$/.exec(leadingPrefix);
  return trailingWhitespaceMatch?.[0].length ?? 0;
}

function relocateDisplayDelimiterIndentation(
  source: string,
  line: SourceLine,
  indentationCount: number,
): string {
  const delimiterMatch = REVIEW_DISPLAY_MATH_DELIMITER_PATTERN.exec(line.content);
  if (delimiterMatch === null) {
    throw new Error(`Review display math delimiter became invalid: line=${line.content}`);
  }

  const leadingPrefix = delimiterMatch[1] ?? "";
  const trailingWhitespace = delimiterMatch[2] ?? "";
  const retainedPrefix = leadingPrefix.slice(0, leadingPrefix.length - indentationCount);
  const relocatedIndentation = leadingPrefix.slice(leadingPrefix.length - indentationCount);
  const preparedDelimiter = `${retainedPrefix}$$${relocatedIndentation}${trailingWhitespace}`;

  return `${source.slice(0, line.startOffset)}${preparedDelimiter}${source.slice(line.contentEndOffset)}`;
}

function hasParsedDisplayOpening(
  source: string,
  sourceRange: RecognizedReviewMathSourceRange,
): boolean {
  const openingDelimiterOffset = readDisplayOpeningDelimiterOffset(source, sourceRange);
  return readParsedDisplayMathRanges(source).some((parsedRange) => (
    parsedRange.startOffset === openingDelimiterOffset
  ));
}

function hasParsedDisplayRange(
  source: string,
  sourceRange: RecognizedReviewMathSourceRange,
): boolean {
  const openingDelimiterOffset = readDisplayOpeningDelimiterOffset(source, sourceRange);
  return readParsedDisplayMathRanges(source).some((parsedRange) => (
    parsedRange.startOffset === openingDelimiterOffset
    && parsedRange.endOffset === sourceRange.endOffset
  ));
}

function prepareDisplayMathRange(
  source: string,
  sourceRange: RecognizedReviewMathSourceRange,
): string {
  if (hasParsedDisplayRange(source, sourceRange)) {
    return source;
  }

  const { openingLine, closingLine } = readAbsoluteDisplayDelimiterLines(source, sourceRange);
  const openingIndentationCount = countMovableDisplayDelimiterIndentation(openingLine);
  let preparedSource: string | null = hasParsedDisplayOpening(source, sourceRange)
    ? source
    : null;

  for (
    let indentationCount = 1;
    preparedSource === null && indentationCount <= openingIndentationCount;
    indentationCount += 1
  ) {
    const candidateSource = relocateDisplayDelimiterIndentation(source, openingLine, indentationCount);
    if (hasParsedDisplayOpening(candidateSource, sourceRange)) {
      preparedSource = candidateSource;
      break;
    }
  }

  if (preparedSource === null) {
    throw new Error(`Review display math opening delimiter could not be prepared: startOffset=${sourceRange.startOffset}`);
  }

  if (hasParsedDisplayRange(preparedSource, sourceRange)) {
    return preparedSource;
  }

  const closingIndentationCount = countMovableDisplayDelimiterIndentation(closingLine);
  for (let indentationCount = 1; indentationCount <= closingIndentationCount; indentationCount += 1) {
    const candidateSource = relocateDisplayDelimiterIndentation(
      preparedSource,
      closingLine,
      indentationCount,
    );
    if (hasParsedDisplayRange(candidateSource, sourceRange)) {
      return candidateSource;
    }
  }

  throw new Error(`Review display math closing delimiter could not be prepared: startOffset=${sourceRange.startOffset}`);
}

function prepareDisplayDelimiterLines(
  source: string,
  sourceRanges: ReadonlyArray<RecognizedReviewMathSourceRange>,
): string {
  return sourceRanges
    .filter((sourceRange) => sourceRange.presentation === "display")
    .reduce(prepareDisplayMathRange, source);
}

export function prepareReviewMathForRemark(source: string): PreparedReviewMathSource {
  const recognizedRanges = readRecognizedReviewMathRanges(source);
  const protectedRanges = readMathProtectedSourceRanges(source);
  const referenceLookupRanges = readReferenceLookupSourceRanges(source);
  const literalDollarPlaceholder = readAvailablePlaceholder(source, new Set<string>());
  const escapedDollarPlaceholder = readAvailablePlaceholder(source, new Set([literalDollarPlaceholder]));
  const delimiterOffsets = includeReferenceLookupDelimiterOffsets(
    source,
    readMathDelimiterOffsets(source, recognizedRanges),
    referenceLookupRanges,
  );
  const maskedSource = maskNoncanonicalDollars(
    source,
    delimiterOffsets,
    protectedRanges,
    recognizedRanges,
    referenceLookupRanges,
    escapedDollarPlaceholder,
    literalDollarPlaceholder,
  );
  return {
    escapedDollarPlaceholder,
    literalDollarPlaceholder,
    recognizedRanges,
    source,
    text: prepareDisplayDelimiterLines(maskedSource, recognizedRanges),
  };
}

function restoreReviewMathPlaceholders(value: string, preparedSource: PreparedReviewMathSource): string {
  return value
    .replaceAll(preparedSource.escapedDollarPlaceholder.repeat(2), "$")
    .replaceAll(preparedSource.literalDollarPlaceholder, "$");
}

function restoreReviewMathTreePlaceholders(tree: Root, preparedSource: PreparedReviewMathSource): Root {
  visit(tree, (node) => {
    if ("value" in node && typeof node.value === "string") {
      node.value = restoreReviewMathPlaceholders(node.value, preparedSource);
    }

    if (node.type === "link" || node.type === "image" || node.type === "definition") {
      node.url = restoreReviewMathPlaceholders(node.url, preparedSource);
      if (node.title !== null && node.title !== undefined) {
        node.title = restoreReviewMathPlaceholders(node.title, preparedSource);
      }
    }

    if (node.type === "image" || node.type === "imageReference") {
      node.alt = restoreReviewMathPlaceholders(node.alt ?? "", preparedSource);
    }
  });

  return tree;
}

function createMathHastProperties(mathSource: ReviewMathSourceRange): Properties {
  return {
    [REVIEW_MATH_SOURCE_PROPERTY]: mathSource.source,
    [REVIEW_MATH_DELIMITED_SOURCE_PROPERTY]: mathSource.delimitedSource,
  };
}

function decorateReviewMathNode(node: ReviewMathNode, mathSource: ReviewMathSourceRange): ReviewMathNode {
  const mathProperties = createMathHastProperties(mathSource);

  if (node.type === "inlineMath") {
    return {
      ...node,
      data: {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          ...mathProperties,
        },
      },
    };
  }

  const hChildren = node.data?.hChildren;
  const codeElement = hChildren?.[0];
  if (hChildren === undefined || codeElement?.type !== "element" || codeElement.tagName !== "code") {
    throw new Error("Review display math HAST code element is unavailable");
  }

  return {
    ...node,
    data: {
      ...node.data,
      hChildren: [{
        ...codeElement,
        properties: {
          ...codeElement.properties,
          ...mathProperties,
        },
      }, ...hChildren.slice(1)],
    },
  };
}

function createReviewImageLabelMathPlaceholders(
  labelSource: string,
  decodedAlt: string,
  count: number,
): ReadonlyArray<string> {
  let prefix = "ReviewMathFormulaPlaceholder";
  while (labelSource.includes(prefix) || decodedAlt.includes(prefix)) {
    prefix = `${prefix}Z`;
  }

  return Array.from({ length: count }, (_, index) => `${prefix}${index}Z`);
}

function readDecodedImageAlt(labelSource: string): string {
  const syntheticDestination = "review-math-label";
  const tree = reviewMarkdownBoundaryParser.parse(`![${labelSource}](${syntheticDestination})`);
  let decodedAlt: string | null = null;

  visit(tree, "image", (node) => {
    if (decodedAlt === null && node.url === syntheticDestination) {
      decodedAlt = node.alt ?? "";
    }
  });

  if (decodedAlt === null) {
    throw new Error("Review image label could not be decoded by the Markdown parser");
  }

  return decodedAlt;
}

function readDecodedImageLabel(
  labelSource: string,
  labelStartOffset: number,
  originalDecodedAlt: string,
  sourceMathRanges: ReadonlyArray<RecognizedReviewMathSourceRange>,
): DecodedImageLabel {
  const placeholders = createReviewImageLabelMathPlaceholders(
    labelSource,
    originalDecodedAlt,
    sourceMathRanges.length,
  );
  let sourceOffset = 0;
  let preparedLabelSource = "";

  for (let index = 0; index < sourceMathRanges.length; index += 1) {
    const sourceMathRange = sourceMathRanges[index];
    const placeholder = placeholders[index];
    if (sourceMathRange === undefined || placeholder === undefined) {
      throw new Error(`Review image label source mapping is unavailable: index=${index}`);
    }

    const relativeStartOffset = sourceMathRange.startOffset - labelStartOffset;
    const relativeEndOffset = sourceMathRange.endOffset - labelStartOffset;
    preparedLabelSource += labelSource.slice(sourceOffset, relativeStartOffset);
    preparedLabelSource += placeholder;
    sourceOffset = relativeEndOffset;
  }
  preparedLabelSource += labelSource.slice(sourceOffset);

  const decodedPreparedAlt = readDecodedImageAlt(preparedLabelSource);
  const decodedMathRanges: Array<DecodedImageLabelMathRange> = [];
  let decodedPreparedOffset = 0;
  let decodedText = "";

  for (let index = 0; index < sourceMathRanges.length; index += 1) {
    const sourceMathRange = sourceMathRanges[index];
    const placeholder = placeholders[index];
    if (sourceMathRange === undefined || placeholder === undefined) {
      throw new Error(`Review image label decoded mapping is unavailable: index=${index}`);
    }

    const placeholderOffset = decodedPreparedAlt.indexOf(placeholder, decodedPreparedOffset);
    if (placeholderOffset < decodedPreparedOffset) {
      throw new Error(`Review image label placeholder is unavailable after decoding: index=${index}`);
    }
    if (decodedPreparedAlt.indexOf(placeholder, placeholderOffset + placeholder.length) !== -1) {
      throw new Error(`Review image label placeholder is duplicated after decoding: index=${index}`);
    }

    decodedText += decodedPreparedAlt.slice(decodedPreparedOffset, placeholderOffset);
    const decodedStartOffset = decodedText.length;
    decodedText += sourceMathRange.delimitedSource;
    const decodedEndOffset = decodedText.length;
    decodedMathRanges.push({
      ...sourceMathRange,
      decodedEndOffset,
      decodedStartOffset,
    });
    decodedPreparedOffset = placeholderOffset + placeholder.length;
  }
  decodedText += decodedPreparedAlt.slice(decodedPreparedOffset);

  return { mathRanges: decodedMathRanges, text: decodedText };
}

function createReviewImageLabelHastChildren(
  decodedLabel: DecodedImageLabel,
): Array<ElementContent> {
  const children: Array<ElementContent> = [];
  let decodedOffset = 0;

  for (const mathRange of decodedLabel.mathRanges) {
    if (decodedOffset < mathRange.decodedStartOffset) {
      children.push({
        type: "text",
        value: decodedLabel.text.slice(decodedOffset, mathRange.decodedStartOffset),
      });
    }

    children.push({
      type: "element",
      tagName: "code",
      properties: {
        className: ["math-inline"],
        ...createMathHastProperties(mathRange),
      },
      children: [{ type: "text", value: mathRange.source }],
    });
    decodedOffset = mathRange.decodedEndOffset;
  }

  if (decodedOffset < decodedLabel.text.length) {
    children.push({ type: "text", value: decodedLabel.text.slice(decodedOffset) });
  }

  return children;
}

function decorateReviewImageNode(
  node: Image | ImageReference,
  preparedSource: PreparedReviewMathSource,
  imageLabelRanges: ReadonlyArray<ImageLabelSourceRange>,
): Image | ImageReference {
  const labelRange = readImageVisibleLabelSourceRange(node, imageLabelRanges);
  const sourceMathRanges = preparedSource.recognizedRanges.filter((sourceRange) => (
    sourceRange.presentation === "inline"
    && sourceRange.startOffset >= labelRange.startOffset
    && sourceRange.endOffset <= labelRange.endOffset
  ));
  if (sourceMathRanges.length === 0) {
    return node;
  }

  const labelSource = preparedSource.source.slice(labelRange.startOffset, labelRange.endOffset);
  const originalDecodedAlt = restoreReviewMathPlaceholders(node.alt ?? "", preparedSource);
  const decodedLabel = readDecodedImageLabel(
    labelSource,
    labelRange.startOffset,
    originalDecodedAlt,
    sourceMathRanges,
  );

  return {
    ...node,
    data: {
      ...node.data,
      hChildren: createReviewImageLabelHastChildren(decodedLabel),
    },
  };
}

function normalizeReviewMathTree(
  tree: Root,
  preparedSource: PreparedReviewMathSource,
): Root {
  const normalizedTree = structuredClone(tree);
  const imageLabelRanges = readImageLabelSourceRanges(preparedSource.source);
  const recognizedRanges = new Map(preparedSource.recognizedRanges.map((sourceRange) => (
    [
      `${sourceRange.presentation}:${sourceRange.presentation === "inline"
        ? sourceRange.startOffset
        : readDisplayOpeningDelimiterOffset(preparedSource.text, sourceRange)}`,
      sourceRange,
    ]
  )));

  visit(normalizedTree, ["inlineMath", "math"], (node, index, parent) => {
    if (node.type !== "inlineMath" && node.type !== "math") {
      return;
    }

    if (index === undefined || parent === undefined) {
      throw new Error(`Review math node has no parent: nodeType=${node.type}`);
    }

    const sourceRange = readNodeSourceRange(node);
    const presentation = node.type === "inlineMath" ? "inline" : "display";
    const recognizedRange = recognizedRanges.get(
      `${presentation}:${sourceRange.startOffset}`,
    );
    if (recognizedRange === undefined) {
      throw new Error(
        `Remark produced an unrecognized review math node: nodeType=${node.type}, startOffset=${sourceRange.startOffset}, endOffset=${sourceRange.endOffset}`,
      );
    }

    const mutableParent: Parent = parent;
    mutableParent.children[index] = decorateReviewMathNode(node, recognizedRange);
  });

  visit(normalizedTree, ["image", "imageReference"], (node, index, parent) => {
    if (index === undefined || parent === undefined) {
      throw new Error(`Review image node has no parent: nodeType=${node.type}`);
    }

    const mutableParent: Parent = parent;
    mutableParent.children[index] = decorateReviewImageNode(
      node,
      preparedSource,
      imageLabelRanges,
    );
  });

  return restoreReviewMathTreePlaceholders(normalizedTree, preparedSource);
}

export const normalizeReviewMathSyntax: Plugin<[ReviewMathSyntaxOptions], Root> = function normalizeReviewMathSyntaxPlugin(options) {
  return function normalizeReviewMathSyntaxTree(tree): Root {
    return normalizeReviewMathTree(tree, options.preparedSource);
  };
};

export function readRecognizedReviewMathSourceRanges(text: string): ReadonlyArray<ReviewMathSourceRange> {
  return readRecognizedReviewMathRanges(text);
}

export function hasRecognizedReviewMath(text: string): boolean {
  return readRecognizedReviewMathRanges(text).length > 0;
}

export function readReviewMathHastSource(properties: Properties): Readonly<{
  delimitedSource: string;
  source: string;
}> {
  const source = properties[REVIEW_MATH_SOURCE_PROPERTY];
  const delimitedSource = properties[REVIEW_MATH_DELIMITED_SOURCE_PROPERTY];
  if (typeof source !== "string" || typeof delimitedSource !== "string") {
    throw new TypeError("Review math HAST source properties must be strings");
  }

  return { source, delimitedSource };
}
