type MarkdownUrlRewrite = Readonly<{
  startIndex: number;
  endIndex: number;
  replacementUrl: string;
}>;

type MarkdownLinkDestination = Readonly<{
  startIndex: number;
  endIndex: number;
  linkEndIndex: number;
  destination: string;
}>;

type MarkdownSourceRange = Readonly<{ startIndex: number; endIndex: number }>;

type MarkdownInlineItem = MarkdownSourceRange | MarkdownLinkDestination;

type MarkdownInlineItemSink<Item extends MarkdownInlineItem> = Readonly<{
  selectCodeRange: (startIndex: number, endIndex: number) => Item | null;
  selectDestination: (
    markdown: string,
    destination: MarkdownLinkDestinationRange,
  ) => Item | null;
}>;

type MarkdownInlineScan = readonly [startIndex: number, endIndex: number];
type MarkdownInlineScanKind = "whitespace" | "bare" | "angled" | "\"" | "'";

type MarkdownInlineState = {
  markdown: string;
  cursorIndex: number;
  lineEndIndex: number;
  rangeEndIndex: number;
  scans: Partial<Record<MarkdownInlineScanKind, MarkdownInlineScan>>;
};

type MarkdownCodeStop = Readonly<{ markerLength: number; closingEndIndex: number }>;

type MarkdownLinkDestinationRange = Readonly<{
  startIndex: number;
  endIndex: number;
  linkEndIndex: number;
}>;

type MarkdownCodeFrame = Readonly<{
  openerStartIndex: number;
  markerLength: number;
  parentLabelLineEndIndex: number | null;
}>;

