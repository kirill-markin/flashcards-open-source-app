export type LiteralCardTextEscape = Readonly<{
  escape: "\\n" | "\\\"";
  excerpt: string;
}>;

const excerptRadius = 20;

const fenceOpenPattern = /^[\s>]*(`{3,}|~{3,})/u;
const fenceClosePattern = /^[\s>]*(`{3,}|~{3,})[ \t]*$/u;

function closesFence(line: string, fence: string): boolean {
  const closeMatch = fenceClosePattern.exec(line);
  return closeMatch !== null && closeMatch[1][0] === fence[0] && closeMatch[1].length >= fence.length;
}

/**
 * Replaces fenced code blocks with spaces, keeping line breaks so offsets and
 * line boundaries stay aligned with the original text. As in migration 0235, a
 * run opens a fence only when a later line closes it and, for backticks, no
 * backtick follows it on its line; otherwise it stays plain text. The opening
 * line keeps its info string scannable: a double-escaped card is one line, so
 * masking the whole opener would hide it.
 */
function maskFencedCodeBlocks(text: string): string {
  const lines = text.split("\n");
  let openFence: string | null = null;

  return lines.map((line, lineIndex) => {
    if (openFence !== null) {
      if (closesFence(line, openFence)) {
        openFence = null;
      }
      return " ".repeat(line.length);
    }

    const openMatch = fenceOpenPattern.exec(line);
    if (openMatch === null) {
      return line;
    }
    const fence = openMatch[1];
    const infoString = line.slice(openMatch[0].length);
    const isFence = (fence[0] === "~" || !infoString.includes("`"))
      && lines.slice(lineIndex + 1).some((laterLine) => closesFence(laterLine, fence));
    if (!isFence) {
      return line;
    }
    openFence = fence;
    return " ".repeat(openMatch[0].length) + infoString;
  }).join("\n");
}

function countRun(text: string, start: number, character: string): number {
  let end = start;
  while (text[end] === character) {
    end += 1;
  }
  return end - start;
}

function findRun(text: string, start: number, character: string, runLength: number): number {
  let index = start;
  while (index < text.length) {
    if (text[index] !== character) {
      index += 1;
      continue;
    }
    const length = countRun(text, index, character);
    if (length === runLength) {
      return index;
    }
    index += length;
  }
  return -1;
}

function isNonSpace(character: string | undefined): boolean {
  return character !== undefined && character !== " " && character !== "\t" && character !== "\n" && character !== "\r";
}

/**
 * Returns the closing `$` of a one-line inline math span opened by the single
 * `$` at `openIndex`, or -1 when the opener stays literal. Approximates the
 * pandoc guards in docs/review-markdown-rendering.md so currency such as
 * `$12 … $30` is not read as math.
 */
function findInlineMathEnd(text: string, openIndex: number): number {
  if (!isNonSpace(text[openIndex + 1])) {
    return -1;
  }
  let index = openIndex + 1;
  while (index < text.length && text[index] !== "\n") {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === "$") {
      const closesMath = countRun(text, index, "$") === 1
        && isNonSpace(text[index - 1])
        && !/[0-9]/u.test(text[index + 1] ?? "");
      return closesMath ? index : -1;
    }
    index += 1;
  }
  return -1;
}

function buildExcerpt(text: string, escapeIndex: number): string {
  const lineStart = text.lastIndexOf("\n", escapeIndex) + 1;
  const lineEndIndex = text.indexOf("\n", escapeIndex);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  return text.slice(
    Math.max(lineStart, escapeIndex - excerptRadius),
    Math.min(lineEnd, escapeIndex + 2 + excerptRadius),
  );
}

/**
 * Finds the first unescaped literal backslash-n or backslash-quote in a card
 * side outside fenced code, one- or two-backtick code spans, `$$…$$` display
 * math, and one-line `$…$` inline math. Such text is almost always a model that
 * double-escaped at the JSON boundary; `\\n` (an escaped backslash) is allowed.
 * Detection approximates the client renderers on purpose.
 */
export function findLiteralCardTextEscape(text: string): LiteralCardTextEscape | null {
  const scannedText = maskFencedCodeBlocks(text);
  let index = 0;

  while (index < scannedText.length) {
    const character = scannedText[index];

    if (character === "\\") {
      const nextCharacter = scannedText[index + 1];
      if (nextCharacter === "n" || nextCharacter === "\"") {
        return {
          escape: nextCharacter === "n" ? "\\n" : "\\\"",
          excerpt: buildExcerpt(text, index),
        };
      }
      index += 2;
      continue;
    }

    if (character === "`") {
      const runLength = countRun(scannedText, index, "`");
      const closeIndex = runLength > 2 ? -1 : findRun(scannedText, index + runLength, "`", runLength);
      index = closeIndex === -1 ? index + runLength : closeIndex + runLength;
      continue;
    }

    if (character === "$" && scannedText[index + 1] === "$") {
      const runLength = countRun(scannedText, index, "$");
      const closeIndex = findRun(scannedText, index + runLength, "$", runLength);
      index = closeIndex === -1 ? index + runLength : closeIndex + runLength;
      continue;
    }

    if (character === "$") {
      const closeIndex = findInlineMathEnd(scannedText, index);
      index = closeIndex === -1 ? index + 1 : closeIndex + 1;
      continue;
    }

    index += 1;
  }

  return null;
}
