import {
  countRepeatedCharacter,
  MarkdownBlockKind,
  MarkdownLineField,
  markdownLineChunkCapacity,
  type MarkdownBlockScan,
} from "./blockScanner";

export type MarkdownInlineScan = readonly [startIndex: number, endIndex: number];
export type MarkdownInlineScanKind = "whitespace" | "bare" | "angled" | "\"" | "'" | "(";

export type MarkdownInlineState = {
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

export type MarkdownCodeStop = Readonly<{ markerLength: number; closingEndIndex: number }>;

export type MarkdownLinkDestinationRange = Readonly<{
  labelStartIndex: number;
  labelEndIndex: number;
  startIndex: number;
  endIndex: number;
  linkEndIndex: number;
  hasDestination: boolean;
  isImage: boolean;
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

export type MarkdownLinkAttempt =
  | Readonly<{
    kind: "destination";
    destination: MarkdownLinkDestinationRange;
    activeCodeStop: MarkdownCodeStop | null;
  }>
  | Readonly<{ kind: "failed"; resumeIndex: number }>;

export const enum MarkdownOpaqueDelimiter {
  Comment = 0,
  ProcessingInstruction = 1,
  Declaration = 2,
  Cdata = 3,
  SingleQuote = 4,
  DoubleQuote = 5,
  Count = 6,
}

const markdownMaximumLinkDestinationParenthesisDepth = 32;

export function getMarkdownLineField(
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

export type MarkdownNextLogicalLine = Readonly<{
  lineIndex: number;
  contentStartIndex: number;
  lineEndIndex: number;
}>;

export function getMarkdownInlineLineEndIndex(
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

export function getMarkdownNextLogicalLine(
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

export function matchMarkdownOpaqueSpanEnd(
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

export function parseMarkdownLinkDestinationAfterLabel(
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