type MarkdownLinkInspection = {
  cursorIndex: number;
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

type MarkdownFence = Readonly<{
  marker: "`" | "~";
  length: number;
  lineEndIndex: number;
}>;

export type FcAssetPortablePathResolver = (assetId: string) => string;
export type FcAssetIdResolver = (assetId: string) => string;
export type PortableMediaAssetIdResolver = (portableMediaPath: string) => string;

const fcAssetUrlPattern = /^fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const absoluteUrlPattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const localMediaPathWithLeadingDotSegmentsPattern = /^(?:\.\.?[\\/])+media(?:[\\/]|$)/;
const portableMediaPathSegmentPattern = /^[A-Za-z0-9._-]+$/;

function matchFcAssetId(url: string): string | null {
  const match = fcAssetUrlPattern.exec(url);
  if (match === null) {
    return null;
  }

  return match[1] ?? null;
}

function isLineStart(markdown: string, index: number): boolean {
  return index === 0 || markdown[index - 1] === "\n";
}

function getLineEndIndex(markdown: string, index: number): number {
  const newlineIndex = markdown.indexOf("\n", index);
  return newlineIndex === -1 ? markdown.length : newlineIndex;
}

function getNextLineStartIndex(markdown: string, lineEndIndex: number): number {
  return lineEndIndex >= markdown.length ? markdown.length : lineEndIndex + 1;
}

function countRepeatedCharacter(markdown: string, index: number, marker: "`" | "~"): number {
  let cursorIndex = index;
  while (markdown[cursorIndex] === marker) {
    cursorIndex += 1;
  }

  return cursorIndex - index;
}

function parseFenceAtLineStart(markdown: string, index: number): MarkdownFence | null {
  if (!isLineStart(markdown, index)) {
    return null;
  }

  let cursorIndex = index;
  let leadingSpaces = 0;
  while (markdown[cursorIndex] === " " && leadingSpaces < 4) {
    cursorIndex += 1;
    leadingSpaces += 1;
  }

  if (leadingSpaces > 3) {
    return null;
  }

  const marker = markdown[cursorIndex];
  if (marker !== "`" && marker !== "~") {
    return null;
  }

  const markerLength = countRepeatedCharacter(markdown, cursorIndex, marker);
  if (markerLength < 3) {
    return null;
  }

  return {
    marker,
    length: markerLength,
    lineEndIndex: getLineEndIndex(markdown, index),
  };
}

function findFencedCodeBlockEndIndex(markdown: string, openingFence: MarkdownFence): number {
  let cursorIndex = getNextLineStartIndex(markdown, openingFence.lineEndIndex);

  while (cursorIndex < markdown.length) {
    const closingFence = parseFenceAtLineStart(markdown, cursorIndex);
    if (
      closingFence !== null
      && closingFence.marker === openingFence.marker
      && closingFence.length >= openingFence.length
    ) {
      return getNextLineStartIndex(markdown, closingFence.lineEndIndex);
    }

    cursorIndex = getNextLineStartIndex(markdown, getLineEndIndex(markdown, cursorIndex));
  }

  return markdown.length;
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
    && (character === "\\" || character === "`" || character === "[" || character === "!")
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
): void {
  const cachedEndIndex = getCachedScanEndIndex(state, "whitespace", inspection.cursorIndex);
  if (cachedEndIndex !== null) {
    inspection.cursorIndex = cachedEndIndex;
    inspection.precedingBackslashCount = 0;
    return;
  }

  const startIndex = inspection.cursorIndex;
  while (
    inspection.cursorIndex < endIndex
    && (
      state.markdown[inspection.cursorIndex] === " "
      || state.markdown[inspection.cursorIndex] === "\t"
    )
  ) {
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  }
  state.scans.whitespace = [startIndex, inspection.cursorIndex];
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

function parseMarkdownLinkDestinationAfterLabel(
  state: MarkdownInlineState,
  labelCloseIndex: number,
  endIndex: number,
  codeFrameIndexByMarkerLength: ReadonlyMap<number, number>,
): MarkdownLinkAttempt {
  const markdown = state.markdown;
  if (markdown[labelCloseIndex + 1] !== "(") {
    return { kind: "failed", resumeIndex: labelCloseIndex + 1 };
  }

  const inspection: MarkdownLinkInspection = {
    cursorIndex: labelCloseIndex + 1,
    precedingBackslashCount: 0,
    reentryIndex: null,
    activeCodeStop: null,
    skippedSource: false,
  };
  consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  skipMarkdownLinkWhitespace(state, inspection, endIndex, codeFrameIndexByMarkerLength);

  let destinationStartIndex = inspection.cursorIndex;
  let destinationEndIndex: number;
  if (markdown[inspection.cursorIndex] === "<") {
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    destinationStartIndex = inspection.cursorIndex;
    const cachedEndIndex = getCachedScanEndIndex(state, "angled", destinationStartIndex);
    if (cachedEndIndex === null) {
      while (
        inspection.cursorIndex < endIndex
        && markdown[inspection.cursorIndex] !== ">"
      ) {
        consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
      }
      state.scans.angled = [destinationStartIndex, inspection.cursorIndex];
    } else {
      advanceMarkdownLinkInspectionToCachedEnd(
        state,
        inspection,
        cachedEndIndex,
        endIndex,
        codeFrameIndexByMarkerLength,
      );
    }
    if (inspection.cursorIndex >= endIndex || markdown[inspection.cursorIndex] !== ">") {
      return createFailedMarkdownLinkAttempt(inspection);
    }
    destinationEndIndex = inspection.cursorIndex;
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  } else {
    const cachedEndIndex = getCachedScanEndIndex(state, "bare", destinationStartIndex);
    if (cachedEndIndex === null) {
      while (inspection.cursorIndex < endIndex) {
        const character = markdown[inspection.cursorIndex];
        if (
          character === ")"
          || character === " "
          || character === "\t"
          || character === "\n"
        ) {
          break;
        }
        consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
      }
      state.scans.bare = [destinationStartIndex, inspection.cursorIndex];
    } else {
      advanceMarkdownLinkInspectionToCachedEnd(
        state,
        inspection,
        cachedEndIndex,
        endIndex,
        codeFrameIndexByMarkerLength,
      );
    }
    destinationEndIndex = inspection.cursorIndex;
    if (destinationEndIndex >= endIndex) {
      return createFailedMarkdownLinkAttempt(inspection);
    }
  }

  if (destinationStartIndex === destinationEndIndex) {
    if (inspection.cursorIndex < endIndex) {
      consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    }
    return createFailedMarkdownLinkAttempt(inspection);
  }

  skipMarkdownLinkWhitespace(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  const titleQuote = markdown[inspection.cursorIndex];
  if (titleQuote === "\"" || titleQuote === "'") {
    consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    const titleStartIndex = inspection.cursorIndex;
    const cachedEndIndex = getCachedScanEndIndex(state, titleQuote, titleStartIndex);
    if (cachedEndIndex === null) {
      let closingQuoteIndex: number | null = null;
      while (inspection.cursorIndex < endIndex) {
        const tokenStartIndex = inspection.cursorIndex;
        const token = consumeMarkdownLinkToken(
          state,
          inspection,
          endIndex,
          codeFrameIndexByMarkerLength,
        );
        if (token.character === titleQuote && !token.isEscaped) {
          closingQuoteIndex = tokenStartIndex;
          break;
        }
      }
      state.scans[titleQuote] = [
        titleStartIndex,
        closingQuoteIndex ?? inspection.cursorIndex,
      ];
      if (closingQuoteIndex === null) {
        return createFailedMarkdownLinkAttempt(inspection);
      }
    } else {
      advanceMarkdownLinkInspectionToCachedEnd(
        state,
        inspection,
        cachedEndIndex,
        endIndex,
        codeFrameIndexByMarkerLength,
      );
      if (inspection.cursorIndex >= endIndex || markdown[inspection.cursorIndex] !== titleQuote) {
        return createFailedMarkdownLinkAttempt(inspection);
      }
      consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    }
    skipMarkdownLinkWhitespace(state, inspection, endIndex, codeFrameIndexByMarkerLength);
  }

  if (inspection.cursorIndex >= endIndex || markdown[inspection.cursorIndex] !== ")") {
    if (inspection.cursorIndex < endIndex) {
      consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);
    }
    return createFailedMarkdownLinkAttempt(inspection);
  }
  consumeMarkdownLinkToken(state, inspection, endIndex, codeFrameIndexByMarkerLength);

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
      startIndex: destinationStartIndex,
      endIndex: destinationEndIndex,
      linkEndIndex: inspection.cursorIndex,
    },
    activeCodeStop,
  };
}

