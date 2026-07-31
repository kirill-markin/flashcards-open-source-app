import { HttpError } from "../shared/errors";

type MarkdownUrlRewrite = Readonly<{
  startIndex: number;
  endIndex: number;
  replacementUrl: string;
}>;

export type ManagedMediaLifecycleState = "ready" | "pending" | "failed";

export type ManagedMediaLifecycleReference = Readonly<{
  mediaAssetId: string;
  state: ManagedMediaLifecycleState;
  destination: string;
  isImage: boolean;
}>;

export type ManagedMediaLifecycleIssues = Readonly<{
  pendingDestinations: ReadonlyArray<string>;
  failedDestinations: ReadonlyArray<string>;
  unsupportedDestinations: ReadonlyArray<string>;
}>;

type MarkdownLinkDestination = Readonly<{
  labelStartIndex: number;
  labelEndIndex: number;
  startIndex: number;
  endIndex: number;
  linkEndIndex: number;
  destination: string;
  hasDestination: boolean;
  isImage: boolean;
}>;

type MarkdownSourceRange = Readonly<{ startIndex: number; endIndex: number }>;
type MarkdownProseRange = MarkdownSourceRange & Readonly<{ startLineIndex: number }>;

type MarkdownInlineItem = MarkdownSourceRange | MarkdownLinkDestination;

type MarkdownInlineItemSink<Item extends MarkdownInlineItem> = Readonly<{
  selectCodeRange: (startIndex: number, endIndex: number) => Item | null;
  selectDestination: (
    markdown: string,
    destination: MarkdownLinkDestinationRange,
  ) => Item | null;
}>;

type MarkdownInlineScan = readonly [startIndex: number, endIndex: number];
type MarkdownInlineScanKind = "whitespace" | "bare" | "angled" | "\"" | "'" | "(";

type MarkdownInlineState = {
  markdown: string;
  blockScan: MarkdownBlockScan;
  cursorIndex: number;
  lineIndex: number;
  lineEndIndex: number;
  rangeEndIndex: number;
  paragraphId: number;
  containerStackId: number;
  scans: Partial<Record<MarkdownInlineScanKind, MarkdownInlineScan>>;
  opaqueDelimiterFailures: Uint8Array;
};

type MarkdownLabelStack = {
  startIndexes: Int32Array;
  flags: Uint8Array;
  depth: number;
};

type MarkdownCodeStop = Readonly<{ markerLength: number; closingEndIndex: number }>;

type MarkdownLinkDestinationRange = Readonly<{
  labelStartIndex: number;
  labelEndIndex: number;
  startIndex: number;
  endIndex: number;
  linkEndIndex: number;
  hasDestination: boolean;
  isImage: boolean;
}>;

type MarkdownCodeFrame = Readonly<{
  openerStartIndex: number;
  markerLength: number;
  parentLabelDepth: number;
}>;

type MarkdownLogicalInspection = {
  cursorIndex: number;
  lineIndex: number;
  lineEndIndex: number;
};

type MarkdownLinkInspection = {
  cursorIndex: number;
  lineIndex: number;
  lineEndIndex: number;
  precedingBackslashCount: number;
  reentryIndex: number | null;
  activeCodeStop: MarkdownCodeStop | null;
  skippedSource: boolean;
};

type MarkdownLinkToken = Readonly<{ character: string; isEscaped: boolean }>;

type MarkdownLinkAttempt =
  | Readonly<{
    kind: "destination";
    destination: MarkdownLinkDestinationRange;
    activeCodeStop: MarkdownCodeStop | null;
  }>
  | Readonly<{ kind: "failed"; resumeIndex: number }>;

type MarkdownFence = Readonly<{ marker: "`" | "~"; length: number }>;

type MarkdownListContainer = Readonly<{
  kind: "list"; continuationIndentColumns: number; orderedStart: number | null;
  contentStarted: boolean; leadingBlankConsumed: boolean;
}>;
type MarkdownContainer = Readonly<{ kind: "blockquote" }> | MarkdownListContainer;

type MarkdownCursor = Readonly<{
  sourceIndex: number; column: number; virtualIndentColumns: number;
}>;

type MarkdownIndentScan = Readonly<{ cursor: MarkdownCursor; consumedColumns: number }>;

type MarkdownListMarker = Readonly<{
  container: MarkdownListContainer;
  contentCursor: MarkdownCursor;
  isBlank: boolean;
}>;

type MarkdownContainerMatch = Readonly<{
  containers: ReadonlyArray<MarkdownContainer>; matchedCount: number; cursor: MarkdownCursor;
}>;

type MarkdownHtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type MarkdownBlockStart =
  | Readonly<{ kind: "paragraph" | "thematic-break" | "atx-heading" }>
  | Readonly<{ kind: "blockquote"; contentCursor: MarkdownCursor }>
  | Readonly<{ kind: "list"; marker: MarkdownListMarker }>
  | Readonly<{ kind: "fence"; fence: MarkdownFence }>
  | Readonly<{ kind: "html"; htmlBlockType: MarkdownHtmlBlockType }>;
type MarkdownThematicBreakState = Readonly<{
  lastNonAsteriskIndex: number;
  lastNonHyphenIndex: number;
  lastNonUnderscoreIndex: number;
}>;
type MarkdownBlockScan = Readonly<{
  lines: Readonly<{ chunks: ReadonlyArray<Int32Array>; lineCount: number; fieldCount: number }>;
  containerStacks: ReadonlyArray<ReadonlyArray<MarkdownContainer>>;
  proseRanges: ReadonlyArray<MarkdownProseRange>;
  fencedCodeRanges: ReadonlyArray<MarkdownSourceRange>;
}>;

const enum MarkdownLineField {
  StartIndex = 0, EndIndex = 1, NextStartIndex = 2, ContentStartIndex = 3,
  ContainerStackId = 4, ParagraphId = 5, BlockKind = 6, Count = 7,
}

const enum MarkdownBlockKind {
  Prose = 0, FencedCode = 1, Html = 2,
}

const enum MarkdownLabelFlag {
  Image = 1,
  ContainsActiveLink = 2,
}

const enum MarkdownOpaqueDelimiter {
  Comment = 0,
  ProcessingInstruction = 1,
  Declaration = 2,
  Cdata = 3,
  SingleQuote = 4,
  DoubleQuote = 5,
  Count = 6,
}

export type FcAssetPortablePathResolver = (assetId: string) => string;
export type FcAssetIdResolver = (assetId: string) => string;
export type PortableMediaAssetIdResolver = (portableMediaPath: string) => string;

const fcAssetUrlPattern = /^fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const managedMediaLifecycleUrlPattern =
  /^fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)(?:\?state=(pending|failed))?$/;
const managedMediaSchemePrefix = "fcasset:";
const absoluteUrlPattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const localMediaPathWithLeadingDotSegmentsPattern = /^(?:\.\.?[\\/])+media(?:[\\/]|$)/;
const portableMediaPathSegmentPattern = /^[A-Za-z0-9._-]+$/;
const htmlBlockTypeSixTagNames: ReadonlySet<string> = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body",
  "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head",
  "header", "hr", "html", "iframe", "legend", "li", "link", "main", "menu",
  "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p", "param",
  "search", "section", "summary", "table", "tbody", "td", "tfoot", "th",
  "thead", "title", "tr", "track", "ul",
]);
const htmlBlockTypeSevenExcludedOpeningTagNames: ReadonlySet<string> = new Set([
  "pre", "script", "style", "textarea",
]);
const completeHtmlOpeningTagPattern = /^<([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^ \t"'=<>`]+))?)*[ \t]*\/?>[ \t]*$/u;
const completeHtmlClosingTagPattern = /^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t]*$/u;
const htmlBlockTypeSixStartPattern = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t]|$|>|\/>)/iu;
const htmlBlockTypeOneEndPattern = /<\/(?:pre|script|style|textarea)>/iu;
const markdownParagraphStart: MarkdownBlockStart = { kind: "paragraph" };
const markdownThematicBreakStart: MarkdownBlockStart = { kind: "thematic-break" };
const markdownAtxHeadingStart: MarkdownBlockStart = { kind: "atx-heading" };
const markdownLineChunkCapacity = 8_192;
const markdownMaximumInlineLabelDepth = 1_000;
const markdownMaximumLinkDestinationParenthesisDepth = 32;
const markdownComplexityLimitErrorCode =
  "MARKDOWN_COMPLEXITY_LIMIT_EXCEEDED";

class MarkdownComplexityError extends Error {
  readonly sourceIndex: number;
  readonly maximumDepth: number;

  constructor(sourceIndex: number, maximumDepth: number) {
    super(
      `Markdown inline label depth exceeds the supported limit at source index ${sourceIndex}. `
        + `maximumDepth=${maximumDepth}. Simplify nested Markdown labels and retry.`,
    );
    this.name = "MarkdownComplexityError";
    this.sourceIndex = sourceIndex;
    this.maximumDepth = maximumDepth;
  }
}

function translateMarkdownComplexityError(error: MarkdownComplexityError): HttpError {
  return new HttpError(
    400,
    error.message,
    markdownComplexityLimitErrorCode,
  );
}

export function isMarkdownComplexityLimitError(error: unknown): error is HttpError {
  return error instanceof HttpError
    && error.code === markdownComplexityLimitErrorCode;
}

function runMarkdownHelper<Result>(operation: () => Result): Result {
  try {
    return operation();
  } catch (error) {
    if (error instanceof MarkdownComplexityError) {
      throw translateMarkdownComplexityError(error);
    }
    throw error;
  }
}

function matchFcAssetId(url: string): string | null {
  const match = fcAssetUrlPattern.exec(url);
  if (match === null) {
    return null;
  }

  return match[1] ?? null;
}

export function parseManagedMediaLifecycleReference(
  destination: string,
): Omit<ManagedMediaLifecycleReference, "isImage"> | null {
  const match = managedMediaLifecycleUrlPattern.exec(destination);
  if (match === null) {
    return null;
  }
  const mediaAssetId = match[1];
  const lifecycleState = match[2];
  if (mediaAssetId === undefined) {
    return null;
  }
  const state: ManagedMediaLifecycleState = lifecycleState === "pending"
    ? "pending"
    : lifecycleState === "failed"
      ? "failed"
      : "ready";
  return {
    mediaAssetId,
    state,
    destination,
  };
}

function countRepeatedCharacter(markdown: string, index: number, marker: "`" | "~"): number {
  let cursorIndex = index;
  while (markdown[cursorIndex] === marker) {
    cursorIndex += 1;
  }

  return cursorIndex - index;
}

function consumeMarkdownIndentColumns(
  markdown: string,
  cursor: MarkdownCursor,
  lineEndIndex: number,
  maximumColumns: number,
): MarkdownIndentScan {
  let sourceIndex = cursor.sourceIndex;
  let column = cursor.column;
  let virtualIndentColumns = cursor.virtualIndentColumns;
  let consumedColumns = 0;

  while (consumedColumns < maximumColumns) {
    if (virtualIndentColumns > 0) {
      const consumedVirtualColumns = Math.min(virtualIndentColumns, maximumColumns - consumedColumns);
      virtualIndentColumns -= consumedVirtualColumns;
      column += consumedVirtualColumns;
      consumedColumns += consumedVirtualColumns;
      continue;
    }

    const character = sourceIndex < lineEndIndex ? markdown[sourceIndex] : undefined;
    if (character === " ") {
      sourceIndex += 1;
      column += 1; consumedColumns += 1;
      continue;
    }
    if (character !== "\t") {
      break;
    }

    const tabWidth = 4 - (column % 4);
    const consumedTabColumns = Math.min(tabWidth, maximumColumns - consumedColumns);
    sourceIndex += 1;
    column += consumedTabColumns; consumedColumns += consumedTabColumns;
    virtualIndentColumns = tabWidth - consumedTabColumns;
  }

  return { cursor: { sourceIndex, column, virtualIndentColumns }, consumedColumns };
}

function getMarkdownNonWhitespaceEndIndex(
  markdown: string,
  lineStartIndex: number,
  lineEndIndex: number,
): number {
  let index = lineEndIndex;
  while (
    index > lineStartIndex
    && (markdown[index - 1] === " " || markdown[index - 1] === "\t")
  ) {
    index -= 1;
  }
  return index;
}

function isMarkdownCursorBlank(
  cursor: MarkdownCursor,
  nonWhitespaceEndIndex: number,
): boolean {
  return cursor.sourceIndex >= nonWhitespaceEndIndex;
}

function advanceMarkdownCursor(cursor: MarkdownCursor, characterCount: number): MarkdownCursor {
  return { sourceIndex: cursor.sourceIndex + characterCount,
    column: cursor.column + characterCount, virtualIndentColumns: 0 };
}

function consumeMarkdownLeafIndent(
  markdown: string,
  cursor: MarkdownCursor,
  lineEndIndex: number,
): MarkdownCursor | null {
  if (
    cursor.virtualIndentColumns === 0
    && markdown[cursor.sourceIndex] !== " "
    && markdown[cursor.sourceIndex] !== "\t"
  ) {
    return cursor;
  }
  const indent = consumeMarkdownIndentColumns(markdown, cursor, lineEndIndex, 3);
  return indent.cursor.virtualIndentColumns === 0 ? indent.cursor : null;
}

