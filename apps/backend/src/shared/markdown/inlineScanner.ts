import {
  countRepeatedCharacter,
  MarkdownBlockKind,
  MarkdownLineField,
  scanMarkdownBlocks,
  type MarkdownBlockScan,
  type MarkdownProseRange,
  type MarkdownSourceRange,
} from "./blockScanner";
import { MarkdownComplexityError } from "./complexity";
import {
  getMarkdownInlineLineEndIndex,
  getMarkdownLineField,
  getMarkdownNextLogicalLine,
  matchMarkdownOpaqueSpanEnd,
  MarkdownOpaqueDelimiter,
  parseMarkdownLinkDestinationAfterLabel,
  type MarkdownInlineState,
  type MarkdownLinkDestinationRange,
} from "./lexer";

export type MarkdownLinkDestination = Readonly<{
  labelStartIndex: number;
  labelEndIndex: number;
  startIndex: number;
  endIndex: number;
  linkEndIndex: number;
  destination: string;
  hasDestination: boolean;
  isImage: boolean;
}>;

type MarkdownInlineItem = MarkdownSourceRange | MarkdownLinkDestination;

type MarkdownInlineItemSink<Item extends MarkdownInlineItem> = Readonly<{
  selectCodeRange: (startIndex: number, endIndex: number) => Item | null;
  selectDestination: (
    markdown: string,
    destination: MarkdownLinkDestinationRange,
  ) => Item | null;
}>;

type MarkdownLabelStack = {
  startIndexes: Int32Array;
  flags: Uint8Array;
  depth: number;
};

type MarkdownCodeFrame = Readonly<{
  openerStartIndex: number;
  markerLength: number;
  parentLabelDepth: number;
}>;

const enum MarkdownLabelFlag {
  Image = 1,
  ContainsActiveLink = 2,
}

const markdownMaximumInlineLabelDepth = 1_000;

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

export function* iterateMarkdownActiveDestinations(
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

export function extractMarkdownNonCodeTextSegmentsUnchecked(markdown: string): ReadonlyArray<string> {
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
