import type { Nodes, Parents, Paragraph, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import type { Plugin } from "unified";
import { unified } from "unified";
import { EXIT, SKIP, visit } from "unist-util-visit";

const DISPLAY_MATH_OPEN_PATTERN = /^[ \t]*\$\$[ \t]*(?:\r\n|\r|\n)/;
const DISPLAY_MATH_CLOSE_PATTERN = /(?:\r\n|\r|\n)[ \t]*\$\$[ \t]*$/;

type ReviewMathSource = Readonly<{
  delimitedSource: string;
  endIndex: number;
  formulaSource: string;
  startIndex: number;
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

function requireNodeSource(text: string, node: Nodes): ReviewMathSource {
  const startIndex = node.position?.start.offset;
  const endIndex = node.position?.end.offset;
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error(`Review math parser returned a ${node.type} node without source offsets`);
  }

  return {
    delimitedSource: text.slice(startIndex, endIndex),
    endIndex,
    formulaSource: node.type === "math" || node.type === "inlineMath" ? node.value : "",
    startIndex,
  };
}

function readInlineMathSource(text: string, node: Nodes): ReviewMathSource | null {
  const source = requireNodeSource(text, node);
  const delimitedSource = source.delimitedSource;
  if (
    delimitedSource.length < 2
    || delimitedSource.startsWith("$$")
    || delimitedSource.endsWith("$$")
    || /[\r\n]/.test(delimitedSource)
  ) {
    return null;
  }

  let precedingBackslashCount = 0;
  for (let index = delimitedSource.length - 2; index >= 0 && delimitedSource[index] === "\\"; index -= 1) {
    precedingBackslashCount += 1;
  }
  if (precedingBackslashCount % 2 !== 0) {
    return null;
  }

  return {
    ...source,
    formulaSource: delimitedSource.slice(1, -1),
  };
}

function readDisplayMathSource(text: string, node: Nodes): ReviewMathSource | null {
  const source = requireNodeSource(text, node);
  const openMatch = DISPLAY_MATH_OPEN_PATTERN.exec(source.delimitedSource);
  const closeMatch = DISPLAY_MATH_CLOSE_PATTERN.exec(source.delimitedSource);
  if (openMatch === null || closeMatch === null || openMatch[0].length > closeMatch.index) {
    return null;
  }

  return {
    ...source,
    formulaSource: source.delimitedSource.slice(openMatch[0].length, closeMatch.index),
  };
}

function sourceKey(source: ReviewMathSource): string {
  return `${source.startIndex}:${source.endIndex}`;
}

function nodeSourceKey(node: Nodes): string {
  const startIndex = node.position?.start.offset;
  const endIndex = node.position?.end.offset;
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error(`Review math parser returned a ${node.type} node without source offsets`);
  }

  return `${startIndex}:${endIndex}`;
}

function containsReferenceDefinition(tree: Root): boolean {
  let containsDefinition = false;
  visit(tree, "definition", () => {
    containsDefinition = true;
    return EXIT;
  });
  return containsDefinition;
}