function parseMarkdownBlockQuotePrefix(
  markdown: string,
  cursor: MarkdownCursor,
  lineEndIndex: number,
): MarkdownCursor | null {
  const markerCursor = consumeMarkdownLeafIndent(markdown, cursor, lineEndIndex);
  if (markerCursor === null) {
    return null;
  }
  return parseMarkdownBlockQuoteMarker(markdown, markerCursor, lineEndIndex);
}

function parseMarkdownBlockQuoteMarker(
  markdown: string,
  markerCursor: MarkdownCursor,
  lineEndIndex: number,
): MarkdownCursor | null {
  if (markdown[markerCursor.sourceIndex] !== ">") return null;
  const afterMarkerCursor = advanceMarkdownCursor(markerCursor, 1);
  const optionalIndent = consumeMarkdownIndentColumns(markdown, afterMarkerCursor, lineEndIndex, 1);
  return optionalIndent.cursor;
}

function createMarkdownListMarker(
  markerWidth: number,
  orderedStart: number | null,
  contentCursor: MarkdownCursor,
  isBlank: boolean,
  paddingColumns: number,
): MarkdownListMarker {
  return {
    container: {
      kind: "list", continuationIndentColumns: markerWidth + paddingColumns,
      orderedStart, contentStarted: !isBlank, leadingBlankConsumed: isBlank,
    },
    contentCursor, isBlank,
  };
}

function parseMarkdownListMarker(
  markdown: string,
  markerCursor: MarkdownCursor,
  lineEndIndex: number,
): MarkdownListMarker | null {
  let markerEndIndex = markerCursor.sourceIndex;
  let orderedStart: number | null = null;
  const firstCharacter = markdown[markerEndIndex];
  if (firstCharacter === "-" || firstCharacter === "+" || firstCharacter === "*") {
    markerEndIndex += 1;
  } else {
    const digitStartIndex = markerEndIndex;
    while (
      markerEndIndex < lineEndIndex
      && markerEndIndex - digitStartIndex < 9
      && markdown[markerEndIndex]! >= "0"
      && markdown[markerEndIndex]! <= "9"
    ) {
      markerEndIndex += 1;
    }
    if (
      markerEndIndex === digitStartIndex
      || (markdown[markerEndIndex] !== "." && markdown[markerEndIndex] !== ")")
    ) {
      return null;
    }
    orderedStart = Number.parseInt(markdown.slice(digitStartIndex, markerEndIndex), 10);
    markerEndIndex += 1;
  }

  const markerWidth = markerEndIndex - markerCursor.sourceIndex;
  const afterMarkerCursor = advanceMarkdownCursor(markerCursor, markerWidth);
  if (afterMarkerCursor.sourceIndex >= lineEndIndex) {
    return createMarkdownListMarker(markerWidth, orderedStart, afterMarkerCursor, true, 1);
  }

  const indentation = consumeMarkdownIndentColumns(markdown, afterMarkerCursor, lineEndIndex,
    Number.MAX_SAFE_INTEGER);
  if (indentation.consumedColumns === 0) {
    return null;
  }
  if (indentation.cursor.sourceIndex >= lineEndIndex) {
    return createMarkdownListMarker(markerWidth, orderedStart, indentation.cursor, true, 1);
  }

  const paddingColumns = indentation.consumedColumns <= 4
    ? indentation.consumedColumns
    : 1;
  const contentCursor = paddingColumns === indentation.consumedColumns
    ? indentation.cursor
    : consumeMarkdownIndentColumns(markdown, afterMarkerCursor, lineEndIndex, paddingColumns).cursor;
  return createMarkdownListMarker(markerWidth, orderedStart, contentCursor, false, paddingColumns);
}

function matchMarkdownContainers(
  markdown: string,
  lineStartIndex: number,
  lineEndIndex: number,
  nonWhitespaceEndIndex: number,
  containers: ReadonlyArray<MarkdownContainer>,
): MarkdownContainerMatch {
  let cursor: MarkdownCursor = { sourceIndex: lineStartIndex, column: 0,
    virtualIndentColumns: 0 };
  let updatedContainers: Array<MarkdownContainer> | null = null;
  let matchedCount = containers.length;

  for (let containerIndex = 0; containerIndex < containers.length; containerIndex += 1) {
    const container = containers[containerIndex];
    if (container === undefined) {
      throw new Error(`Markdown container is missing at index ${containerIndex}.`);
    }

    if (container.kind === "blockquote") {
      const matchedCursor = parseMarkdownBlockQuotePrefix(markdown, cursor, lineEndIndex);
      if (matchedCursor === null) {
        matchedCount = containerIndex;
        break;
      }
      cursor = matchedCursor;
      continue;
    }

    if (isMarkdownCursorBlank(cursor, nonWhitespaceEndIndex)) {
      if (!container.contentStarted && container.leadingBlankConsumed) {
        matchedCount = containerIndex;
        break;
      }
      cursor = consumeMarkdownIndentColumns(markdown, cursor, lineEndIndex,
        Number.MAX_SAFE_INTEGER).cursor;
      continue;
    }

    const indentation = consumeMarkdownIndentColumns(markdown, cursor, lineEndIndex,
      container.continuationIndentColumns);
    if (indentation.consumedColumns < container.continuationIndentColumns) {
      matchedCount = containerIndex;
      break;
    }
    cursor = indentation.cursor;

    if (!container.contentStarted && !isMarkdownCursorBlank(cursor, nonWhitespaceEndIndex)) {
      updatedContainers ??= [...containers];
      updatedContainers[containerIndex] = { ...container, contentStarted: true };
    }
  }

  return { containers: updatedContainers ?? containers, matchedCount, cursor };
}

function parseMarkdownFenceOpener(
  markdown: string,
  markerCursor: MarkdownCursor,
  lineEndIndex: number,
): MarkdownFence | null {
  const marker = markdown[markerCursor.sourceIndex];
  if (marker !== "`" && marker !== "~") return null;

  const markerLength = countRepeatedCharacter(markdown, markerCursor.sourceIndex, marker);
  if (markerLength < 3) return null;
  if (marker === "`") {
    const infoBacktickIndex = markdown.indexOf("`", markerCursor.sourceIndex + markerLength);
    if (infoBacktickIndex !== -1 && infoBacktickIndex < lineEndIndex) return null;
  }

  return { marker, length: markerLength };
}

function isMarkdownFenceCloser(
  markdown: string,
  cursor: MarkdownCursor,
  lineEndIndex: number,
  nonWhitespaceEndIndex: number,
  fence: MarkdownFence,
): boolean {
  const markerCursor = consumeMarkdownLeafIndent(markdown, cursor, lineEndIndex);
  if (markerCursor === null || markdown[markerCursor.sourceIndex] !== fence.marker) {
    return false;
  }

  const markerLength = countRepeatedCharacter(markdown, markerCursor.sourceIndex, fence.marker);
  if (markerLength < fence.length) return false;

  const trailingCursor = advanceMarkdownCursor(markerCursor, markerLength);
  return isMarkdownCursorBlank(trailingCursor, nonWhitespaceEndIndex);
}

function isMarkdownHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

function skipMarkdownHorizontalWhitespace(
  markdown: string,
  startIndex: number,
  lineEndIndex: number,
): number {
  let cursorIndex = startIndex;
  while (cursorIndex < lineEndIndex && isMarkdownHorizontalWhitespace(markdown[cursorIndex])) {
    cursorIndex += 1;
  }
  return cursorIndex;
}

function scanMarkdownThematicBreakState(
  markdown: string,
  lineStartIndex: number,
  lineEndIndex: number,
): MarkdownThematicBreakState {
  let lastNonAsteriskIndex = lineStartIndex - 1;
  let lastNonHyphenIndex = lineStartIndex - 1;
  let lastNonUnderscoreIndex = lineStartIndex - 1;
  for (let index = lineStartIndex; index < lineEndIndex; index += 1) {
    const character = markdown[index];
    if (isMarkdownHorizontalWhitespace(character)) continue;
    if (character !== "*") lastNonAsteriskIndex = index;
    if (character !== "-") lastNonHyphenIndex = index;
    if (character !== "_") lastNonUnderscoreIndex = index;
  }
  return { lastNonAsteriskIndex, lastNonHyphenIndex, lastNonUnderscoreIndex };
}

function parseMarkdownHtmlBlockStart(
  markdown: string,
  htmlCursor: MarkdownCursor,
  lineEndIndex: number,
): MarkdownHtmlBlockType | null {
  if (markdown[htmlCursor.sourceIndex] !== "<") {
    return null;
  }

  const startIndex = htmlCursor.sourceIndex;
  const line = markdown.slice(startIndex, lineEndIndex);
  if (/^<(?:pre|script|style|textarea)(?:[ \t]|>|$)/iu.test(line)) return 1;
  if (line.startsWith("<!--")) return 2;
  if (line.startsWith("<?")) return 3;
  if (line.startsWith("<![CDATA[")) return 5;
  if (/^<![A-Za-z]/u.test(line)) return 4;

  const typeSixMatch = htmlBlockTypeSixStartPattern.exec(line);
  const typeSixTagName = typeSixMatch?.[1]?.toLowerCase();
  if (typeSixTagName !== undefined && htmlBlockTypeSixTagNames.has(typeSixTagName)) {
    return 6;
  }

  if (completeHtmlClosingTagPattern.test(line)) {
    return 7;
  }
  const openingTagMatch = completeHtmlOpeningTagPattern.exec(line);
  const openingTagName = openingTagMatch?.[1]?.toLowerCase();
  if (openingTagName !== undefined
      && !htmlBlockTypeSevenExcludedOpeningTagNames.has(openingTagName)) {
    return 7;
  }
  return null;
}

function doesMarkdownHtmlBlockEnd(
  markdown: string,
  lineStartIndex: number,
  lineEndIndex: number,
  htmlBlockType: MarkdownHtmlBlockType,
): boolean {
  const line = markdown.slice(lineStartIndex, lineEndIndex);
  if (htmlBlockType === 1) return htmlBlockTypeOneEndPattern.test(line);
  if (htmlBlockType === 2) return line.includes("-->");
  if (htmlBlockType === 3) return line.includes("?>");
  if (htmlBlockType === 4) return line.includes(">");
  return htmlBlockType === 5 && line.includes("]]>");
}

function isMarkdownAtxHeading(
  markdown: string,
  headingCursor: MarkdownCursor,
  lineEndIndex: number,
): boolean {
  if (markdown[headingCursor.sourceIndex] !== "#") {
    return false;
  }

  let markerEndIndex = headingCursor.sourceIndex;
  while (markdown[markerEndIndex] === "#") {
    markerEndIndex += 1;
  }
  const markerLength = markerEndIndex - headingCursor.sourceIndex;
  const followingCharacter = markdown[headingCursor.sourceIndex + markerLength];
  return markerLength >= 1 && markerLength <= 6
    && (headingCursor.sourceIndex + markerLength === lineEndIndex
      || isMarkdownHorizontalWhitespace(followingCharacter));
}

function isMarkdownSetextUnderline(
  markdown: string,
  cursor: MarkdownCursor,
  lineEndIndex: number,
): boolean {
  const underlineCursor = consumeMarkdownLeafIndent(markdown, cursor, lineEndIndex);
  if (underlineCursor === null) return false;

  const marker = markdown[underlineCursor.sourceIndex];
  if (marker !== "=" && marker !== "-") return false;
  let cursorIndex = underlineCursor.sourceIndex;
  while (markdown[cursorIndex] === marker) {
    cursorIndex += 1;
  }
  return cursorIndex > underlineCursor.sourceIndex
    && skipMarkdownHorizontalWhitespace(markdown, cursorIndex, lineEndIndex) === lineEndIndex;
}

function isMarkdownThematicBreak(
  markdown: string,
  breakCursor: MarkdownCursor,
  lineEndIndex: number,
  thematicBreakState: MarkdownThematicBreakState,
): boolean {
  const marker = markdown[breakCursor.sourceIndex];
  if (marker !== "*" && marker !== "-" && marker !== "_") return false;
  const lastNonMarkerIndex = marker === "*"
    ? thematicBreakState.lastNonAsteriskIndex
    : marker === "-"
      ? thematicBreakState.lastNonHyphenIndex
      : thematicBreakState.lastNonUnderscoreIndex;
  if (lastNonMarkerIndex >= breakCursor.sourceIndex) return false;

  let markerCount = 0;
  for (let index = breakCursor.sourceIndex; index < lineEndIndex; index += 1) {
    const character = markdown[index];
    if (character === marker) {
      markerCount += 1;
    } else if (!isMarkdownHorizontalWhitespace(character)) {
      return false;
    }
  }
  return markerCount >= 3;
}

