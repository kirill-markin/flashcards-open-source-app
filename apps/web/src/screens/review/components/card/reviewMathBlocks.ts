import type { Nodes, Parents, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import type { Plugin } from "unified";
import { unified } from "unified";
import { EXIT, SKIP, visit } from "unist-util-visit";

const REVIEW_MATH_DIGIT_PATTERN = /^[0-9]$/;
const REVIEW_MATH_OPENING_RUN_INDENT_PATTERN = /^ {0,3}$/;
const REVIEW_MATH_SPACE_ONLY_PATTERN = /^[ \t]*$/;

type ReviewMathMode = "display" | "inline";

type ReviewNodeSource = Readonly<{
  delimitedSource: string;
  endIndex: number;
  startIndex: number;
}>;

type ReviewMathSource = ReviewNodeSource & Readonly<{
  formulaSource: string;
  mathMode: ReviewMathMode;
}>;

/** One source line of the card side, without its line ending. */
type ReviewMarkdownLine = Readonly<{
  endIndex: number;
  startIndex: number;
  value: string;
}>;

/** A maximal run of unescaped dollar signs on one source line. */
type ReviewDollarRun = Readonly<{
  length: number;
  startColumn: number;
}>;

/** A half-open source range the math scan must not read. */
type ReviewSourceRange = Readonly<{
  endIndex: number;
  startIndex: number;
}>;

/** A formula the normative source rules recognize directly in the Markdown source. */
type ReviewMathConstruct = Readonly<{
  endIndex: number;
  formulaSource: string;
  startIndex: number;
}>;

/**
 * The formulas the source rules accept inside one top-level paragraph, plus the
 * inline code spans that scan stepped over.
 */
type ReviewParagraphMathScan = Readonly<{
  codeSpanRanges: ReadonlyArray<ReviewSourceRange>;
  constructs: ReadonlyArray<ReviewMathConstruct>;
  firstLineIndex: number;
  lastLineIndex: number;
  mathMode: ReviewMathMode;
}>;

export type ReviewMathSpeechSegment =
  | Readonly<{
    kind: "formula";
    value: string;
  }>
  | Readonly<{
    kind: "prose";
    startsAtLineBoundary: boolean;
    value: string;
  }>;

function splitReviewMarkdownLines(text: string): ReadonlyArray<ReviewMarkdownLine> {
  const lines: Array<ReviewMarkdownLine> = [];
  const lineEndingPattern = /\r\n|\r|\n/g;
  let lineStartIndex = 0;

  for (
    let lineEnding = lineEndingPattern.exec(text);
    lineEnding !== null;
    lineEnding = lineEndingPattern.exec(text)
  ) {
    lines.push({
      endIndex: lineEnding.index,
      startIndex: lineStartIndex,
      value: text.slice(lineStartIndex, lineEnding.index),
    });
    lineStartIndex = lineEnding.index + lineEnding[0].length;
  }

  lines.push({
    endIndex: text.length,
    startIndex: lineStartIndex,
    value: text.slice(lineStartIndex),
  });

  return lines;
}

function findReviewLineIndex(lines: ReadonlyArray<ReviewMarkdownLine>, offset: number): number {
  const lineIndex = lines.findIndex((line) => offset >= line.startIndex && offset <= line.endIndex);
  if (lineIndex === -1) {
    throw new Error(`Review math guard could not locate the source line at offset ${offset}`);
  }

  return lineIndex;
}

/** A blank line holds only spaces and tabs, as CommonMark defines it. */
function isBlankReviewMarkdownLine(line: ReviewMarkdownLine): boolean {
  return REVIEW_MATH_SPACE_ONLY_PATTERN.test(line.value);
}

/**
 * The pandoc delimiter guards treat only the ASCII space, the ASCII tab, and the
 * end of the line as space. Every other character, the non-breaking space
 * included, is a non-space character, so this must never delegate to a general
 * whitespace predicate.
 */
function isReviewMathSpaceCharacter(character: string | undefined): boolean {
  return character === undefined || character === " " || character === "\t";
}

function isReviewMathDigitCharacter(character: string | undefined): boolean {
  return character !== undefined && REVIEW_MATH_DIGIT_PATTERN.test(character);
}

function readDollarRuns(lineValue: string): ReadonlyArray<ReviewDollarRun> {
  const runs: Array<ReviewDollarRun> = [];
  let column = 0;

  while (column < lineValue.length) {
    if (lineValue[column] === "\\") {
      column += 2;
      continue;
    }

    if (lineValue[column] !== "$") {
      column += 1;
      continue;
    }

    let runLength = 1;
    while (lineValue[column + runLength] === "$") {
      runLength += 1;
    }

    runs.push({ length: runLength, startColumn: column });
    column += runLength;
  }

  return runs;
}

function readBacktickRunLength(region: string, runStartOffset: number): number {
  let runLength = 1;
  while (region[runStartOffset + runLength] === "`") {
    runLength += 1;
  }

  return runLength;
}

/**
 * Joins the scanned lines back into one contiguous region, because CommonMark
 * resolves an inline code span inside one block and a span may cross a line
 * break of the paragraph. Each line ending contributes as many characters as it
 * holds, so `lines[firstLineIndex].startIndex + offset` stays the source index.
 */
function readParagraphRegion(
  lines: ReadonlyArray<ReviewMarkdownLine>,
  firstLineIndex: number,
  lastLineIndex: number,
): string {
  let region = lines[firstLineIndex].value;

  for (let lineIndex = firstLineIndex + 1; lineIndex <= lastLineIndex; lineIndex += 1) {
    const line = lines[lineIndex];
    region += "\n".repeat(line.startIndex - lines[lineIndex - 1].endIndex);
    region += line.value;
  }

  return region;
}

/**
 * Finds the run that closes a code span opened by a run of `openingRunLength`
 * backticks. Backslash escapes do not work inside a code span, so this scan
 * applies no escape handling at all: a backtick run directly after a backslash
 * still closes the span, which is how CommonMark reads `` `foo\` ``.
 */
function findClosingBacktickRunOffset(
  region: string,
  searchStartOffset: number,
  openingRunLength: number,
): number | null {
  let offset = searchStartOffset;

  while (offset < region.length) {
    if (region[offset] !== "`") {
      offset += 1;
      continue;
    }

    const runLength = readBacktickRunLength(region, offset);
    if (runLength === openingRunLength) {
      return offset;
    }

    offset += runLength;
  }

  return null;
}

/**
 * Reads the source ranges the inline code spans of one paragraph cover. Code
 * spans take precedence over math and are never scanned for math delimiters, so
 * a dollar inside one of these ranges neither opens nor closes a formula and is
 * never escaped.
 *
 * The scan carries the open and closed state through a single pass, because
 * escape handling differs on the two sides of a span boundary: outside a span
 * `` \` `` is an escaped backtick that opens nothing, while inside one the
 * backslash is literal content that must never hide the closing run.
 */
function readParagraphCodeSpanRanges(
  lines: ReadonlyArray<ReviewMarkdownLine>,
  firstLineIndex: number,
  lastLineIndex: number,
): ReadonlyArray<ReviewSourceRange> {
  const region = readParagraphRegion(lines, firstLineIndex, lastLineIndex);
  const regionStartIndex = lines[firstLineIndex].startIndex;
  const ranges: Array<ReviewSourceRange> = [];
  let offset = 0;

  while (offset < region.length) {
    if (region[offset] === "\\") {
      offset += 2;
      continue;
    }

    if (region[offset] !== "`") {
      offset += 1;
      continue;
    }

    const openingRunLength = readBacktickRunLength(region, offset);
    const closingRunOffset = findClosingBacktickRunOffset(region, offset + openingRunLength, openingRunLength);
    if (closingRunOffset === null) {
      // The run opens no span, so it is literal text and the scan resumes right
      // after it with escape handling active again.
      offset += openingRunLength;
      continue;
    }

    ranges.push({
      endIndex: regionStartIndex + closingRunOffset + openingRunLength,
      startIndex: regionStartIndex + offset,
    });
    offset = closingRunOffset + openingRunLength;
  }

  return ranges;
}

function isInsideCodeSpan(index: number, codeSpanRanges: ReadonlyArray<ReviewSourceRange>): boolean {
  return codeSpanRanges.some((range) => index >= range.startIndex && index < range.endIndex);
}

/**
 * Scans one source line for inline formulas using the pandoc `tex_math_dollars`
 * delimiter guards. Only a run of exactly one dollar can delimit inline math,
 * inline math never spans lines, and a dollar a code span covers is not part of
 * the scan at all.
 */
function scanInlineMathSpans(
  line: ReviewMarkdownLine,
  codeSpanRanges: ReadonlyArray<ReviewSourceRange>,
): ReadonlyArray<ReviewMathConstruct> {
  const runs = readDollarRuns(line.value).filter((run) => (
    isInsideCodeSpan(line.startIndex + run.startColumn, codeSpanRanges) === false
  ));
  const spans: Array<ReviewMathConstruct> = [];
  let runIndex = 0;

  while (runIndex < runs.length) {
    const openingRun = runs[runIndex];
    if (openingRun.length !== 1 || isReviewMathSpaceCharacter(line.value[openingRun.startColumn + 1])) {
      runIndex += 1;
      continue;
    }

    if (runIndex + 1 >= runs.length) {
      // The line holds no later dollar, so nothing on it is left to scan.
      break;
    }

    const closingRun = runs[runIndex + 1];
    if (closingRun.length !== 1) {
      // The attempt fails at the display fence sequence, and the scan continues
      // after that whole run.
      runIndex += 2;
      continue;
    }

    if (
      isReviewMathSpaceCharacter(line.value[closingRun.startColumn - 1])
      || isReviewMathDigitCharacter(line.value[closingRun.startColumn + 1])
    ) {
      // The dollar that failed as a closer is the next candidate opener.
      runIndex += 1;
      continue;
    }

    spans.push({
      endIndex: line.startIndex + closingRun.startColumn + 1,
      formulaSource: line.value.slice(openingRun.startColumn + 1, closingRun.startColumn),
      startIndex: line.startIndex + openingRun.startColumn,
    });
    runIndex += 2;
  }

  return spans;
}

/**
 * Reads the display formula that opens on `lineIndex`, following the source-level
 * rules of `docs/review-markdown-rendering.md`. The opening run must begin its
 * own top-level block, and the closing run must hold exactly as many dollars as
 * the opening run.
 */
function readDisplayMathConstruct(
  lines: ReadonlyArray<ReviewMarkdownLine>,
  lineIndex: number,
): ReviewMathConstruct | null {
  const openingLine = lines[lineIndex];
  const openingLineRuns = readDollarRuns(openingLine.value);
  if (openingLineRuns.length === 0) {
    return null;
  }

  const openingRun = openingLineRuns[0];
  if (
    openingRun.length < 2
    || REVIEW_MATH_OPENING_RUN_INDENT_PATTERN.test(openingLine.value.slice(0, openingRun.startColumn)) === false
    || (lineIndex > 0 && isBlankReviewMarkdownLine(lines[lineIndex - 1]) === false)
  ) {
    return null;
  }

  const startIndex = openingLine.startIndex + openingRun.startColumn;
  const bodyStartColumn = openingRun.startColumn + openingRun.length;

  if (openingLineRuns.length > 1) {
    const closingRun = openingLineRuns[1];
    if (
      closingRun.length !== openingRun.length
      || REVIEW_MATH_SPACE_ONLY_PATTERN.test(
        openingLine.value.slice(closingRun.startColumn + closingRun.length),
      ) === false
      || (lineIndex + 1 < lines.length && isBlankReviewMarkdownLine(lines[lineIndex + 1]) === false)
    ) {
      return null;
    }

    return {
      endIndex: openingLine.startIndex + closingRun.startColumn + closingRun.length,
      formulaSource: openingLine.value.slice(bodyStartColumn, closingRun.startColumn),
      startIndex,
    };
  }

  if (REVIEW_MATH_SPACE_ONLY_PATTERN.test(openingLine.value.slice(bodyStartColumn)) === false) {
    return null;
  }

  for (let closingLineIndex = lineIndex + 1; closingLineIndex < lines.length; closingLineIndex += 1) {
    const closingLine = lines[closingLineIndex];
    const closingLineRuns = readDollarRuns(closingLine.value);
    if (closingLineRuns.length !== 1) {
      continue;
    }

    const closingRun = closingLineRuns[0];
    if (
      REVIEW_MATH_OPENING_RUN_INDENT_PATTERN.test(closingLine.value.slice(0, closingRun.startColumn)) === false
      || REVIEW_MATH_SPACE_ONLY_PATTERN.test(
        closingLine.value.slice(closingRun.startColumn + closingRun.length),
      ) === false
    ) {
      continue;
    }

    if (closingRun.length !== openingRun.length) {
      return null;
    }

    return {
      endIndex: closingLine.startIndex + closingRun.startColumn + closingRun.length,
      formulaSource: lines
        .slice(lineIndex + 1, closingLineIndex)
        .map((bodyLine) => bodyLine.value)
        .join("\n"),
      startIndex,
    };
  }

  return null;
}

function requireNodeSource(text: string, node: Nodes): ReviewNodeSource {
  const startIndex = node.position?.start.offset;
  const endIndex = node.position?.end.offset;
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error(`Review math parser returned a ${node.type} node without source offsets`);
  }

  return {
    delimitedSource: text.slice(startIndex, endIndex),
    endIndex,
    startIndex,
  };
}