function collectAcceptedReviewMathSources(tree: Root, text: string): ReadonlyArray<ReviewMathSource> {
  if (containsReferenceDefinition(tree)) {
    return [];
  }

  const sources: Array<ReviewMathSource> = [];
  for (const child of tree.children) {
    if (child.type === "math") {
      const source = readDisplayMathSource(text, child);
      if (source !== null) {
        sources.push(source);
      }
      continue;
    }

    if (
      child.type !== "paragraph"
      || child.children.every((paragraphChild) => (
        paragraphChild.type === "text" || paragraphChild.type === "inlineMath"
      )) === false
    ) {
      continue;
    }

    for (const paragraphChild of child.children) {
      if (paragraphChild.type !== "inlineMath") {
        continue;
      }
      const source = readInlineMathSource(text, paragraphChild);
      if (source !== null) {
        sources.push(source);
      }
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

function markAcceptedMath(node: Extract<Nodes, { type: "math" }>, source: ReviewMathSource): void {
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

function createAcceptedInlineMathBlock(
  node: Extract<Nodes, { type: "inlineMath" }>,
  source: ReviewMathSource,
): Extract<RootContent, { type: "math" }> {
  const mathNode: Extract<RootContent, { type: "math" }> = {
    type: "math",
    value: source.formulaSource,
    meta: null,
    position: node.position,
  };
  markAcceptedMath(mathNode, source);
  return mathNode;
}

function splitAcceptedMathParagraph(
  paragraph: Paragraph,
  acceptedSourcesByKey: ReadonlyMap<string, ReviewMathSource>,
): ReadonlyArray<RootContent> {
  const blocks: Array<RootContent> = [];
  let textChildren: Paragraph["children"] = [];

  function flushTextChildren(): void {
    if (textChildren.length === 0) {
      return;
    }
    blocks.push({
      type: "paragraph",
      children: textChildren,
    });
    textChildren = [];
  }

  for (const child of paragraph.children) {
    if (child.type === "inlineMath") {
      const source = acceptedSourcesByKey.get(nodeSourceKey(child));
      if (source === undefined) {
        throw new Error("Review math guard lost an accepted inline formula during paragraph splitting");
      }
      flushTextChildren();
      blocks.push(createAcceptedInlineMathBlock(child, source));
      continue;
    }

    textChildren.push(child);
  }
  flushTextChildren();

  return blocks;
}

export function transformReviewMathBlocks(tree: Root, text: string): Root {
  const transformedTree = structuredClone(tree);
  const acceptedSources = collectAcceptedReviewMathSources(transformedTree, text);
  const acceptedSourcesByKey = new Map(acceptedSources.map((source) => [sourceKey(source), source]));

  // This guard is the intentional V1 cross-client boundary for eligible formula topology.
  visit(transformedTree, "inlineMath", (node, index, parent) => {
    const source = requireNodeSource(text, node);
    if (acceptedSourcesByKey.has(sourceKey(source))) {
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
    const source = requireNodeSource(text, node);
    const acceptedSource = acceptedSourcesByKey.get(sourceKey(source));
    if (acceptedSource !== undefined) {
      markAcceptedMath(node, acceptedSource);
      return;
    }
    replaceParentChild(parent, index, {
      type: "paragraph",
      children: [{
        type: "text",
        value: parent?.type === "root" ? source.delimitedSource : createContainerMathLiteral(node),
        position: node.position,
      }],
      position: node.position,
    });
    return SKIP;
  });

  transformedTree.children = transformedTree.children.flatMap((child) => {
    if (child.type !== "paragraph" || child.children.some((paragraphChild) => paragraphChild.type === "inlineMath") === false) {
      return [child];
    }
    return splitAcceptedMathParagraph(child, acceptedSourcesByKey);
  });

  return transformedTree;
}

const reviewMathProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export function hasEligibleReviewMath(text: string): boolean {
  return collectAcceptedReviewMathSources(reviewMathProcessor.parse(text), text).length > 0;
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

export function splitEligibleReviewMathForSpeech(text: string): ReadonlyArray<ReviewMathSpeechSegment> {
  const sources = [...collectAcceptedReviewMathSources(reviewMathProcessor.parse(text), text)]
    .sort((left, right) => left.startIndex - right.startIndex);
  const segments: Array<ReviewMathSpeechSegment> = [];
  let sourceCursor = 0;

  for (const source of sources) {
    if (source.startIndex > sourceCursor) {
      segments.push({
        kind: "prose",
        startsAtLineBoundary: sourceCursor === 0 || /[\r\n]/.test(text[sourceCursor - 1] ?? ""),
        value: text.slice(sourceCursor, source.startIndex),
      });
    }
    segments.push({
      kind: "formula",
      value: source.formulaSource,
    });
    sourceCursor = source.endIndex;
  }

  if (sourceCursor < text.length || segments.length === 0) {
    segments.push({
      kind: "prose",
      startsAtLineBoundary: sourceCursor === 0 || /[\r\n]/.test(text[sourceCursor - 1] ?? ""),
      value: text.slice(sourceCursor),
    });
  }

  return segments;
}

const reviewMathBlocks: Plugin<[], Root> = function reviewMathBlocksPlugin() {
  return (tree, file) => transformReviewMathBlocks(tree, String(file));
};

export default reviewMathBlocks;