function* iterateTopLevelMarkdownProseRanges(
  markdown: string,
): IterableIterator<MarkdownSourceRange> {
  let lineStartIndex = 0;
  let proseStartIndex = 0;

  while (lineStartIndex < markdown.length) {
    const openingFence = parseFenceAtLineStart(markdown, lineStartIndex);
    if (openingFence !== null) {
      if (proseStartIndex < lineStartIndex) {
        yield {
          startIndex: proseStartIndex,
          endIndex: lineStartIndex,
        };
      }

      lineStartIndex = findFencedCodeBlockEndIndex(markdown, openingFence);
      proseStartIndex = lineStartIndex;
      continue;
    }

    lineStartIndex = getNextLineStartIndex(
      markdown,
      getLineEndIndex(markdown, lineStartIndex),
    );
  }

  if (proseStartIndex < markdown.length) {
    yield {
      startIndex: proseStartIndex,
      endIndex: markdown.length,
    };
  }
}

function createMarkdownInlineState(
  markdown: string,
  range: MarkdownSourceRange,
): MarkdownInlineState {
  return {
    markdown,
    cursorIndex: range.startIndex,
    lineEndIndex: Math.min(getLineEndIndex(markdown, range.startIndex), range.endIndex),
    rangeEndIndex: range.endIndex,
    scans: {},
  };
}

