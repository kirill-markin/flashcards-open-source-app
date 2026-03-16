import { describe, expect, it } from "vitest";
import { normalizeReviewMarkdownForWeb } from "./ReviewScreen";

describe("normalizeReviewMarkdownForWeb", () => {
  it("escapes symbol-only unordered list items that reopen markdown", () => {
    const source = [
      "- +",
      "- *",
      "- -",
      "- >",
      "- #",
    ].join("\n");

    expect(normalizeReviewMarkdownForWeb(source)).toBe([
      "- \\+",
      "- \\*",
      "- \\-",
      "- \\>",
      "- \\#",
    ].join("\n"));
  });

  it("keeps ordinary unordered list items unchanged", () => {
    const source = [
      "- A-Z",
      "- 0-9",
    ].join("\n");

    expect(normalizeReviewMarkdownForWeb(source)).toBe(source);
  });

  it("does not normalize symbol-only list items inside fenced code blocks", () => {
    const source = [
      "```md",
      "- +",
      "```",
      "- +",
    ].join("\n");

    expect(normalizeReviewMarkdownForWeb(source)).toBe([
      "```md",
      "- +",
      "```",
      "- \\+",
    ].join("\n"));
  });
});