/**
 * Accepts a display formula for a flow math node whose opening run begins an
 * accepted display construct in the source. `remark-math` emits a flow math node
 * only for the multiple-line shape; the single-line shape arrives as an inline
 * math node and `scanParagraphMath` promotes it to display.
 */
function readDisplayMathNodeSource(
  text: string,
  lines: ReadonlyArray<ReviewMarkdownLine>,
  node: Nodes,
): ReviewMathSource | null {
  const source = requireNodeSource(text, node);
  const construct = readDisplayMathConstruct(lines, findReviewLineIndex(lines, source.startIndex));
  if (construct === null || construct.startIndex !== source.startIndex) {
    return null;
  }

  return {
    ...source,
    formulaSource: construct.formulaSource,
    mathMode: "display",
  };
}

function sourceKey(source: Readonly<{ endIndex: number; startIndex: number }>): string {
  return `${source.startIndex}:${source.endIndex}`;
}

function readNodeSourceKey(node: Nodes): string | null {
  const startIndex = node.position?.start.offset;
  const endIndex = node.position?.end.offset;
  if (startIndex === undefined || endIndex === undefined) {
    return null;
  }

  return sourceKey({ endIndex, startIndex });
}

function containsReferenceDefinition(tree: Root): boolean {
  let containsDefinition = false;
  visit(tree, "definition", () => {
    containsDefinition = true;
    return EXIT;
  });
  return containsDefinition;
}