function classifyMarkdownBlockStart(
  markdown: string,
  cursor: MarkdownCursor,
  lineEndIndex: number,
  thematicBreakState: MarkdownThematicBreakState,
): MarkdownBlockStart {
  const markerCursor = consumeMarkdownLeafIndent(markdown, cursor, lineEndIndex);
  if (markerCursor === null) return markdownParagraphStart;

  const marker = markdown[markerCursor.sourceIndex];
  if (marker === "*" || marker === "-" || marker === "_") {
    if (isMarkdownThematicBreak(markdown, markerCursor, lineEndIndex, thematicBreakState)) {
      return markdownThematicBreakStart;
    }
  }
  if (marker === "#"
      && isMarkdownAtxHeading(markdown, markerCursor, lineEndIndex)) {
    return markdownAtxHeadingStart;
  }
  if (marker === "`" || marker === "~") {
    const fence = parseMarkdownFenceOpener(markdown, markerCursor, lineEndIndex);
    if (fence !== null) return { kind: "fence", fence };
  }
  if (marker === ">") {
    const contentCursor = parseMarkdownBlockQuoteMarker(markdown, markerCursor, lineEndIndex);
    if (contentCursor !== null) return { kind: "blockquote", contentCursor };
  }
  if (marker === "<") {
    const htmlBlockType = parseMarkdownHtmlBlockStart(markdown, markerCursor, lineEndIndex);
    if (htmlBlockType !== null) return { kind: "html", htmlBlockType };
  }
  if (
    marker === "-" || marker === "+" || marker === "*"
    || (marker !== undefined && marker >= "0" && marker <= "9")
  ) {
    const listMarker = parseMarkdownListMarker(markdown, markerCursor, lineEndIndex);
    if (listMarker !== null) return { kind: "list", marker: listMarker };
  }
  return markdownParagraphStart;
}

function canMarkdownBlockInterruptParagraph(blockStart: MarkdownBlockStart): boolean {
  if (blockStart.kind === "paragraph") return false;
  if (blockStart.kind === "html") return blockStart.htmlBlockType !== 7;
  if (blockStart.kind !== "list") return true;
  return !blockStart.marker.isBlank
    && (blockStart.marker.container.orderedStart === null
      || blockStart.marker.container.orderedStart === 1);
}

function canMarkdownBlockContinueAfterContainerMismatch(
  blockStart: MarkdownBlockStart,
): boolean {
  return blockStart.kind === "paragraph"
    || (blockStart.kind === "html" && blockStart.htmlBlockType === 7);
}