function advanceMarkdownInlineCursor(
  state: MarkdownInlineState,
  nextIndex: number,
): void {
  state.cursorIndex = nextIndex;
  if (state.cursorIndex > state.lineEndIndex) {
    state.lineEndIndex = Math.min(
      getLineEndIndex(state.markdown, state.cursorIndex),
      state.rangeEndIndex,
    );
    state.scans = {};
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
  range: MarkdownSourceRange,
  sink: MarkdownInlineItemSink<Item>,
  initialLabelLineEndIndex: number | null,
  unmatchedCodeOpenerIndexes: ReadonlySet<number>,
): Generator<Item, ReadonlyArray<MarkdownCodeFrame>, void> {
  const state = createMarkdownInlineState(markdown, range);
  const codeFrames: Array<MarkdownCodeFrame> = [];
  const codeFrameIndexByMarkerLength = new Map<number, number>();
  let labelLineEndIndex = initialLabelLineEndIndex;
  let precedingBackslashCount = 0;

  while (state.cursorIndex < range.endIndex) {
    const character = markdown[state.cursorIndex];
    if (character === "\\") {
      precedingBackslashCount += 1;
      advanceMarkdownInlineCursor(state, state.cursorIndex + 1);
      continue;
    }

    const isEscaped = precedingBackslashCount % 2 === 1;
    precedingBackslashCount = 0;
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
          if (codeItem !== null) {
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
          parentLabelLineEndIndex: labelLineEndIndex,
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
      labelLineEndIndex = closingFrame.parentLabelLineEndIndex;
      if (
        labelLineEndIndex !== null
        && markerEndIndex > labelLineEndIndex
      ) {
        labelLineEndIndex = null;
      }
      if (codeFrames.length === 0) {
        const codeItem = sink.selectCodeRange(
          closingFrame.openerStartIndex,
          markerEndIndex,
        );
        if (codeItem !== null) {
          yield codeItem;
        }
      }
      advanceMarkdownInlineCursor(state, markerEndIndex);
      continue;
    }

    if (
      labelLineEndIndex !== null
      && state.cursorIndex >= labelLineEndIndex
    ) {
      labelLineEndIndex = null;
    }

    if (labelLineEndIndex !== null && character === "]" && !isEscaped) {
      const attempt = parseMarkdownLinkDestinationAfterLabel(
        state,
        state.cursorIndex,
        labelLineEndIndex,
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

        if (codeFrames.length === 0) {
          const destinationItem = sink.selectDestination(markdown, attempt.destination);
          if (destinationItem !== null) {
            yield destinationItem;
          }
        }
        advanceMarkdownInlineCursor(state, attempt.destination.linkEndIndex);
      } else {
        advanceMarkdownInlineCursor(state, attempt.resumeIndex);
      }
      labelLineEndIndex = null;
      continue;
    }

    const isLinkMarker = character === "[";
    const isImageMarker = character === "!" && markdown[state.cursorIndex + 1] === "[";
    if (
      labelLineEndIndex === null
      && !isEscaped
      && (isLinkMarker || isImageMarker)
    ) {
      labelLineEndIndex = state.lineEndIndex;
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
  range: MarkdownSourceRange,
  sink: MarkdownInlineItemSink<Item>,
): IterableIterator<Item> {
  const unresolvedFrames = yield* scanMarkdownInlineItems(
    markdown,
    range,
    sink,
    null,
    new Set<number>(),
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
    {
      startIndex: firstUnresolvedFrame.openerStartIndex,
      endIndex: range.endIndex,
    },
    sink,
    firstUnresolvedFrame.parentLabelLineEndIndex,
    unmatchedCodeOpenerIndexes,
  );
  if (replayFrames.length !== 0) {
    const replayFrame = replayFrames[0];
    throw new Error(
      `Markdown code replay left an unresolved opener at index ${replayFrame?.openerStartIndex}.`,
    );
  }
}

function* iterateMarkdownLinkDestinations(
  markdown: string,
): IterableIterator<MarkdownLinkDestination> {
  for (const proseRange of iterateTopLevelMarkdownProseRanges(markdown)) {
    for (const destination of iterateMarkdownInlineItems(
      markdown,
      proseRange,
      markdownDestinationSink,
    )) {
      yield destination;
    }
  }
}

export function extractMarkdownNonCodeTextSegments(markdown: string): ReadonlyArray<string> {
  const segments: Array<string> = [];

  for (const proseRange of iterateTopLevelMarkdownProseRanges(markdown)) {
    let segmentStartIndex = proseRange.startIndex;
    for (const codeRange of iterateMarkdownInlineItems(
      markdown,
      proseRange,
      markdownCodeRangeSink,
    )) {
      const segment = markdown.slice(segmentStartIndex, codeRange.startIndex);
      if (segment.trim() !== "") {
        segments.push(segment);
      }
      segmentStartIndex = codeRange.endIndex;
    }

    const segment = markdown.slice(segmentStartIndex, proseRange.endIndex);
    if (segment.trim() !== "") {
      segments.push(segment);
    }
  }

  return segments;
}

function rewriteMarkdownUrls(
  markdown: string,
  buildRewrite: (url: string) => string | null,
): string {
  const rewrites: Array<MarkdownUrlRewrite> = [];

  for (const linkDestination of iterateMarkdownLinkDestinations(markdown)) {
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

export function extractMarkdownFcAssetIds(markdown: string): ReadonlyArray<string> {
  const assetIds: Array<string> = [];
  const seenAssetIds = new Set<string>();

  for (const linkDestination of iterateMarkdownLinkDestinations(markdown)) {
    const assetId = matchFcAssetId(linkDestination.destination);
    if (assetId === null || seenAssetIds.has(assetId)) {
      continue;
    }

    seenAssetIds.add(assetId);
    assetIds.push(assetId);
  }

  return assetIds;
}

export function extractMarkdownLinkDestinationUrls(markdown: string): ReadonlyArray<string> {
  const destinations: Array<string> = [];
  for (const linkDestination of iterateMarkdownLinkDestinations(markdown)) {
    destinations.push(linkDestination.destination);
  }

  return destinations;
}

export function extractMarkdownPortableMediaPaths(markdown: string): ReadonlyArray<string> {
  const portableMediaPaths: Array<string> = [];
  const seenPortableMediaPaths = new Set<string>();

  for (const linkDestination of iterateMarkdownLinkDestinations(markdown)) {
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