/**
 * Reads every formula the source rules accept inside one top-level paragraph.
 * The escape pass and the accept pass segment a paragraph with this one scan, so
 * they can never disagree about the same card side.
 */
function scanParagraphMath(
  lines: ReadonlyArray<ReviewMarkdownLine>,
  paragraph: ReviewNodeSource,
): ReviewParagraphMathScan {
  const firstLineIndex = findReviewLineIndex(lines, paragraph.startIndex);
  const lastLineIndex = findReviewLineIndex(lines, paragraph.endIndex);
  const displayConstruct = readDisplayMathConstruct(lines, firstLineIndex);

  if (
    displayConstruct !== null
    && displayConstruct.startIndex === paragraph.startIndex
    && displayConstruct.endIndex === paragraph.endIndex
  ) {
    // A display body is LaTeX source rather than Markdown, so it holds no code
    // spans and every dollar in the paragraph belongs to the construct.
    return {
      codeSpanRanges: [],
      constructs: [displayConstruct],
      firstLineIndex,
      lastLineIndex,
      mathMode: "display",
    };
  }

  const codeSpanRanges = readParagraphCodeSpanRanges(lines, firstLineIndex, lastLineIndex);
  const constructs: Array<ReviewMathConstruct> = [];

  for (let lineIndex = firstLineIndex; lineIndex <= lastLineIndex; lineIndex += 1) {
    constructs.push(...scanInlineMathSpans(lines[lineIndex], codeSpanRanges));
  }

  return {
    codeSpanRanges,
    constructs,
    firstLineIndex,
    lastLineIndex,
    mathMode: "inline",
  };
}