function isAsciiLetter(character: string | undefined): boolean {
  return character !== undefined
    && (
      (character >= "A" && character <= "Z")
      || (character >= "a" && character <= "z")
    );
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isAsciiAlphanumeric(character: string | undefined): boolean {
  return isAsciiLetter(character) || isAsciiDigit(character);
}

function isMarkdownAutolinkSchemeCharacter(character: string | undefined): boolean {
  return isAsciiAlphanumeric(character)
    || character === "."
    || character === "+"
    || character === "-";
}

function isMarkdownEmailLocalCharacter(character: string | undefined): boolean {
  return isAsciiAlphanumeric(character)
    || character === "."
    || character === "!"
    || character === "#"
    || character === "$"
    || character === "%"
    || character === "&"
    || character === "'"
    || character === "*"
    || character === "+"
    || character === "/"
    || character === "="
    || character === "?"
    || character === "^"
    || character === "_"
    || character === "`"
    || character === "{"
    || character === "|"
    || character === "}"
    || character === "~"
    || character === "-";
}

function matchMarkdownEmailAutolinkEnd(
  markdown: string,
  startIndex: number,
  lineEndIndex: number,
): number | null {
  let cursorIndex = startIndex + 1;
  const localStartIndex = cursorIndex;
  while (
    cursorIndex < lineEndIndex
    && isMarkdownEmailLocalCharacter(markdown[cursorIndex])
  ) {
    cursorIndex += 1;
  }
  if (cursorIndex === localStartIndex || markdown[cursorIndex] !== "@") {
    return null;
  }

  cursorIndex += 1;
  let domainLabelLength = 0;
  let domainLabelEndsWithAlphanumeric = false;
  while (cursorIndex < lineEndIndex) {
    const character = markdown[cursorIndex];
    if (isAsciiAlphanumeric(character)) {
      domainLabelLength += 1;
      if (domainLabelLength > 63) return null;
      domainLabelEndsWithAlphanumeric = true;
      cursorIndex += 1;
      continue;
    }
    if (character === "-") {
      if (domainLabelLength === 0) return null;
      domainLabelLength += 1;
      if (domainLabelLength > 63) return null;
      domainLabelEndsWithAlphanumeric = false;
      cursorIndex += 1;
      continue;
    }
    if (character === ".") {
      if (!domainLabelEndsWithAlphanumeric) return null;
      domainLabelLength = 0;
      domainLabelEndsWithAlphanumeric = false;
      cursorIndex += 1;
      continue;
    }
    if (character === ">" && domainLabelEndsWithAlphanumeric) {
      return cursorIndex + 1;
    }
    return null;
  }
  return null;
}

function matchMarkdownUriAutolinkEnd(
  markdown: string,
  startIndex: number,
  lineEndIndex: number,
): number | null {
  let cursorIndex = startIndex + 1;
  if (!isAsciiLetter(markdown[cursorIndex])) return null;

  cursorIndex += 1;
  let schemeLength = 1;
  while (
    cursorIndex < lineEndIndex
    && schemeLength < 32
    && isMarkdownAutolinkSchemeCharacter(markdown[cursorIndex])
  ) {
    schemeLength += 1;
    cursorIndex += 1;
  }
  if (schemeLength < 2 || markdown[cursorIndex] !== ":") {
    return null;
  }

  cursorIndex += 1;
  while (cursorIndex < lineEndIndex) {
    const character = markdown[cursorIndex];
    if (character === ">") return cursorIndex + 1;
    const characterCode = markdown.charCodeAt(cursorIndex);
    if (
      character === "<"
      || characterCode <= 0x20
      || characterCode === 0x7f
    ) {
      return null;
    }
    cursorIndex += 1;
  }
  return null;
}

function matchesMarkdownDelimiterAt(
  markdown: string,
  startIndex: number,
  delimiter: string,
  lineEndIndex: number,
): boolean {
  if (startIndex + delimiter.length > lineEndIndex) return false;
  for (let offset = 0; offset < delimiter.length; offset += 1) {
    if (markdown[startIndex + offset] !== delimiter[offset]) return false;
  }
  return true;
}

function scanMarkdownOpaqueDelimiterEnd(
  state: MarkdownInlineState,
  inspection: MarkdownLogicalInspection,
  delimiter: string,
  delimiterKind: MarkdownOpaqueDelimiter,
): number | null {
  if (state.opaqueDelimiterFailures[delimiterKind] !== 0) return null;

  while (true) {
    while (inspection.cursorIndex < inspection.lineEndIndex) {
      if (
        matchesMarkdownDelimiterAt(
          state.markdown,
          inspection.cursorIndex,
          delimiter,
          inspection.lineEndIndex,
        )
      ) {
        return inspection.cursorIndex + delimiter.length;
      }
      inspection.cursorIndex += 1;
    }
    if (!advanceMarkdownLogicalInspectionToNextLine(state, inspection)) {
      state.opaqueDelimiterFailures[delimiterKind] = 1;
      return null;
    }
  }
}

function matchMarkdownInlineHtmlCommentEnd(
  state: MarkdownInlineState,
  startIndex: number,
): number | null {
  if (state.markdown[startIndex + 4] === ">") {
    return startIndex + 5;
  }
  if (
    state.markdown[startIndex + 4] === "-"
    && state.markdown[startIndex + 5] === ">"
  ) {
    return startIndex + 6;
  }
  return scanMarkdownOpaqueDelimiterEnd(
    state,
    {
      cursorIndex: startIndex + 4,
      lineIndex: state.lineIndex,
      lineEndIndex: state.lineEndIndex,
    },
    "-->",
    MarkdownOpaqueDelimiter.Comment,
  );
}

function matchMarkdownInlineHtmlDeclarationEnd(
  state: MarkdownInlineState,
  startIndex: number,
): number | null {
  let cursorIndex = startIndex + 2;
  if (!isAsciiLetter(state.markdown[cursorIndex])) return null;
  while (isAsciiLetter(state.markdown[cursorIndex])) {
    cursorIndex += 1;
  }
  return scanMarkdownOpaqueDelimiterEnd(
    state,
    {
      cursorIndex,
      lineIndex: state.lineIndex,
      lineEndIndex: state.lineEndIndex,
    },
    ">",
    MarkdownOpaqueDelimiter.Declaration,
  );
}

function isMarkdownInlineHtmlWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

function skipMarkdownInlineHtmlWhitespace(
  state: MarkdownInlineState,
  inspection: MarkdownLogicalInspection,
): boolean {
  let consumedWhitespace = false;
  while (true) {
    while (
      inspection.cursorIndex < inspection.lineEndIndex
      && isMarkdownInlineHtmlWhitespace(state.markdown[inspection.cursorIndex])
    ) {
      inspection.cursorIndex += 1;
      consumedWhitespace = true;
    }
    if (inspection.cursorIndex < inspection.lineEndIndex) {
      return consumedWhitespace;
    }
    if (!advanceMarkdownLogicalInspectionToNextLine(state, inspection)) {
      return consumedWhitespace;
    }
    consumedWhitespace = true;
  }
}

function isMarkdownInlineHtmlAttributeNameStart(character: string | undefined): boolean {
  return isAsciiLetter(character) || character === "_" || character === ":";
}

function isMarkdownInlineHtmlAttributeNameCharacter(character: string | undefined): boolean {
  return isMarkdownInlineHtmlAttributeNameStart(character)
    || isAsciiDigit(character)
    || character === "."
    || character === "-";
}

function isMarkdownInlineHtmlUnquotedValueCharacter(character: string | undefined): boolean {
  return character !== undefined
    && character !== " "
    && character !== "\t"
    && character !== "\r"
    && character !== "\n"
    && character !== "\""
    && character !== "'"
    && character !== "="
    && character !== "<"
    && character !== ">"
    && character !== "`";
}

function scanMarkdownInlineHtmlQuotedValueEnd(
  state: MarkdownInlineState,
  inspection: MarkdownLogicalInspection,
  quote: "\"" | "'",
): number | null {
  const delimiterKind = quote === "\""
    ? MarkdownOpaqueDelimiter.DoubleQuote
    : MarkdownOpaqueDelimiter.SingleQuote;
  if (state.opaqueDelimiterFailures[delimiterKind] !== 0) return null;

  while (true) {
    while (
      inspection.cursorIndex < inspection.lineEndIndex
      && state.markdown[inspection.cursorIndex] !== quote
    ) {
      inspection.cursorIndex += 1;
    }
    if (inspection.cursorIndex < inspection.lineEndIndex) {
      inspection.cursorIndex += 1;
      return inspection.cursorIndex;
    }
    if (!advanceMarkdownLogicalInspectionToNextLine(state, inspection)) {
      state.opaqueDelimiterFailures[delimiterKind] = 1;
      return null;
    }
  }
}

function matchMarkdownInlineHtmlOpeningTagEnd(
  state: MarkdownInlineState,
  startIndex: number,
): number | null {
  const markdown = state.markdown;
  const inspection: MarkdownLogicalInspection = {
    cursorIndex: startIndex + 1,
    lineIndex: state.lineIndex,
    lineEndIndex: state.lineEndIndex,
  };
  if (!isAsciiLetter(markdown[inspection.cursorIndex])) return null;

  inspection.cursorIndex += 1;
  while (
    inspection.cursorIndex < inspection.lineEndIndex
    && (
      isAsciiAlphanumeric(markdown[inspection.cursorIndex])
      || markdown[inspection.cursorIndex] === "-"
    )
  ) {
    inspection.cursorIndex += 1;
  }

  while (true) {
    if (markdown[inspection.cursorIndex] === ">") {
      return inspection.cursorIndex + 1;
    }
    if (
      markdown[inspection.cursorIndex] === "/"
      && markdown[inspection.cursorIndex + 1] === ">"
    ) {
      return inspection.cursorIndex + 2;
    }

    if (!skipMarkdownInlineHtmlWhitespace(state, inspection)) return null;
    if (markdown[inspection.cursorIndex] === ">") {
      return inspection.cursorIndex + 1;
    }
    if (
      markdown[inspection.cursorIndex] === "/"
      && markdown[inspection.cursorIndex + 1] === ">"
    ) {
      return inspection.cursorIndex + 2;
    }
    if (!isMarkdownInlineHtmlAttributeNameStart(markdown[inspection.cursorIndex])) {
      return null;
    }

    inspection.cursorIndex += 1;
    while (
      inspection.cursorIndex < inspection.lineEndIndex
      && isMarkdownInlineHtmlAttributeNameCharacter(markdown[inspection.cursorIndex])
    ) {
      inspection.cursorIndex += 1;
    }

    const equalsInspection: MarkdownLogicalInspection = { ...inspection };
    skipMarkdownInlineHtmlWhitespace(state, equalsInspection);
    if (markdown[equalsInspection.cursorIndex] !== "=") {
      continue;
    }

    inspection.cursorIndex = equalsInspection.cursorIndex + 1;
    inspection.lineIndex = equalsInspection.lineIndex;
    inspection.lineEndIndex = equalsInspection.lineEndIndex;
    skipMarkdownInlineHtmlWhitespace(state, inspection);
    const quote = markdown[inspection.cursorIndex];
    if (quote === "\"" || quote === "'") {
      inspection.cursorIndex += 1;
      const quotedValueEndIndex = scanMarkdownInlineHtmlQuotedValueEnd(
        state,
        inspection,
        quote,
      );
      if (quotedValueEndIndex === null) return null;
      continue;
    }

    const valueStartIndex = inspection.cursorIndex;
    while (
      inspection.cursorIndex < inspection.lineEndIndex
      && isMarkdownInlineHtmlUnquotedValueCharacter(markdown[inspection.cursorIndex])
    ) {
      inspection.cursorIndex += 1;
    }
    if (inspection.cursorIndex === valueStartIndex) return null;
  }
}

function matchMarkdownInlineHtmlClosingTagEnd(
  state: MarkdownInlineState,
  startIndex: number,
): number | null {
  const markdown = state.markdown;
  const inspection: MarkdownLogicalInspection = {
    cursorIndex: startIndex + 2,
    lineIndex: state.lineIndex,
    lineEndIndex: state.lineEndIndex,
  };
  if (!isAsciiLetter(markdown[inspection.cursorIndex])) return null;
  inspection.cursorIndex += 1;
  while (
    inspection.cursorIndex < inspection.lineEndIndex
    && (
      isAsciiAlphanumeric(markdown[inspection.cursorIndex])
      || markdown[inspection.cursorIndex] === "-"
    )
  ) {
    inspection.cursorIndex += 1;
  }
  skipMarkdownInlineHtmlWhitespace(state, inspection);
  return markdown[inspection.cursorIndex] === ">" ? inspection.cursorIndex + 1 : null;
}

function matchMarkdownInlineHtmlEnd(
  state: MarkdownInlineState,
  startIndex: number,
): number | null {
  const markdown = state.markdown;
  if (markdown[startIndex + 1] === "/") {
    return matchMarkdownInlineHtmlClosingTagEnd(state, startIndex);
  }
  if (matchesMarkdownDelimiterAt(markdown, startIndex, "<!--", state.lineEndIndex)) {
    return matchMarkdownInlineHtmlCommentEnd(state, startIndex);
  }
  if (matchesMarkdownDelimiterAt(markdown, startIndex, "<?", state.lineEndIndex)) {
    return scanMarkdownOpaqueDelimiterEnd(
      state,
      {
        cursorIndex: startIndex + 2,
        lineIndex: state.lineIndex,
        lineEndIndex: state.lineEndIndex,
      },
      "?>",
      MarkdownOpaqueDelimiter.ProcessingInstruction,
    );
  }
  if (matchesMarkdownDelimiterAt(markdown, startIndex, "<![CDATA[", state.lineEndIndex)) {
    return scanMarkdownOpaqueDelimiterEnd(
      state,
      {
        cursorIndex: startIndex + 9,
        lineIndex: state.lineIndex,
        lineEndIndex: state.lineEndIndex,
      },
      "]]>",
      MarkdownOpaqueDelimiter.Cdata,
    );
  }
  if (matchesMarkdownDelimiterAt(markdown, startIndex, "<!", state.lineEndIndex)) {
    return matchMarkdownInlineHtmlDeclarationEnd(state, startIndex);
  }
  return matchMarkdownInlineHtmlOpeningTagEnd(state, startIndex);
}

function matchMarkdownOpaqueSpanEnd(
  state: MarkdownInlineState,
  startIndex: number,
): number | null {
  return matchMarkdownEmailAutolinkEnd(
    state.markdown,
    startIndex,
    state.lineEndIndex,
  ) ?? matchMarkdownUriAutolinkEnd(
    state.markdown,
    startIndex,
    state.lineEndIndex,
  ) ?? matchMarkdownInlineHtmlEnd(state, startIndex);
}

function getCachedScanEndIndex(
  state: MarkdownInlineState,
  scanKind: MarkdownInlineScanKind,
  index: number,
): number | null {
  const scan = state.scans[scanKind];
  if (scan === undefined || index < scan[0] || index > scan[1]) {
    return null;
  }
  return scan[1];
}

function consumeMarkdownLinkToken(
  state: MarkdownInlineState,
  inspection: MarkdownLinkInspection,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): MarkdownLinkToken {
  const character = state.markdown[inspection.cursorIndex] ?? "";
  if (
    inspection.reentryIndex === null
    && (
      character === "\\"
      || character === "`"
      || character === "["
      || character === "]"
      || character === "!"
      || character === "<"
    )
  ) {
    inspection.reentryIndex = inspection.cursorIndex;
  }

  if (character === "\\") {
    inspection.precedingBackslashCount += 1;
    inspection.cursorIndex += 1;
    return { character, isEscaped: false };
  }

  const isEscaped = inspection.precedingBackslashCount % 2 === 1;
  inspection.precedingBackslashCount = 0;
  if (character === "`") {
    const markerLength = countRepeatedCharacter(state.markdown, inspection.cursorIndex, "`");
    const closingEndIndex = inspection.cursorIndex + markerLength;
    if (
      !isEscaped
      && closingEndIndex <= endIndex
      && inspection.activeCodeStop === null
      && codeFrameIndexByMarkerLength.has(markerLength)
    ) {
      inspection.activeCodeStop = { markerLength, closingEndIndex };
    }
    inspection.cursorIndex = closingEndIndex;
  } else {
    inspection.cursorIndex += 1;
  }

  return { character, isEscaped };
}

function advanceMarkdownLinkInspectionToCachedEnd(
  state: MarkdownInlineState,
  inspection: MarkdownLinkInspection,
  cachedEndIndex: number,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): void {
  while (
    inspection.cursorIndex < cachedEndIndex
    && inspection.reentryIndex === null
  ) {
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  }
  if (inspection.cursorIndex < cachedEndIndex) {
    inspection.cursorIndex = cachedEndIndex;
    inspection.precedingBackslashCount = 0;
    inspection.skippedSource = true;
  }
}

function skipMarkdownLinkWhitespace(
  state: MarkdownInlineState,
  inspection: MarkdownLinkInspection,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): boolean {
  const startIndex = inspection.cursorIndex;
  const cachedEndIndex = getCachedScanEndIndex(state, "whitespace", inspection.cursorIndex);
  if (cachedEndIndex !== null) {
    inspection.cursorIndex = cachedEndIndex;
    inspection.precedingBackslashCount = 0;
    return inspection.cursorIndex > startIndex;
  }

  const startLineIndex = inspection.lineIndex;
  while (
    inspection.cursorIndex < inspection.lineEndIndex
    && (
      state.markdown[inspection.cursorIndex] === " "
      || state.markdown[inspection.cursorIndex] === "\t"
    )
  ) {
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  }
  if (inspection.cursorIndex === inspection.lineEndIndex) {
    advanceMarkdownLinkInspectionToNextLine(state, inspection);
    while (
      inspection.cursorIndex < inspection.lineEndIndex
      && (
        state.markdown[inspection.cursorIndex] === " "
        || state.markdown[inspection.cursorIndex] === "\t"
      )
    ) {
      consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    }
  }
  if (inspection.lineIndex === startLineIndex) {
    state.scans.whitespace = [startIndex, inspection.cursorIndex];
  }
  return inspection.cursorIndex > startIndex || inspection.lineIndex !== startLineIndex;
}

function findActiveCodeStopInRange(
  markdown: string,
  startIndex: number,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): MarkdownCodeStop | null {
  let cursorIndex = startIndex;
  let precedingBackslashCount = 0;
  while (cursorIndex < endIndex) {
    const character = markdown[cursorIndex];
    if (character === "\\") {
      precedingBackslashCount += 1;
      cursorIndex += 1;
      continue;
    }

    const isEscaped = precedingBackslashCount % 2 === 1;
    precedingBackslashCount = 0;
    if (character !== "`") {
      cursorIndex += 1;
      continue;
    }

    const markerLength = countRepeatedCharacter(markdown, cursorIndex, "`");
    const closingEndIndex = cursorIndex + markerLength;
    if (
      !isEscaped
      && closingEndIndex <= endIndex
      && codeFrameIndexByMarkerLength.has(markerLength)
    ) {
      return { markerLength, closingEndIndex };
    }
    cursorIndex = closingEndIndex;
  }
  return null;
}

function createFailedMarkdownLinkAttempt(
  inspection: MarkdownLinkInspection,
): MarkdownLinkAttempt {
  return {
    kind: "failed",
    resumeIndex: inspection.reentryIndex ?? inspection.cursorIndex,
  };
}

function isMarkdownLinkDestinationControl(character: string | undefined): boolean {
  if (character === undefined) return false;
  const characterCode = character.charCodeAt(0);
  return characterCode <= 0x1f || characterCode === 0x7f;
}

function scanMarkdownAngleDestinationEnd(
  state: MarkdownInlineState,
  inspection: MarkdownLinkInspection,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): number | null {
  const markdown = state.markdown;
  consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  const destinationStartIndex = inspection.cursorIndex;
  const cachedEndIndex = getCachedScanEndIndex(state, "angled", destinationStartIndex);
  if (cachedEndIndex !== null) {
    advanceMarkdownLinkInspectionToCachedEnd(
      state,
      inspection,
      cachedEndIndex,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (
      inspection.cursorIndex >= inspection.lineEndIndex
      || markdown[inspection.cursorIndex] !== ">"
    ) {
      return null;
    }
    const destinationEndIndex = inspection.cursorIndex;
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    return destinationEndIndex;
  }

  let canCacheScan = true;
  while (inspection.cursorIndex < inspection.lineEndIndex) {
    const tokenStartIndex = inspection.cursorIndex;
    const token = consumeMarkdownLinkToken(
      state,
      inspection,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (token.character === "\\") {
      canCacheScan = false;
      continue;
    }
    if (token.character === ">" && !token.isEscaped) {
      if (canCacheScan) {
        state.scans.angled = [destinationStartIndex, tokenStartIndex];
      }
      return tokenStartIndex;
    }
    if (token.character === "<" && !token.isEscaped) {
      return null;
    }
  }

  if (canCacheScan) {
    state.scans.angled = [destinationStartIndex, inspection.cursorIndex];
  }
  return null;
}

function scanMarkdownBareDestinationEnd(
  state: MarkdownInlineState,
  inspection: MarkdownLinkInspection,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): number | null {
  const destinationStartIndex = inspection.cursorIndex;
  const cachedEndIndex = getCachedScanEndIndex(state, "bare", destinationStartIndex);
  if (cachedEndIndex !== null) {
    advanceMarkdownLinkInspectionToCachedEnd(
      state,
      inspection,
      cachedEndIndex,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    return inspection.cursorIndex > destinationStartIndex
      ? inspection.cursorIndex
      : null;
  }

  let parenthesisDepth = 0;
  let canCacheScan = true;
  while (inspection.cursorIndex < inspection.lineEndIndex) {
    const character = state.markdown[inspection.cursorIndex];
    if (character === " " || character === "\t") {
      break;
    }
    if (isMarkdownLinkDestinationControl(character)) {
      return null;
    }

    const tokenStartIndex = inspection.cursorIndex;
    const token = consumeMarkdownLinkToken(
      state,
      inspection,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (token.character === "\\") {
      canCacheScan = false;
      continue;
    }
    if (token.isEscaped) {
      continue;
    }
    if (token.character === "(") {
      canCacheScan = false;
      parenthesisDepth += 1;
      if (parenthesisDepth > markdownMaximumLinkDestinationParenthesisDepth) {
        return null;
      }
      continue;
    }
    if (token.character !== ")") {
      continue;
    }
    if (parenthesisDepth === 0) {
      inspection.cursorIndex = tokenStartIndex;
      inspection.precedingBackslashCount = 0;
      break;
    }
    canCacheScan = false;
    parenthesisDepth -= 1;
  }

  if (
    inspection.cursorIndex === destinationStartIndex
    || parenthesisDepth !== 0
  ) {
    return null;
  }
  if (canCacheScan) {
    state.scans.bare = [destinationStartIndex, inspection.cursorIndex];
  }
  return inspection.cursorIndex;
}

function scanMarkdownLinkTitle(
  state: MarkdownInlineState,
  inspection: MarkdownLinkInspection,
  endIndex: number,
  titleDelimiter: "\"" | "'" | "(",
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): boolean {
  consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  const titleStartIndex = inspection.cursorIndex;
  const titleClosingDelimiter = titleDelimiter === "(" ? ")" : titleDelimiter;
  const cachedEndIndex = getCachedScanEndIndex(state, titleDelimiter, titleStartIndex);
  if (cachedEndIndex !== null) {
    advanceMarkdownLinkInspectionToCachedEnd(
      state,
      inspection,
      cachedEndIndex,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (
      inspection.cursorIndex >= inspection.lineEndIndex
      || state.markdown[inspection.cursorIndex] !== titleClosingDelimiter
    ) {
      return false;
    }
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    return true;
  }

  let canCacheScan = true;
  while (true) {
    if (inspection.cursorIndex >= inspection.lineEndIndex) {
      if (!advanceMarkdownLinkInspectionToNextLine(state, inspection)) {
        if (canCacheScan) {
          state.scans[titleDelimiter] = [titleStartIndex, inspection.cursorIndex];
        }
        return false;
      }
      canCacheScan = false;
      continue;
    }
    const tokenStartIndex = inspection.cursorIndex;
    const token = consumeMarkdownLinkToken(
      state,
      inspection,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (token.character === "\\") {
      canCacheScan = false;
      continue;
    }
    if (
      titleDelimiter === "("
      && token.character === "("
      && !token.isEscaped
    ) {
      return false;
    }
    if (
      token.character === titleClosingDelimiter
      && !token.isEscaped
    ) {
      if (canCacheScan) {
        state.scans[titleDelimiter] = [titleStartIndex, tokenStartIndex];
      }
      return true;
    }
  }
}

function parseMarkdownLinkDestinationAfterLabel(
  state: MarkdownInlineState,
  labelStartIndex: number,
  labelCloseIndex: number,
  isImage: boolean,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): MarkdownLinkAttempt {
  const markdown = state.markdown;
  if (markdown[labelCloseIndex + 1] !== "(") {
    return { kind: "failed", resumeIndex: labelCloseIndex + 1 };
  }

  const inspection: MarkdownLinkInspection = {
    cursorIndex: labelCloseIndex + 1,
    lineIndex: state.lineIndex,
    lineEndIndex: state.lineEndIndex,
    precedingBackslashCount: 0,
    reentryIndex: null,
    activeCodeStop: null,
    skippedSource: false,
  };
  consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  skipMarkdownLinkWhitespace(state, inspection, endIndex, codeFrameIndexByMarkerLength);

  let destinationStartIndex = inspection.cursorIndex;
  let destinationEndIndex: number;
  let hasDestination = true;
  if (markdown[inspection.cursorIndex] === ")") {
    hasDestination = false;
    destinationEndIndex = destinationStartIndex;
  } else if (markdown[inspection.cursorIndex] === "<") {
    destinationStartIndex += 1;
    const scannedEndIndex = scanMarkdownAngleDestinationEnd(
      state,
      inspection,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (scannedEndIndex === null) {
      return createFailedMarkdownLinkAttempt(inspection);
    }
    destinationEndIndex = scannedEndIndex;
    hasDestination = destinationStartIndex < destinationEndIndex;
  } else {
    const scannedEndIndex = scanMarkdownBareDestinationEnd(
      state,
      inspection,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (scannedEndIndex === null) {
      return createFailedMarkdownLinkAttempt(inspection);
    }
    destinationEndIndex = scannedEndIndex;
  }

  if (!hasDestination && markdown[inspection.cursorIndex] === ")") {
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  } else {
    const hasTitleSeparator = skipMarkdownLinkWhitespace(
      state,
      inspection,
      endIndex,
      codeFrameIndexByMarkerLength,
    );
    if (markdown[inspection.cursorIndex] !== ")") {
      const titleDelimiter = markdown[inspection.cursorIndex];
      if (
        !hasTitleSeparator
        || (titleDelimiter !== "\"" && titleDelimiter !== "'" && titleDelimiter !== "(")
      ) {
        if (inspection.cursorIndex < inspection.lineEndIndex) {
          consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
        }
        return createFailedMarkdownLinkAttempt(inspection);
      }
      if (!scanMarkdownLinkTitle(
        state,
        inspection,
        endIndex,
        titleDelimiter,
        codeFrameIndexByMarkerLength,
      )) {
        return createFailedMarkdownLinkAttempt(inspection);
      }
      skipMarkdownLinkWhitespace(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    }

    if (
      inspection.cursorIndex >= inspection.lineEndIndex
      || markdown[inspection.cursorIndex] !== ")"
    ) {
      if (inspection.cursorIndex < inspection.lineEndIndex) {
        consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
      }
      return createFailedMarkdownLinkAttempt(inspection);
    }
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  }

  const activeCodeStop = inspection.skippedSource
    ? findActiveCodeStopInRange(
      markdown,
      labelCloseIndex + 1,
      inspection.cursorIndex,
      codeFrameIndexByMarkerLength,
    )
    : inspection.activeCodeStop;
  return {
    kind: "destination",
    destination: {
      labelStartIndex,
      labelEndIndex: labelCloseIndex + 1,
      startIndex: destinationStartIndex,
      endIndex: destinationEndIndex,
      linkEndIndex: inspection.cursorIndex,
      hasDestination,
      isImage,
    },
    activeCodeStop,
  };
}

function materializeMarkdownContainerStack(
  containerStacks: Array<ReadonlyArray<MarkdownContainer>>,
  currentStackId: number,
  containers: ReadonlyArray<MarkdownContainer>,
): number {
  const currentContainers = containerStacks[currentStackId];
  if (currentContainers === undefined) {
    throw new Error(`Markdown container stack is missing at index ${currentStackId}.`);
  }
  if (currentContainers === containers) return currentStackId;
  if (
    currentContainers.length === containers.length
    && currentContainers.every((container, index) => container === containers[index])
  ) {
    return currentStackId;
  }

  containerStacks.push(containers);
  return containerStacks.length - 1;
}

function scanMarkdownBlocks(markdown: string): MarkdownBlockScan {
  const lineChunks: Array<Int32Array> = [];
  let lineCount = 0;
  const containerStacks: Array<ReadonlyArray<MarkdownContainer>> = [[]];
  const proseRanges: Array<MarkdownProseRange> = [];
  const fencedCodeRanges: Array<MarkdownSourceRange> = [];
  let containerStackId = 0;
  let activeParagraphId: number | null = null;
  let nextParagraphId = 0;
  let activeProseStartIndex: number | null = null;
  let activeProseStartLineIndex: number | null = null;
  let activeProseEndIndex = 0;
  let activeFence: MarkdownFence | null = null;
  let activeFenceStartIndex: number | null = null;
  let activeHtmlBlockType: MarkdownHtmlBlockType | null = null;

  const closeParagraph = (): void => {
    if (activeProseStartIndex !== null) {
      if (activeProseStartLineIndex === null) {
        throw new Error("Markdown prose range is missing its starting line index.");
      }
      proseRanges.push({
        startIndex: activeProseStartIndex,
        endIndex: activeProseEndIndex,
        startLineIndex: activeProseStartLineIndex,
      });
    }
    activeParagraphId = null;
    activeProseStartIndex = null;
    activeProseStartLineIndex = null;
  };

  const appendLine = (
    lineStartIndex: number,
    lineEndIndex: number,
    nextLineStartIndex: number,
    contentStartIndex: number,
    lineContainerStackId: number,
    paragraphId: number | null,
    blockKind: MarkdownBlockKind,
  ): void => {
    const lineInChunkIndex = lineCount % markdownLineChunkCapacity;
    if (lineInChunkIndex === 0) {
      lineChunks.push(new Int32Array(markdownLineChunkCapacity * MarkdownLineField.Count));
    }
    const lineChunk = lineChunks[lineChunks.length - 1];
    if (lineChunk === undefined) throw new Error("Markdown line chunk was not allocated.");
    const fieldStartIndex = lineInChunkIndex * MarkdownLineField.Count;
    lineChunk[fieldStartIndex + MarkdownLineField.StartIndex] = lineStartIndex;
    lineChunk[fieldStartIndex + MarkdownLineField.EndIndex] = lineEndIndex;
    lineChunk[fieldStartIndex + MarkdownLineField.NextStartIndex] = nextLineStartIndex;
    lineChunk[fieldStartIndex + MarkdownLineField.ContentStartIndex] = contentStartIndex;
    lineChunk[fieldStartIndex + MarkdownLineField.ContainerStackId] = lineContainerStackId;
    lineChunk[fieldStartIndex + MarkdownLineField.ParagraphId] = paragraphId ?? -1;
    lineChunk[fieldStartIndex + MarkdownLineField.BlockKind] = blockKind;
    lineCount += 1;
  };

  let lineStartIndex = 0;
  while (lineStartIndex < markdown.length) {
    const newlineIndex = markdown.indexOf("\n", lineStartIndex);
    const rawLineEndIndex = newlineIndex === -1 ? markdown.length : newlineIndex;
    const lineEndIndex = rawLineEndIndex > lineStartIndex && markdown[rawLineEndIndex - 1] === "\r"
      ? rawLineEndIndex - 1
      : rawLineEndIndex;
    const nextLineStartIndex = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
    const nonWhitespaceEndIndex = getMarkdownNonWhitespaceEndIndex(
      markdown,
      lineStartIndex,
      lineEndIndex,
    );
    const activeContainers = containerStacks[containerStackId];
    if (activeContainers === undefined) {
      throw new Error(`Markdown container stack is missing at index ${containerStackId}.`);
    }

    const containerMatch = matchMarkdownContainers(
      markdown,
      lineStartIndex,
      lineEndIndex,
      nonWhitespaceEndIndex,
      activeContainers,
    );

    if (activeFence !== null) {
      if (containerMatch.matchedCount === activeContainers.length) {
        containerStackId = materializeMarkdownContainerStack(containerStacks, containerStackId,
          containerMatch.containers);
        const closesFence = isMarkdownFenceCloser(
          markdown,
          containerMatch.cursor,
          lineEndIndex,
          nonWhitespaceEndIndex,
          activeFence,
        );
        appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex,
          containerMatch.cursor.sourceIndex, containerStackId, null, MarkdownBlockKind.FencedCode);
        if (closesFence) {
          if (activeFenceStartIndex === null) {
            throw new Error("Markdown fenced code block is missing its start index.");
          }
          fencedCodeRanges.push({ startIndex: activeFenceStartIndex, endIndex: nextLineStartIndex });
          activeFence = null;
          activeFenceStartIndex = null;
        }
        lineStartIndex = nextLineStartIndex;
        continue;
      }

      if (activeFenceStartIndex === null) {
        throw new Error("Markdown fenced code block is missing its start index.");
      }
      fencedCodeRanges.push({ startIndex: activeFenceStartIndex, endIndex: lineStartIndex });
      activeFence = null;
      activeFenceStartIndex = null;
    }

    if (activeHtmlBlockType !== null) {
      if (containerMatch.matchedCount === activeContainers.length) {
        const htmlEndsBeforeBlank = (
          (activeHtmlBlockType === 6 || activeHtmlBlockType === 7)
          && isMarkdownCursorBlank(containerMatch.cursor, nonWhitespaceEndIndex)
        );
        if (!htmlEndsBeforeBlank) {
          containerStackId = materializeMarkdownContainerStack(containerStacks, containerStackId,
            containerMatch.containers);
          appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex,
            containerMatch.cursor.sourceIndex, containerStackId, null, MarkdownBlockKind.Html);
          if (
            doesMarkdownHtmlBlockEnd(
              markdown,
              containerMatch.cursor.sourceIndex,
              lineEndIndex,
              activeHtmlBlockType,
            )
          ) {
            activeHtmlBlockType = null;
          }
          lineStartIndex = nextLineStartIndex;
          continue;
        }
      }
      activeHtmlBlockType = null;
    }

    const thematicBreakState = scanMarkdownThematicBreakState(
      markdown,
      lineStartIndex,
      lineEndIndex,
    );
    let lineCursor = containerMatch.cursor;
    let nextContainers: ReadonlyArray<MarkdownContainer> = containerMatch.containers;
    let blockStart: MarkdownBlockStart | null = null;
    const allContainersMatched = containerMatch.matchedCount === activeContainers.length;
    if (!allContainersMatched) {
      if (
        activeParagraphId !== null
        && !isMarkdownCursorBlank(lineCursor, nonWhitespaceEndIndex)
      ) {
        blockStart = classifyMarkdownBlockStart(
          markdown,
          lineCursor,
          lineEndIndex,
          thematicBreakState,
        );
      }
      const isLazyParagraphContinuation = (
        activeParagraphId !== null
        && !isMarkdownCursorBlank(lineCursor, nonWhitespaceEndIndex)
        && blockStart !== null
        && canMarkdownBlockContinueAfterContainerMismatch(blockStart)
      );
      if (isLazyParagraphContinuation) {
        containerStackId = materializeMarkdownContainerStack(containerStacks, containerStackId,
          nextContainers);
        activeProseEndIndex = nextLineStartIndex;
        appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
          containerStackId, activeParagraphId, MarkdownBlockKind.Prose);
        lineStartIndex = nextLineStartIndex;
        continue;
      }

      closeParagraph();
      nextContainers = nextContainers.slice(0, containerMatch.matchedCount);
    } else if (isMarkdownCursorBlank(lineCursor, nonWhitespaceEndIndex)) {
      closeParagraph();
      containerStackId = materializeMarkdownContainerStack(containerStacks, containerStackId,
        nextContainers);
      appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
        containerStackId, null, MarkdownBlockKind.Prose);
      lineStartIndex = nextLineStartIndex;
      continue;
    } else if (activeParagraphId !== null) {
      if (isMarkdownSetextUnderline(markdown, lineCursor, lineEndIndex)) {
        closeParagraph();
        containerStackId = materializeMarkdownContainerStack(containerStacks, containerStackId,
          nextContainers);
        appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
          containerStackId, null, MarkdownBlockKind.Prose);
        lineStartIndex = nextLineStartIndex;
        continue;
      }
      blockStart = classifyMarkdownBlockStart(
        markdown,
        lineCursor,
        lineEndIndex,
        thematicBreakState,
      );
      if (!canMarkdownBlockInterruptParagraph(blockStart)) {
        containerStackId = materializeMarkdownContainerStack(containerStacks, containerStackId,
          nextContainers);
        activeProseEndIndex = nextLineStartIndex;
        appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
          containerStackId, activeParagraphId, MarkdownBlockKind.Prose);
        lineStartIndex = nextLineStartIndex;
        continue;
      }
      closeParagraph();
    }

    let mutableContainers: Array<MarkdownContainer> | null = null;
    while (!isMarkdownCursorBlank(lineCursor, nonWhitespaceEndIndex)) {
      blockStart ??= classifyMarkdownBlockStart(
        markdown,
        lineCursor,
        lineEndIndex,
        thematicBreakState,
      );
      if (blockStart.kind === "blockquote") {
        mutableContainers ??= [...nextContainers];
        mutableContainers.push({ kind: "blockquote" });
        nextContainers = mutableContainers;
        lineCursor = blockStart.contentCursor;
        blockStart = null;
        continue;
      }
      if (blockStart.kind === "list") {
        mutableContainers ??= [...nextContainers];
        mutableContainers.push(blockStart.marker.container);
        nextContainers = mutableContainers;
        lineCursor = blockStart.marker.contentCursor;
        blockStart = null;
        continue;
      }
      break;
    }

    containerStackId = materializeMarkdownContainerStack(containerStacks, containerStackId,
      nextContainers);
    if (isMarkdownCursorBlank(lineCursor, nonWhitespaceEndIndex)) {
      appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
        containerStackId, null, MarkdownBlockKind.Prose);
      lineStartIndex = nextLineStartIndex;
      continue;
    }

    blockStart ??= classifyMarkdownBlockStart(
      markdown,
      lineCursor,
      lineEndIndex,
      thematicBreakState,
    );
    if (blockStart.kind === "thematic-break") {
      appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
        containerStackId, null, MarkdownBlockKind.Prose);
      lineStartIndex = nextLineStartIndex;
      continue;
    }

    if (blockStart.kind === "fence") {
      activeFence = blockStart.fence;
      activeFenceStartIndex = lineStartIndex;
      appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
        containerStackId, null, MarkdownBlockKind.FencedCode);
      lineStartIndex = nextLineStartIndex;
      continue;
    }

    if (blockStart.kind === "html") {
      const htmlBlockType = blockStart.htmlBlockType;
      appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
        containerStackId, null, MarkdownBlockKind.Html);
      if (
        htmlBlockType !== 6
        && htmlBlockType !== 7
        && !doesMarkdownHtmlBlockEnd(
          markdown,
          lineCursor.sourceIndex,
          lineEndIndex,
          htmlBlockType,
        )
      ) {
        activeHtmlBlockType = htmlBlockType;
      } else if (htmlBlockType === 6 || htmlBlockType === 7) {
        activeHtmlBlockType = htmlBlockType;
      }
      lineStartIndex = nextLineStartIndex;
      continue;
    }

    const paragraphId = nextParagraphId;
    const paragraphStartLineIndex = lineCount;
    nextParagraphId += 1;
    appendLine(lineStartIndex, lineEndIndex, nextLineStartIndex, lineCursor.sourceIndex,
      containerStackId, paragraphId, MarkdownBlockKind.Prose);
    if (blockStart.kind === "atx-heading") {
      proseRanges.push({
        startIndex: lineStartIndex,
        endIndex: nextLineStartIndex,
        startLineIndex: paragraphStartLineIndex,
      });
    } else {
      activeParagraphId = paragraphId;
      activeProseStartIndex = lineStartIndex;
      activeProseStartLineIndex = paragraphStartLineIndex;
      activeProseEndIndex = nextLineStartIndex;
    }
    lineStartIndex = nextLineStartIndex;
  }

  closeParagraph();
  if (activeFenceStartIndex !== null) {
    fencedCodeRanges.push({ startIndex: activeFenceStartIndex, endIndex: markdown.length });
  }

  return {
    lines: { chunks: lineChunks, lineCount, fieldCount: MarkdownLineField.Count },
    containerStacks,
    proseRanges,
    fencedCodeRanges,
  };
}

