import { describe, expect, it } from "vitest";
import { getCanShowComposerSuggestions } from "./chatComposerState";

const visibleSuggestionParams = {
  areComposerSuggestionsEnabled: true,
  composerAction: "send",
  composerSuggestionsCount: 1,
  dictationState: "idle",
  inputText: "",
  isAssistantRunActive: false,
  isChatActionLocked: false,
  isHistoryLoaded: true,
  isStopping: false,
  pendingAttachmentCount: 0,
  sendPhase: "idle",
} as const;

describe("getCanShowComposerSuggestions", () => {
  it("hides composer suggestions when the local preference is disabled", () => {
    expect(getCanShowComposerSuggestions({
      ...visibleSuggestionParams,
      areComposerSuggestionsEnabled: false,
    })).toBe(false);
  });

  it("shows composer suggestions when the local preference and composer state allow them", () => {
    expect(getCanShowComposerSuggestions(visibleSuggestionParams)).toBe(true);
  });
});