/**
 * Math is eligible only in a top-level paragraph whose children are ordinary text
 * or formula spans. `remark-math` segments a paragraph more loosely than the
 * source rules do, so a child the scan places inside an accepted formula is part
 * of that formula source and does not make the paragraph ineligible. An inline
 * code span is neither, so a paragraph that holds one outside every formula keeps
 * its dollars literal.
 */
function isMathEligibleParagraph(
  node: Extract<RootContent, { type: "paragraph" }>,
  constructs: ReadonlyArray<ReviewMathConstruct>,
): boolean {
  return node.children.every((paragraphChild) => {
    if (paragraphChild.type === "text" || paragraphChild.type === "inlineMath") {
      return true;
    }

    const startIndex = paragraphChild.position?.start.offset;
    const endIndex = paragraphChild.position?.end.offset;
    if (startIndex === undefined || endIndex === undefined) {
      return false;
    }

    return constructs.some((construct) => (
      startIndex >= construct.startIndex && endIndex <= construct.endIndex
    ));
  });
}

/**
 * Reads the source keys of the nodes an accepted construct of one paragraph can
 * become. The transform renders a formula by replacing the node whose source
 * range matches the construct exactly, so a construct the parser segments
 * differently has no node to render into and has to stay literal on every path.
 *
 * `remark-math` consumes a text-math span raw and honours no backslash escape
 * inside it, so `The price $p = \$5$ today.` is such a construct: the source
 * rules close it on the last dollar, the parser closes it on the escaped one, and
 * only the parser's boundaries can be rendered. Anchoring acceptance to the node
 * keeps rendering, presentation selection, and speech on one literal answer
 * instead of speaking a formula the card never shows.
 *
 * A single-line display construct is handed over as an `inlineMath` child rather
 * than a flow math node, and `transformRootChildren` promotes it only when it is
 * the paragraph's only child, so display acceptance tests exactly that shape.
 */