function getMarkdownLineField(
  blockScan: MarkdownBlockScan,
  lineIndex: number,
  field: MarkdownLineField,
): number {
  if (lineIndex < 0 || lineIndex >= blockScan.lines.lineCount) {
    throw new Error(`Markdown line index is out of range: ${lineIndex}.`);
  }
  const lineChunk = blockScan.lines.chunks[
    Math.floor(lineIndex / markdownLineChunkCapacity)
  ];
  if (lineChunk === undefined) {
    throw new Error(`Markdown line chunk is missing for line index ${lineIndex}.`);
  }
  const fieldStartIndex = (
    lineIndex % markdownLineChunkCapacity
  ) * blockScan.lines.fieldCount;
  return lineChunk[fieldStartIndex + field] ?? -1;
}

type MarkdownNextLogicalLine = Readonly<{
  lineIndex: number;
  contentStartIndex: number;
  lineEndIndex: number;
}>;

function getMarkdownInlineLineEndIndex(
  markdown: string,
  startIndex: number,
  structuralLineEndIndex: number,
): number {
  let cursorIndex = startIndex;
  while (
    cursorIndex < structuralLineEndIndex
    && markdown[cursorIndex] !== "\r"
  ) {
    cursorIndex += 1;
  }
  return cursorIndex;
}

