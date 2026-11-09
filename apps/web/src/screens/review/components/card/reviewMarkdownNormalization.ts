const REVIEW_MARKDOWN_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN = /^(\s{0,3}[-*+]\s+)([+*\-#>])(\s*)$/;
const REVIEW_MARKDOWN_DISPLAY_MATH_DELIMITER_PATTERN = /^[ \t]*\$\$[ \t]*$/;

type MarkdownFenceMarker = "`" | "~";

function toMarkdownFenceMarker(line: string): MarkdownFenceMarker | null {
  const match = REVIEW_MARKDOWN_FENCE_PATTERN.exec(line);

  if (match === null) {
    return null;
  }

  const marker = match[1]?.[0];
  if (marker === "`" || marker === "~") {
    return marker;
  }

  return null;
}

function escapeSymbolOnlyListItem(line: string): string {
  const match = REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN.exec(line);

  if (match === null) {
    return line;
  }

  const listMarker = match[1];
  const symbolToken = match[2];
  const trailingWhitespace = match[3];

  return `${listMarker}\\${symbolToken}${trailingWhitespace}`;
}

export function normalizeReviewMarkdownForWeb(text: string): string {
  const lines = text.split("\n");
  const normalizedLines: Array<string> = [];
  let activeFenceMarker: MarkdownFenceMarker | null = null;
  let isInsideDisplayMath = false;

  for (const line of lines) {
    const lineFenceMarker = toMarkdownFenceMarker(line);

    if (activeFenceMarker !== null) {
      normalizedLines.push(line);

      if (lineFenceMarker === activeFenceMarker) {
        activeFenceMarker = null;
      }

      continue;
    }

    if (REVIEW_MARKDOWN_DISPLAY_MATH_DELIMITER_PATTERN.test(line)) {
      isInsideDisplayMath = !isInsideDisplayMath;
      normalizedLines.push(line);
      continue;
    }

    if (isInsideDisplayMath) {
      normalizedLines.push(line);
      continue;
    }

    if (lineFenceMarker !== null) {
      activeFenceMarker = lineFenceMarker;
      normalizedLines.push(line);
      continue;
    }

    normalizedLines.push(escapeSymbolOnlyListItem(line));
  }

  return normalizedLines.join("\n");
}