function readParagraphMathNodeKeys(
  node: Extract<RootContent, { type: "paragraph" }>,
  mathMode: ReviewMathMode,
): ReadonlySet<string> {
  if (mathMode === "display") {
    if (node.children.length !== 1) {
      return new Set<string>();
    }

    const onlyChild = node.children[0];
    if (onlyChild.type !== "inlineMath") {
      return new Set<string>();
    }

    const promotableKey = readNodeSourceKey(onlyChild);
    return new Set<string>(promotableKey === null ? [] : [promotableKey]);
  }

  const nodeKeys = new Set<string>();
  visit(node, "inlineMath", (inlineMathNode) => {
    const nodeKey = readNodeSourceKey(inlineMathNode);
    if (nodeKey !== null) {
      nodeKeys.add(nodeKey);
    }
  });

  return nodeKeys;
}

function collectAcceptedReviewMathSources(tree: Root, text: string): ReadonlyArray<ReviewMathSource> {
  if (containsReferenceDefinition(tree)) {
    return [];
  }

  const lines = splitReviewMarkdownLines(text);
  const sources: Array<ReviewMathSource> = [];

  for (const child of tree.children) {
    if (child.type === "math") {
      const source = readDisplayMathNodeSource(text, lines, child);
      if (source !== null) {
        sources.push(source);
      }
      continue;
    }

    if (child.type !== "paragraph") {
      continue;
    }

    const scan = scanParagraphMath(lines, requireNodeSource(text, child));
    if (isMathEligibleParagraph(child, scan.constructs) === false) {
      continue;
    }

    const nodeKeys = readParagraphMathNodeKeys(child, scan.mathMode);
    for (const construct of scan.constructs) {
      if (nodeKeys.has(sourceKey(construct)) === false) {
        continue;
      }

      sources.push({
        delimitedSource: text.slice(construct.startIndex, construct.endIndex),
        endIndex: construct.endIndex,
        formulaSource: construct.formulaSource,
        mathMode: scan.mathMode,
        startIndex: construct.startIndex,
      });
    }
  }

  return sources;
}