function getMarkdownNextLogicalLine(
  blockScan: MarkdownBlockScan,
  lineIndex: number,
  rangeEndIndex: number,
  paragraphId: number,
  containerStackId: number,
): MarkdownNextLogicalLine | null {
  const nextLineStartIndex = getMarkdownLineField(
    blockScan,
    lineIndex,
    MarkdownLineField.NextStartIndex,
  );
  if (nextLineStartIndex >= rangeEndIndex) {
    return null;
  }

  const nextLineIndex = lineIndex + 1;
  if (
    nextLineIndex >= blockScan.lines.lineCount
    || getMarkdownLineField(
      blockScan,
      nextLineIndex,
      MarkdownLineField.StartIndex,
    ) !== nextLineStartIndex
    || getMarkdownLineField(
      blockScan,
      nextLineIndex,
      MarkdownLineField.ParagraphId,
    ) !== paragraphId
    || getMarkdownLineField(
      blockScan,
      nextLineIndex,
      MarkdownLineField.ContainerStackId,
    ) !== containerStackId
    || getMarkdownLineField(
      blockScan,
      nextLineIndex,
      MarkdownLineField.BlockKind,
    ) !== MarkdownBlockKind.Prose
  ) {
    return null;
  }

  const contentStartIndex = getMarkdownLineField(
    blockScan,
    nextLineIndex,
    MarkdownLineField.ContentStartIndex,
  );
  const lineEndIndex = getMarkdownLineField(
    blockScan,
    nextLineIndex,
    MarkdownLineField.EndIndex,
  );
  if (contentStartIndex >= lineEndIndex) {
    return null;
  }
  return { lineIndex: nextLineIndex, contentStartIndex, lineEndIndex };
}

function createMarkdownInlineState(
  markdown: string,
  blockScan: MarkdownBlockScan,
  range: MarkdownProseRange,
): MarkdownInlineState {
  const lineIndex = range.startLineIndex;
  if (
    getMarkdownLineField(
      blockScan,
      lineIndex,
      MarkdownLineField.StartIndex,
    ) !== range.startIndex
  ) {
    throw new Error(`Markdown prose range has an invalid starting line at ${range.startIndex}.`);
  }
  const paragraphId = getMarkdownLineField(
    blockScan,
    lineIndex,
    MarkdownLineField.ParagraphId,
  );
  const blockKind = getMarkdownLineField(
    blockScan,
    lineIndex,
    MarkdownLineField.BlockKind,
  );
  if (paragraphId < 0 || blockKind !== MarkdownBlockKind.Prose) {
    throw new Error(`Markdown prose range starts outside prose at index ${range.startIndex}.`);
  }
  const contentStartIndex = getMarkdownLineField(
    blockScan,
    lineIndex,
    MarkdownLineField.ContentStartIndex,
  );
  return {
    markdown,
    blockScan,
    cursorIndex: Math.max(range.startIndex, contentStartIndex),
    lineIndex,
    lineEndIndex: getMarkdownInlineLineEndIndex(
      markdown,
      Math.max(range.startIndex, contentStartIndex),
      Math.min(
        getMarkdownLineField(blockScan, lineIndex, MarkdownLineField.EndIndex),
        range.endIndex,
      ),
    ),
    rangeEndIndex: range.endIndex,
    paragraphId,
    containerStackId: getMarkdownLineField(
      blockScan,
      lineIndex,
      MarkdownLineField.ContainerStackId,
    ),
    scans: {},
    opaqueDelimiterFailures: new Uint8Array(MarkdownOpaqueDelimiter.Count),
  };
}

function advanceMarkdownInlineStateToNextLine(state: MarkdownInlineState): boolean {
  if (
    state.lineEndIndex !== getMarkdownLineField(
      state.blockScan,
      state.lineIndex,
      MarkdownLineField.EndIndex,
    )
  ) {
    return false;
  }
  const nextLine = getMarkdownNextLogicalLine(
    state.blockScan,
    state.lineIndex,
    state.rangeEndIndex,
    state.paragraphId,
    state.containerStackId,
  );
  if (nextLine === null) return false;

  state.cursorIndex = nextLine.contentStartIndex;
  state.lineIndex = nextLine.lineIndex;
  state.lineEndIndex = getMarkdownInlineLineEndIndex(
    state.markdown,
    nextLine.contentStartIndex,
    nextLine.lineEndIndex,
  );
  state.scans = {};
  return true;
}

function advanceMarkdownInlineStatePastLoneCarriageReturn(
  state: MarkdownInlineState,
): boolean {
  const structuralLineEndIndex = getMarkdownLineField(
    state.blockScan,
    state.lineIndex,
    MarkdownLineField.EndIndex,
  );
  if (
    state.lineEndIndex >= structuralLineEndIndex
    || state.markdown[state.lineEndIndex] !== "\r"
  ) {
    return false;
  }

  state.cursorIndex = state.lineEndIndex + 1;
  state.lineEndIndex = getMarkdownInlineLineEndIndex(
    state.markdown,
    state.cursorIndex,
    structuralLineEndIndex,
  );
  state.scans = {};
  state.opaqueDelimiterFailures.fill(0);
  return true;
}

function advanceMarkdownInlineCursor(
  state: MarkdownInlineState,
  nextIndex: number,
): void {
  while (nextIndex > state.lineEndIndex) {
    if (!advanceMarkdownInlineStateToNextLine(state)) {
      throw new Error(`Markdown inline cursor crossed a structural boundary at index ${nextIndex}.`);
    }
  }
  state.cursorIndex = nextIndex;
}

function advanceMarkdownLogicalInspectionToNextLine(
  state: MarkdownInlineState,
  inspection: MarkdownLogicalInspection,
): boolean {
  if (
    inspection.lineEndIndex !== getMarkdownLineField(
      state.blockScan,
      inspection.lineIndex,
      MarkdownLineField.EndIndex,
    )
  ) {
    return false;
  }
  const nextLine = getMarkdownNextLogicalLine(
    state.blockScan,
    inspection.lineIndex,
    state.rangeEndIndex,
    state.paragraphId,
    state.containerStackId,
  );
  if (nextLine === null) return false;

  inspection.cursorIndex = nextLine.contentStartIndex;
  inspection.lineIndex = nextLine.lineIndex;
  inspection.lineEndIndex = getMarkdownInlineLineEndIndex(
    state.markdown,
    nextLine.contentStartIndex,
    nextLine.lineEndIndex,
  );
  return true;
}

function advanceMarkdownLinkInspectionToNextLine(
  state: MarkdownInlineState,
  inspection: MarkdownLinkInspection,
): boolean {
  if (!advanceMarkdownLogicalInspectionToNextLine(state, inspection)) {
    return false;
  }
  inspection.precedingBackslashCount = 0;
  inspection.skippedSource = true;
  return true;
}

function createMarkdownLabelStack(): MarkdownLabelStack {
  return {
    startIndexes: new Int32Array(markdownMaximumInlineLabelDepth),
    flags: new Uint8Array(markdownMaximumInlineLabelDepth),
    depth: 0,
  };
}

function pushMarkdownLabelFrame(
  stack: MarkdownLabelStack,
  startIndex: number,
  isImage: boolean,
): void {
  if (stack.depth >= markdownMaximumInlineLabelDepth) {
    throw new MarkdownComplexityError(startIndex, markdownMaximumInlineLabelDepth);
  }
  stack.startIndexes[stack.depth] = startIndex;
  stack.flags[stack.depth] = isImage ? MarkdownLabelFlag.Image : 0;
  stack.depth += 1;
}

