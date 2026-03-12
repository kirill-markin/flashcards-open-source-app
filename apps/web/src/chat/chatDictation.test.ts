import { describe, expect, it } from "vitest";
import { insertDictationTranscriptIntoDraft } from "./chatDictation";

describe("insertDictationTranscriptIntoDraft", () => {
  it("inserts transcript text at the current caret with whitespace on both sides when needed", () => {
    expect(insertDictationTranscriptIntoDraft("helloworld", "wide", { start: 5, end: 5 })).toEqual({
      text: "hello wide world",
      selection: {
        start: "hello wide ".length,
        end: "hello wide ".length,
      },
    });
  });

  it("replaces the selected range instead of appending to the end", () => {
    expect(insertDictationTranscriptIntoDraft("hello brave world", "wide", { start: 6, end: 11 })).toEqual({
      text: "hello wide world",
      selection: {
        start: "hello wide".length,
        end: "hello wide".length,
      },
    });
  });

  it("falls back to appending at the end when selection is missing", () => {
    expect(insertDictationTranscriptIntoDraft("hello", "world", null)).toEqual({
      text: "hello world",
      selection: {
        start: "hello world".length,
        end: "hello world".length,
      },
    });
  });

  it("returns the original draft when the transcript is blank", () => {
    expect(insertDictationTranscriptIntoDraft("hello", "   ", null)).toEqual({
      text: "hello",
      selection: {
        start: "hello".length,
        end: "hello".length,
      },
    });
  });
});