function replaceParentChild(parent: Parents | undefined, index: number | undefined, replacement: Nodes): void {
  if (parent === undefined || index === undefined) {
    throw new Error("Review math guard could not replace a node without its parent and index");
  }

  const children = parent.children as Array<Nodes>;
  children[index] = replacement;
}

function createContainerMathLiteral(node: Extract<Nodes, { type: "math" }>): string {
  const openingDelimiter = node.meta === null || node.meta === undefined ? "$$" : `$$${node.meta}`;
  return `${openingDelimiter}\n${node.value}\n$$`;
}

function markAcceptedDisplayMath(node: Extract<Nodes, { type: "math" }>, source: ReviewMathSource): void {
  node.value = source.formulaSource;
  node.meta = null;
  node.data = {
    hName: "div",
    hProperties: {
      className: ["review-math-block"],
      "data-formula-source": source.formulaSource,
      "data-delimited-source": source.delimitedSource,
    },
    hChildren: [],
  };
}

function markAcceptedInlineMath(node: Extract<Nodes, { type: "inlineMath" }>, source: ReviewMathSource): void {
  node.value = source.formulaSource;
  node.data = {
    hName: "span",
    hProperties: {
      className: ["review-math-inline"],
      "data-formula-source": source.formulaSource,
      "data-delimited-source": source.delimitedSource,
    },
    hChildren: [],
  };
}

function createPromotedDisplayMath(
  node: Extract<Nodes, { type: "inlineMath" }>,
  source: ReviewMathSource,
): Extract<RootContent, { type: "math" }> {
  const mathNode: Extract<RootContent, { type: "math" }> = {
    type: "math",
    value: source.formulaSource,
    meta: null,
    position: node.position,
  };
  markAcceptedDisplayMath(mathNode, source);
  return mathNode;
}

function transformRootChildren(
  children: ReadonlyArray<RootContent>,
  text: string,
  acceptedSourcesByKey: ReadonlyMap<string, ReviewMathSource>,
): Array<RootContent> {
  const transformedChildren: Array<RootContent> = [];

  for (const child of children) {
    if (child.type === "math") {
      const source = requireNodeSource(text, child);
      const acceptedSource = acceptedSourcesByKey.get(sourceKey(source));
      if (acceptedSource !== undefined) {
        markAcceptedDisplayMath(child, acceptedSource);
        transformedChildren.push(child);
        continue;
      }

      transformedChildren.push({
        type: "paragraph",
        children: [{
          type: "text",
          value: source.delimitedSource,
          position: child.position,
        }],
        position: child.position,
      });
      continue;
    }

    if (child.type === "paragraph" && child.children.length === 1) {
      const onlyChild = child.children[0];
      if (onlyChild.type === "inlineMath") {
        const acceptedSource = acceptedSourcesByKey.get(sourceKey(requireNodeSource(text, onlyChild)));
        if (acceptedSource !== undefined && acceptedSource.mathMode === "display") {
          transformedChildren.push(createPromotedDisplayMath(onlyChild, acceptedSource));
          continue;
        }
      }
    }

    transformedChildren.push(child);
  }

  return transformedChildren;
}

export function transformReviewMathBlocks(tree: Root, text: string): Root {
  const transformedTree = structuredClone(tree);
  const acceptedSources = collectAcceptedReviewMathSources(transformedTree, text);
  const acceptedSourcesByKey = new Map(acceptedSources.map((source) => [sourceKey(source), source]));

  transformedTree.children = transformRootChildren(transformedTree.children, text, acceptedSourcesByKey);

  // This guard is the intentional V1 cross-client boundary for eligible formula topology.
  visit(transformedTree, "inlineMath", (node, index, parent) => {
    const source = requireNodeSource(text, node);
    const acceptedSource = acceptedSourcesByKey.get(sourceKey(source));
    if (acceptedSource !== undefined && acceptedSource.mathMode === "inline") {
      markAcceptedInlineMath(node, acceptedSource);
      return;
    }
    replaceParentChild(parent, index, {
      type: "text",
      value: source.delimitedSource,
      position: node.position,
    });
    return SKIP;
  });

  visit(transformedTree, "math", (node, index, parent) => {
    if (parent?.type === "root") {
      // Top-level display math is already accepted or literalized above.
      return;
    }
    replaceParentChild(parent, index, {
      type: "paragraph",
      children: [{
        type: "text",
        value: createContainerMathLiteral(node),
        position: node.position,
      }],
      position: node.position,
    });
    return SKIP;
  });

  return transformedTree;
}

const reviewMathProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/**
 * Collects every dollar sign inside a top-level block that the source rules leave
 * literal. Dollars an inline code span covers are not math delimiters and are
 * never escaped, because a backslash inside a code span is literal text rather
 * than an escape. A rejected display fence contributes only its opening run: the
 * re-parse then returns whatever that fence swallowed to ordinary Markdown.
 */
function collectRejectedDollarIndexes(
  tree: Root,
  text: string,
  lines: ReadonlyArray<ReviewMarkdownLine>,
): ReadonlyArray<number> {
  const rejectedIndexes: Array<number> = [];

  for (const child of tree.children) {
    if (child.type === "math") {
      if (readDisplayMathNodeSource(text, lines, child) !== null) {
        continue;
      }
      rejectedIndexes.push(...readRejectedDisplayFenceIndexes(text, lines, child));
      continue;
    }

    if (child.type !== "paragraph") {
      continue;
    }

    const scan = scanParagraphMath(lines, requireNodeSource(text, child));
    if (isMathEligibleParagraph(child, scan.constructs) === false) {
      continue;
    }

    for (let lineIndex = scan.firstLineIndex; lineIndex <= scan.lastLineIndex; lineIndex += 1) {
      const line = lines[lineIndex];
      for (const run of readDollarRuns(line.value)) {
        const runStartIndex = line.startIndex + run.startColumn;
        if (isInsideCodeSpan(runStartIndex, scan.codeSpanRanges)) {
          continue;
        }

        const isAccepted = scan.constructs.some((construct) => (
          runStartIndex >= construct.startIndex && runStartIndex < construct.endIndex
        ));
        if (isAccepted) {
          continue;
        }

        for (let runOffset = 0; runOffset < run.length; runOffset += 1) {
          rejectedIndexes.push(runStartIndex + runOffset);
        }
      }
    }
  }

  return rejectedIndexes;
}

function readRejectedDisplayFenceIndexes(
  text: string,
  lines: ReadonlyArray<ReviewMarkdownLine>,
  node: Extract<RootContent, { type: "math" }>,
): ReadonlyArray<number> {
  const source = requireNodeSource(text, node);
  const line = lines[findReviewLineIndex(lines, source.startIndex)];
  const openingRun = readDollarRuns(line.value).find((run) => (
    line.startIndex + run.startColumn >= source.startIndex
  ));
  if (openingRun === undefined) {
    throw new Error("Review math guard could not locate the opening run of a rejected display formula");
  }

  const openingRunStartIndex = line.startIndex + openingRun.startColumn;
  const indexes: Array<number> = [];
  for (let runOffset = 0; runOffset < openingRun.length; runOffset += 1) {
    indexes.push(openingRunStartIndex + runOffset);
  }

  return indexes;
}

function escapeRejectedReviewMathDollarsOnce(text: string): string {
  const tree = reviewMathProcessor.parse(text);
  if (containsReferenceDefinition(tree)) {
    return text;
  }

  // The rewrite below copies the source forward once, so the indexes have to be
  // strictly ascending: a repeated or backwards index would duplicate source text
  // instead of escaping a dollar.
  const rejectedIndexes = [
    ...new Set(collectRejectedDollarIndexes(tree, text, splitReviewMarkdownLines(text))),
  ].sort((leftIndex, rightIndex) => leftIndex - rightIndex);
  let escapedText = "";
  let copiedIndex = 0;

  for (const rejectedIndex of rejectedIndexes) {
    escapedText += `${text.slice(copiedIndex, rejectedIndex)}\\`;
    copiedIndex = rejectedIndex;
  }

  return escapedText + text.slice(copiedIndex);
}