function clearMarkdownLabelStack(stack: MarkdownLabelStack): void {
  stack.depth = 0;
}

function markMarkdownLabelStackWithActiveLink(stack: MarkdownLabelStack): void {
  for (let frameIndex = stack.depth - 1; frameIndex >= 0; frameIndex -= 1) {
    stack.flags[frameIndex] |= MarkdownLabelFlag.ContainsActiveLink;
    if ((stack.flags[frameIndex] & MarkdownLabelFlag.Image) !== 0) {
      return;
    }
  }
}

const markdownDestinationSink: MarkdownInlineItemSink<MarkdownLinkDestination> = {
  selectCodeRange: () => null,
  selectDestination: (markdown, destination) => ({
    ...destination,
    destination: markdown.slice(destination.startIndex, destination.endIndex),
  }),
};

const markdownCodeRangeSink: MarkdownInlineItemSink<MarkdownSourceRange> = {
  selectCodeRange: (startIndex, endIndex) => ({ startIndex, endIndex }),
  selectDestination: () => null,
};

function* scanMarkdownInlineItems<Item extends MarkdownInlineItem>(
  markdown: string,
  blockScan: MarkdownBlockScan,
  range: MarkdownProseRange,
  sink: MarkdownInlineItemSink<Item>,
  unmatchedCodeOpenerIndexes: ReadonlySet<number>,
  minimumYieldStartIndex: number,
): Generator<Item, ReadonlyArray<MarkdownCodeFrame>, void> {
  const state = createMarkdownInlineState(markdown, blockScan, range);
  const codeFrames: Array<MarkdownCodeFrame> = [];
  const codeFrameIndexByMarkerLength = new Map<number, number>();
  const labelStack = createMarkdownLabelStack();
  let precedingBackslashCount = 0;

  while (state.cursorIndex < range.endIndex) {
    if (state.cursorIndex >= state.lineEndIndex) {
      precedingBackslashCount = 0;
      if (advanceMarkdownInlineStatePastLoneCarriageReturn(state)) {
        clearMarkdownLabelStack(labelStack);
        continue;
      }
      if (advanceMarkdownInlineStateToNextLine(state)) {
        continue;
      }
      clearMarkdownLabelStack(labelStack);
      break;
    }

    const character = markdown[state.cursorIndex];
    if (character === "\\") {
      precedingBackslashCount += 1;
      advanceMarkdownInlineCursor(state, state.cursorIndex + 1);
      continue;
    }

    const isEscaped = precedingBackslashCount % 2 === 1;
    precedingBackslashCount = 0;
    if (character === "<" && !isEscaped && codeFrames.length === 0) {
      const opaqueSpanEndIndex = matchMarkdownOpaqueSpanEnd(state, state.cursorIndex);
      if (opaqueSpanEndIndex !== null) {
        advanceMarkdownInlineCursor(state, opaqueSpanEndIndex);
        continue;
      }
    }

    if (character === "`") {
      const markerLength = countRepeatedCharacter(markdown, state.cursorIndex, "`");
      const markerEndIndex = state.cursorIndex + markerLength;
      if (isEscaped) {
        advanceMarkdownInlineCursor(state, markerEndIndex);
        continue;
      }
      if (unmatchedCodeOpenerIndexes.has(state.cursorIndex)) {
        if (codeFrames.length === 0) {
          const codeItem = sink.selectCodeRange(state.cursorIndex, markerEndIndex);
          if (codeItem !== null && codeItem.startIndex >= minimumYieldStartIndex) {
            yield codeItem;
          }
        }
        advanceMarkdownInlineCursor(state, markerEndIndex);
        continue;
      }
      const closingFrameIndex = codeFrameIndexByMarkerLength.get(markerLength);
      if (closingFrameIndex === undefined) {
        codeFrames.push({
          openerStartIndex: state.cursorIndex,
          markerLength,
          parentLabelDepth: labelStack.depth,
        });
        codeFrameIndexByMarkerLength.set(markerLength, codeFrames.length - 1);
        advanceMarkdownInlineCursor(state, markerEndIndex);
        continue;
      }

      const closingFrame = codeFrames[closingFrameIndex];
      if (closingFrame === undefined) {
        throw new Error(`Markdown code frame is missing at index ${closingFrameIndex}.`);
      }
      for (let index = codeFrames.length - 1; index >= closingFrameIndex; index -= 1) {
        const discardedFrame = codeFrames[index];
        if (discardedFrame !== undefined) {
          codeFrameIndexByMarkerLength.delete(discardedFrame.markerLength);
        }
      }
      codeFrames.length = closingFrameIndex;
      labelStack.depth = closingFrame.parentLabelDepth;
      if (codeFrames.length === 0) {
        const codeItem = sink.selectCodeRange(
          closingFrame.openerStartIndex,
          markerEndIndex,
        );
        if (codeItem !== null && codeItem.startIndex >= minimumYieldStartIndex) {
          yield codeItem;
        }
      }
      advanceMarkdownInlineCursor(state, markerEndIndex);
      continue;
    }

    if (
      character === "]"
      && !isEscaped
      && codeFrames.length === 0
      && labelStack.depth > 0
    ) {
      const frameIndex = labelStack.depth - 1;
      const labelStartIndex = labelStack.startIndexes[frameIndex];
      const labelFlags = labelStack.flags[frameIndex];
      labelStack.depth = frameIndex;
      const isImage = (labelFlags & MarkdownLabelFlag.Image) !== 0;
      const containsActiveLink =
        (labelFlags & MarkdownLabelFlag.ContainsActiveLink) !== 0;
      if (!isImage && containsActiveLink) {
        advanceMarkdownInlineCursor(state, state.cursorIndex + 1);
        continue;
      }

      const attempt = parseMarkdownLinkDestinationAfterLabel(
        state,
        labelStartIndex,
        state.cursorIndex,
        isImage,
        state.rangeEndIndex,
        codeFrameIndexByMarkerLength,
      );
      if (attempt.kind === "destination") {
        if (attempt.activeCodeStop !== null) {
          advanceMarkdownInlineCursor(
            state,
            attempt.activeCodeStop.closingEndIndex - attempt.activeCodeStop.markerLength,
          );
          continue;
        }

        if (!isImage) {
          markMarkdownLabelStackWithActiveLink(labelStack);
        }
        if (codeFrames.length === 0) {
          const destinationItem = sink.selectDestination(markdown, attempt.destination);
          if (
            destinationItem !== null
            && destinationItem.startIndex >= minimumYieldStartIndex
          ) {
            yield destinationItem;
          }
        }
        advanceMarkdownInlineCursor(state, attempt.destination.linkEndIndex);
      } else {
        if (isImage && containsActiveLink) {
          markMarkdownLabelStackWithActiveLink(labelStack);
        }
        advanceMarkdownInlineCursor(state, attempt.resumeIndex);
      }
      continue;
    }

    const isLinkMarker = character === "[";
    const isImageMarker = character === "!" && markdown[state.cursorIndex + 1] === "[";
    if (
      !isEscaped
      && (isLinkMarker || isImageMarker)
    ) {
      if (codeFrames.length === 0) {
        pushMarkdownLabelFrame(
          labelStack,
          state.cursorIndex + (isImageMarker ? 1 : 0),
          isImageMarker,
        );
      }
      advanceMarkdownInlineCursor(
        state,
        state.cursorIndex + (isImageMarker ? 2 : 1),
      );
      continue;
    }

    advanceMarkdownInlineCursor(state, state.cursorIndex + 1);
  }

  return codeFrames;
}

function* iterateMarkdownInlineItems<Item extends MarkdownInlineItem>(
  markdown: string,
  blockScan: MarkdownBlockScan,
  range: MarkdownProseRange,
  sink: MarkdownInlineItemSink<Item>,
): IterableIterator<Item> {
  const unresolvedFrames = yield* scanMarkdownInlineItems(
    markdown,
    blockScan,
    range,
    sink,
    new Set<number>(),
    range.startIndex,
  );
  const firstUnresolvedFrame = unresolvedFrames[0];
  if (firstUnresolvedFrame === undefined) {
    return;
  }

  const unmatchedCodeOpenerIndexes = new Set(
    unresolvedFrames.map((frame) => frame.openerStartIndex),
  );
  const replayFrames = yield* scanMarkdownInlineItems(
    markdown,
    blockScan,
    range,
    sink,
    unmatchedCodeOpenerIndexes,
    firstUnresolvedFrame.openerStartIndex,
  );
  if (replayFrames.length !== 0) {
    const replayFrame = replayFrames[0];
    throw new Error(
      `Markdown code replay left an unresolved opener at index ${replayFrame?.openerStartIndex}.`,
    );
  }
}

function* iterateMarkdownActiveDestinations(
  markdown: string,
): IterableIterator<MarkdownLinkDestination> {
  const blockScan = scanMarkdownBlocks(markdown);
  for (const proseRange of blockScan.proseRanges) {
    for (const destination of iterateMarkdownInlineItems(
      markdown,
      blockScan,
      proseRange,
      markdownDestinationSink,
    )) {
      yield destination;
    }
  }
}

function collectMarkdownInlineCodeRanges(
  markdown: string,
  blockScan: MarkdownBlockScan,
): ReadonlyArray<MarkdownSourceRange> {
  const codeRanges: Array<MarkdownSourceRange> = [];
  for (const proseRange of blockScan.proseRanges) {
    for (const codeRange of iterateMarkdownInlineItems(
      markdown,
      blockScan,
      proseRange,
      markdownCodeRangeSink,
    )) {
      codeRanges.push(codeRange);
    }
  }
  return codeRanges;
}

function* iterateOrderedMarkdownCodeRanges(
  fencedCodeRanges: ReadonlyArray<MarkdownSourceRange>,
  inlineCodeRanges: ReadonlyArray<MarkdownSourceRange>,
): IterableIterator<MarkdownSourceRange> {
  let fencedCodeRangeIndex = 0;
  let inlineCodeRangeIndex = 0;
  while (
    fencedCodeRangeIndex < fencedCodeRanges.length
    || inlineCodeRangeIndex < inlineCodeRanges.length
  ) {
    const fencedCodeRange = fencedCodeRanges[fencedCodeRangeIndex];
    const inlineCodeRange = inlineCodeRanges[inlineCodeRangeIndex];
    if (
      inlineCodeRange === undefined
      || (
        fencedCodeRange !== undefined
        && fencedCodeRange.startIndex < inlineCodeRange.startIndex
      )
    ) {
      if (fencedCodeRange === undefined) {
        throw new Error(`Markdown fenced code range is missing at index ${fencedCodeRangeIndex}.`);
      }
      yield fencedCodeRange;
      fencedCodeRangeIndex += 1;
    } else {
      yield inlineCodeRange;
      inlineCodeRangeIndex += 1;
    }
  }
}

function extractMarkdownNonCodeTextSegmentsUnchecked(markdown: string): ReadonlyArray<string> {
  const blockScan = scanMarkdownBlocks(markdown);
  const inlineCodeRanges = collectMarkdownInlineCodeRanges(markdown, blockScan);
  const segments: Array<string> = [];
  let segmentStartIndex = 0;
  for (const codeRange of iterateOrderedMarkdownCodeRanges(
    blockScan.fencedCodeRanges,
    inlineCodeRanges,
  )) {
    if (codeRange.startIndex < segmentStartIndex) {
      throw new Error(`Markdown code ranges overlap at index ${codeRange.startIndex}.`);
    }
    const segment = markdown.slice(segmentStartIndex, codeRange.startIndex);
    if (segment.trim() !== "") {
      segments.push(segment);
    }
    segmentStartIndex = codeRange.endIndex;
  }

  const segment = markdown.slice(segmentStartIndex);
  if (segment.trim() !== "") {
    segments.push(segment);
  }

  return segments;
}

export function extractMarkdownNonCodeTextSegments(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownNonCodeTextSegmentsUnchecked(markdown));
}

function rewriteMarkdownUrlsUnchecked(
  markdown: string,
  buildRewrite: (url: string) => string | null,
): string {
  const rewrites: Array<MarkdownUrlRewrite> = [];

  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    const replacementUrl = buildRewrite(linkDestination.destination);
    if (replacementUrl === null) {
      continue;
    }

    rewrites.push({
      startIndex: linkDestination.startIndex,
      endIndex: linkDestination.endIndex,
      replacementUrl,
    });
  }

  if (rewrites.length === 0) {
    return markdown;
  }

  let rewrittenMarkdown = "";
  let cursorIndex = 0;
  for (const rewrite of rewrites) {
    rewrittenMarkdown += markdown.slice(cursorIndex, rewrite.startIndex);
    rewrittenMarkdown += rewrite.replacementUrl;
    cursorIndex = rewrite.endIndex;
  }

  return rewrittenMarkdown + markdown.slice(cursorIndex);
}

function rewriteMarkdownUrls(
  markdown: string,
  buildRewrite: (url: string) => string | null,
): string {
  return runMarkdownHelper(() => rewriteMarkdownUrlsUnchecked(markdown, buildRewrite));
}

