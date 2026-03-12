import { describe, expect, it } from "vitest";
import { mergeDictationTranscriptIntoDraft } from "./chatDictation";

describe("mergeDictationTranscriptIntoDraft", () => {
  it("adds a separating space before transcript text when the draft does not end with whitespace", () => {
    expect(mergeDictationTranscriptIntoDraft("hello", "world")).toBe("hello world ");
  });

  it("keeps existing trailing whitespace on the draft and still adds trailing space after transcript text", () => {
    expect(mergeDictationTranscriptIntoDraft("hello ", "world")).toBe("hello world ");
  });

  it("returns the original draft when the transcript is blank", () => {
    expect(mergeDictationTranscriptIntoDraft("hello", "   ")).toBe("hello");
  });
});
