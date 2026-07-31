export type MarkdownSourceRange = Readonly<{ startIndex: number; endIndex: number }>;
export type MarkdownProseRange = MarkdownSourceRange & Readonly<{ startLineIndex: number }>;

type MarkdownFence = Readonly<{ marker: "`" | "~"; length: number }>;

export type MarkdownListContainer = Readonly<{
  kind: "list"; continuationIndentColumns: number; orderedStart: number | null;
  contentStarted: boolean; leadingBlankConsumed: boolean;
}>;
export type MarkdownContainer = Readonly<{ kind: "blockquote" }> | MarkdownListContainer;

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
export type MarkdownBlockScan = Readonly<{
  lines: Readonly<{ chunks: ReadonlyArray<Int32Array>; lineCount: number; fieldCount: number }>;
  containerStacks: ReadonlyArray<ReadonlyArray<MarkdownContainer>>;
  proseRanges: ReadonlyArray<MarkdownProseRange>;
  fencedCodeRanges: ReadonlyArray<MarkdownSourceRange>;
}>;

export const enum MarkdownLineField {
  StartIndex = 0, EndIndex = 1, NextStartIndex = 2, ContentStartIndex = 3,
  ContainerStackId = 4, ParagraphId = 5, BlockKind = 6, Count = 7,
}

export const enum MarkdownBlockKind {
  Prose = 0, FencedCode = 1, Html = 2,
}

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
export const markdownLineChunkCapacity = 8_192;

export function countRepeatedCharacter(markdown: string, index: number, marker: "`" | "~"): number {
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

export function scanMarkdownBlocks(markdown: string): MarkdownBlockScan {
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