function assertFcAssetId(value: string, fieldName: string): string {
  if (matchFcAssetId(`fcasset:${value}`) === null) {
    throw new Error(`${fieldName} must contain only portable fcasset id characters.`);
  }

  return value;
}

function validatePortableMediaPathSegment(segment: string, portableMediaPath: string): string {
  if (segment === "") {
    throw new Error(`Portable media path must not contain empty path segments: ${portableMediaPath}`);
  }

  let decodedSegment: string;
  try {
    decodedSegment = decodeURIComponent(segment);
  } catch {
    throw new Error(`Portable media path segment must use valid percent encoding: ${portableMediaPath}`);
  }

  if (decodedSegment === "." || decodedSegment === "..") {
    throw new Error(`Portable media path must not contain traversal segments: ${portableMediaPath}`);
  }

  if (!portableMediaPathSegmentPattern.test(segment)) {
    throw new Error(
      `Portable media path segments must contain only letters, numbers, dots, underscores, and hyphens: ${portableMediaPath}`,
    );
  }

  if (
    decodedSegment.includes("/")
    || decodedSegment.includes("\\")
    || decodedSegment.includes("\0")
  ) {
    throw new Error(`Portable media path segment decodes to an unsafe name: ${portableMediaPath}`);
  }

  return decodedSegment;
}

function getPortableMediaPathDuplicateKey(portableMediaPath: string): string {
  return portableMediaPath
    .split("/")
    .map((segment) => decodeURIComponent(segment).normalize("NFC").toLowerCase())
    .join("/");
}

function isPortableMediaPathCandidate(url: string): boolean {
  if (absoluteUrlPattern.test(url)) {
    return false;
  }

  return (
    url === "media"
    || url.startsWith("media/")
    || url === "/media"
    || url.startsWith("/media/")
    || url.startsWith("/media\\")
    || url.startsWith("media\\")
    || localMediaPathWithLeadingDotSegmentsPattern.test(url)
  );
}

export function validatePortableMediaPath(portableMediaPath: string): string {
  if (portableMediaPath === "") {
    throw new Error("Portable media path must not be empty.");
  }

  if (portableMediaPath.includes("\\")) {
    throw new Error(`Portable media path must use forward slashes: ${portableMediaPath}`);
  }

  if (portableMediaPath.includes("?") || portableMediaPath.includes("#")) {
    throw new Error(`Portable media path must not include query strings or fragments: ${portableMediaPath}`);
  }

  if (portableMediaPath.startsWith("/") || absoluteUrlPattern.test(portableMediaPath)) {
    throw new Error(`Portable media path must be relative: ${portableMediaPath}`);
  }

  if (!portableMediaPath.startsWith("media/")) {
    throw new Error(`Portable media path must be under media/: ${portableMediaPath}`);
  }

  const pathSegments = portableMediaPath.split("/");
  for (const segment of pathSegments) {
    validatePortableMediaPathSegment(segment, portableMediaPath);
  }

  if (pathSegments.length < 2) {
    throw new Error(`Portable media path must include a file name under media/: ${portableMediaPath}`);
  }

  return portableMediaPath;
}

export function validateUniquePortableMediaPaths(
  portableMediaPaths: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const seenDuplicateKeys = new Set<string>();
  const validatedPaths: Array<string> = [];

  for (const portableMediaPath of portableMediaPaths) {
    const validatedPath = validatePortableMediaPath(portableMediaPath);
    const duplicateKey = getPortableMediaPathDuplicateKey(validatedPath);
    if (seenDuplicateKeys.has(duplicateKey)) {
      throw new Error(`Portable media path is duplicated: ${portableMediaPath}`);
    }

    seenDuplicateKeys.add(duplicateKey);
    validatedPaths.push(validatedPath);
  }

  return validatedPaths;
}

function extractMarkdownFcAssetIdsUnchecked(markdown: string): ReadonlyArray<string> {
  const assetIds: Array<string> = [];
  const seenAssetIds = new Set<string>();

  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    const assetId = matchFcAssetId(linkDestination.destination);
    if (assetId === null || seenAssetIds.has(assetId)) {
      continue;
    }

    seenAssetIds.add(assetId);
    assetIds.push(assetId);
  }

  return assetIds;
}

export function extractMarkdownFcAssetIds(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownFcAssetIdsUnchecked(markdown));
}

function extractMarkdownImageFcAssetIdsUnchecked(markdown: string): ReadonlyArray<string> {
  const assetIds: Array<string> = [];
  const seenAssetIds = new Set<string>();

  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination || !destination.isImage) {
      continue;
    }
    const assetId = matchFcAssetId(destination.destination);
    if (assetId === null || seenAssetIds.has(assetId)) {
      continue;
    }

    seenAssetIds.add(assetId);
    assetIds.push(assetId);
  }

  return assetIds;
}

export function extractMarkdownImageFcAssetIds(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownImageFcAssetIdsUnchecked(markdown));
}

function extractMarkdownImageDestinationUrlsUnchecked(markdown: string): ReadonlyArray<string> {
  const destinations: Array<string> = [];
  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination || !destination.isImage) {
      continue;
    }
    destinations.push(destination.destination);
  }
  return destinations;
}

export function extractMarkdownImageDestinationUrls(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownImageDestinationUrlsUnchecked(markdown));
}

function extractMarkdownManagedMediaLifecycleReferencesUnchecked(
  markdown: string,
): ReadonlyArray<ManagedMediaLifecycleReference> {
  const references: Array<ManagedMediaLifecycleReference> = [];
  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination) {
      continue;
    }
    const reference = parseManagedMediaLifecycleReference(destination.destination);
    if (reference === null) {
      continue;
    }
    references.push({
      ...reference,
      isImage: destination.isImage,
    });
  }
  return references;
}

export function extractMarkdownManagedMediaLifecycleReferences(
  markdown: string,
): ReadonlyArray<ManagedMediaLifecycleReference> {
  return runMarkdownHelper(() => (
    extractMarkdownManagedMediaLifecycleReferencesUnchecked(markdown)
  ));
}

function extractMarkdownManagedMediaLifecycleIssuesUnchecked(
  markdown: string,
): ManagedMediaLifecycleIssues {
  const pendingDestinations: Array<string> = [];
  const failedDestinations: Array<string> = [];
  const unsupportedDestinations: Array<string> = [];
  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination) {
      continue;
    }
    const reference = parseManagedMediaLifecycleReference(destination.destination);
    if (reference?.state === "pending") {
      pendingDestinations.push(reference.destination);
      continue;
    }
    if (reference?.state === "failed") {
      failedDestinations.push(reference.destination);
      continue;
    }
    if (
      reference === null
      && destination.destination.slice(0, managedMediaSchemePrefix.length).toLowerCase()
        === managedMediaSchemePrefix
    ) {
      unsupportedDestinations.push(destination.destination);
    }
  }
  return {
    pendingDestinations,
    failedDestinations,
    unsupportedDestinations,
  };
}

export function extractMarkdownManagedMediaLifecycleIssues(
  markdown: string,
): ManagedMediaLifecycleIssues {
  return runMarkdownHelper(() => (
    extractMarkdownManagedMediaLifecycleIssuesUnchecked(markdown)
  ));
}

function extractMarkdownLinkDestinationUrlsUnchecked(markdown: string): ReadonlyArray<string> {
  const destinations: Array<string> = [];
  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    destinations.push(linkDestination.destination);
  }

  return destinations;
}

export function extractMarkdownLinkDestinationUrls(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownLinkDestinationUrlsUnchecked(markdown));
}

export function rewriteMarkdownImageDestinationUrl(
  markdown: string,
  currentUrl: string,
  replacementUrl: string,
): string {
  return runMarkdownHelper(() => {
    const rewrites: Array<MarkdownUrlRewrite> = [];
    for (const destination of iterateMarkdownActiveDestinations(markdown)) {
      if (
        !destination.hasDestination
        || !destination.isImage
        || destination.destination !== currentUrl
      ) {
        continue;
      }
      rewrites.push({
        startIndex: destination.startIndex,
        endIndex: destination.endIndex,
        replacementUrl,
      });
    }

    let rewrittenMarkdown = "";
    let cursorIndex = 0;
    for (const rewrite of rewrites) {
      rewrittenMarkdown += markdown.slice(cursorIndex, rewrite.startIndex);
      rewrittenMarkdown += rewrite.replacementUrl;
      cursorIndex = rewrite.endIndex;
    }
    return rewrites.length === 0
      ? markdown
      : rewrittenMarkdown + markdown.slice(cursorIndex);
  });
}

function extractMarkdownPortableMediaPathsUnchecked(markdown: string): ReadonlyArray<string> {
  const portableMediaPaths: Array<string> = [];
  const seenPortableMediaPaths = new Set<string>();

  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    if (!isPortableMediaPathCandidate(linkDestination.destination)) {
      continue;
    }

    const portableMediaPath = validatePortableMediaPath(linkDestination.destination);
    if (seenPortableMediaPaths.has(portableMediaPath)) {
      continue;
    }

    seenPortableMediaPaths.add(portableMediaPath);
    portableMediaPaths.push(portableMediaPath);
  }

  return portableMediaPaths;
}

export function extractMarkdownPortableMediaPaths(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownPortableMediaPathsUnchecked(markdown));
}

export function rewriteMarkdownFcAssetUrlsToPortablePaths(
  markdown: string,
  resolvePortablePath: FcAssetPortablePathResolver,
): string {
  const portablePathByAssetId = new Map<string, string>();
  const assetIdByDuplicateKey = new Map<string, string>();

  return rewriteMarkdownUrls(markdown, (url) => {
    const assetId = matchFcAssetId(url);
    if (assetId === null) {
      return null;
    }

    const portablePath = validatePortableMediaPath(resolvePortablePath(assetId));
    const previousPortablePath = portablePathByAssetId.get(assetId);
    if (previousPortablePath !== undefined && previousPortablePath !== portablePath) {
      throw new Error(`fcasset id resolved to multiple portable media paths: ${assetId}`);
    }

    portablePathByAssetId.set(assetId, portablePath);
    const duplicateKey = getPortableMediaPathDuplicateKey(portablePath);
    const existingAssetId = assetIdByDuplicateKey.get(duplicateKey);
    if (existingAssetId !== undefined && existingAssetId !== assetId) {
      throw new Error(`Portable media path is shared by multiple fcasset ids: ${portablePath}`);
    }

    assetIdByDuplicateKey.set(duplicateKey, assetId);
    return portablePath;
  });
}

export function rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(
  markdown: string,
  portablePathsByAssetId: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownFcAssetUrlsToPortablePaths(markdown, (assetId) => {
    const portablePath = portablePathsByAssetId.get(assetId);
    if (portablePath === undefined) {
      throw new Error(`Missing portable media path for fcasset id: ${assetId}`);
    }

    return portablePath;
  });
}

export function rewriteMarkdownFcAssetUrlsToSharedPortablePathsFromMap(
  markdown: string,
  portablePathsByAssetId: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownFcAssetUrlsToSharedPortablePaths(markdown, (assetId) => {
    const portablePath = portablePathsByAssetId.get(assetId);
    if (portablePath === undefined) {
      throw new Error(`Missing portable media path for fcasset id: ${assetId}`);
    }

    return portablePath;
  });
}

export function rewriteMarkdownFcAssetUrlsToSharedPortablePaths(
  markdown: string,
  resolvePortablePath: FcAssetPortablePathResolver,
): string {
  return rewriteMarkdownUrls(markdown, (url) => {
    const assetId = matchFcAssetId(url);
    if (assetId === null) {
      return null;
    }

    return validatePortableMediaPath(resolvePortablePath(assetId));
  });
}

export function rewriteMarkdownFcAssetUrlsToFcAssets(
  markdown: string,
  resolveAssetId: FcAssetIdResolver,
): string {
  return rewriteMarkdownUrls(markdown, (url) => {
    const assetId = matchFcAssetId(url);
    if (assetId === null) {
      return null;
    }

    return `fcasset:${assertFcAssetId(resolveAssetId(assetId), "Resolved fcasset id")}`;
  });
}

export function rewriteMarkdownPortableMediaUrlsToFcAssets(
  markdown: string,
  resolveAssetId: PortableMediaAssetIdResolver,
): string {
  return rewriteMarkdownUrls(markdown, (url) => {
    if (!isPortableMediaPathCandidate(url)) {
      return null;
    }

    const portableMediaPath = validatePortableMediaPath(url);
    const assetId = assertFcAssetId(resolveAssetId(portableMediaPath), "Resolved fcasset id");
    return `fcasset:${assetId}`;
  });
}

export function rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(
  markdown: string,
  assetIdsByPortablePath: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownPortableMediaUrlsToFcAssets(markdown, (portableMediaPath) => {
    const assetId = assetIdsByPortablePath.get(portableMediaPath);
    if (assetId === undefined) {
      throw new Error(`Missing fcasset id for portable media path: ${portableMediaPath}`);
    }

    return assetId;
  });
}