/**
 * Escapes every dollar sign the math contract leaves literal, so `remark-math`
 * segments the card side exactly the way the source rules do before the transform
 * confirms each node.
 *
 * `remark-math` closes a text-math span on the first later run of the same size
 * and applies no delimiter guards, so it can swallow a span this contract
 * accepts: `A $100 bond with yield $r$ pays` arrives as a single `inlineMath`
 * node holding `100 bond with yield `, with no node left for `$r$`. An
 * unterminated flow fence is worse still and swallows the whole remainder of the
 * side, Markdown and all.
 *
 * Escaping only ever adds a backslash in front of a dollar the source rules
 * already reject, so it can never change which formulas are accepted. Escaping a
 * rejected fence changes which blocks the parser sees, so the pass repeats until
 * the source stops changing; each pass escapes at least one previously unescaped
 * dollar and never adds one, so the dollar count bounds the number of passes.
 */
export function escapeRejectedReviewMathDollars(text: string): string {
  const passLimit = text.split("$").length;
  let escapedText = text;

  for (let pass = 0; pass < passLimit; pass += 1) {
    const nextText = escapeRejectedReviewMathDollarsOnce(escapedText);
    if (nextText === escapedText) {
      return escapedText;
    }
    escapedText = nextText;
  }

  throw new Error("Review math escaping did not converge for the card side");
}

/**
 * Reads the accepted formulas of a card side through the same escape pass the
 * review screen renders with, so presentation selection, rendering, and speech
 * can never disagree about which spans are formulas.
 */
function collectEscapedReviewMathSources(text: string): Readonly<{
  escapedText: string;
  sources: ReadonlyArray<ReviewMathSource>;
}> {
  const escapedText = escapeRejectedReviewMathDollars(text);
  return {
    escapedText,
    sources: collectAcceptedReviewMathSources(reviewMathProcessor.parse(escapedText), escapedText),
  };
}

export function hasEligibleReviewMath(text: string): boolean {
  return collectEscapedReviewMathSources(text).sources.length > 0;
}

export function normalizeReviewPlainTextEscapedDollars(text: string): string {
  const normalizedCharacters: Array<string> = [];
  let precedingBackslashCount = 0;

  for (const character of text) {
    if (character === "\\") {
      precedingBackslashCount += 1;
      continue;
    }

    const preservedBackslashCount = character === "$" && precedingBackslashCount % 2 !== 0
      ? precedingBackslashCount - 1
      : precedingBackslashCount;
    normalizedCharacters.push("\\".repeat(preservedBackslashCount), character);
    precedingBackslashCount = 0;
  }

  normalizedCharacters.push("\\".repeat(precedingBackslashCount));
  return normalizedCharacters.join("");
}

/**
 * Prose is sliced out of the escaped source, so the dollars the escape pass added
 * a backslash to are read back as the literal dollars the author wrote.
 */
function createReviewMathProseSegment(
  escapedText: string,
  startIndex: number,
  endIndex: number,
): ReviewMathSpeechSegment {
  return {
    kind: "prose",
    startsAtLineBoundary: startIndex === 0 || /[\r\n]/.test(escapedText[startIndex - 1] ?? ""),
    value: normalizeReviewPlainTextEscapedDollars(escapedText.slice(startIndex, endIndex)),
  };
}

export function splitEligibleReviewMathForSpeech(text: string): ReadonlyArray<ReviewMathSpeechSegment> {
  const { escapedText, sources } = collectEscapedReviewMathSources(text);
  const orderedSources = [...sources].sort((left, right) => left.startIndex - right.startIndex);
  const segments: Array<ReviewMathSpeechSegment> = [];
  let sourceCursor = 0;

  for (const source of orderedSources) {
    if (source.startIndex > sourceCursor) {
      segments.push(createReviewMathProseSegment(escapedText, sourceCursor, source.startIndex));
    }
    segments.push({
      kind: "formula",
      value: source.formulaSource,
    });
    sourceCursor = source.endIndex;
  }

  if (sourceCursor < escapedText.length || segments.length === 0) {
    segments.push(createReviewMathProseSegment(escapedText, sourceCursor, escapedText.length));
  }

  return segments;
}

const reviewMathBlocks: Plugin<[], Root> = function reviewMathBlocksPlugin() {
  return (tree, file) => transformReviewMathBlocks(tree, String(file));
};

export default reviewMathBlocks;
