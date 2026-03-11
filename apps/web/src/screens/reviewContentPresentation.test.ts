import { describe, expect, it } from "vitest";
import { classifyReviewContentPresentation } from "./reviewContentPresentation";

describe("classifyReviewContentPresentation", () => {
  it("returns shortPlain for a short one-line string", () => {
    expect(classifyReviewContentPresentation("Hola")).toBe("shortPlain");
  });

  it("returns shortPlain for four words on one line", () => {
    expect(classifyReviewContentPresentation("one two three four")).toBe("shortPlain");
  });

  it("returns paragraphPlain for five words", () => {
    expect(classifyReviewContentPresentation("one two three four five")).toBe("paragraphPlain");
  });

  it("returns paragraphPlain for multi-line plain text", () => {
    expect(classifyReviewContentPresentation("First line\nSecond line")).toBe("paragraphPlain");
  });

  it("returns markdown for heading content", () => {
    expect(classifyReviewContentPresentation("# Heading")).toBe("markdown");
  });

  it("returns markdown for fenced code blocks", () => {
    expect(classifyReviewContentPresentation("```ts\nconst value = 1;\n```")).toBe("markdown");
  });

  it("returns markdown when content contains inline backticks", () => {
    expect(classifyReviewContentPresentation("Use `map` here")).toBe("markdown");
  });

  it("keeps markdown precedence over short length", () => {
    expect(classifyReviewContentPresentation("> short")).toBe("markdown");
  });

  it("returns paragraphPlain for empty text", () => {
    expect(classifyReviewContentPresentation("   ")).toBe("paragraphPlain");
  });
});
