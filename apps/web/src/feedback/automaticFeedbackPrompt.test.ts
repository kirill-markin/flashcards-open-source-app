import { describe, expect, it } from "vitest";
import { emptyFeedbackPromptState } from "../localDb/feedback";
import {
  shouldRequestAutomaticFeedbackState,
} from "./automaticFeedbackPrompt";

const nowMillis = new Date("2026-04-18T09:00:00.000Z").getTime();

describe("automatic feedback prompt eligibility", () => {
  it("does not request backend state before 15 reviews today", () => {
    expect(shouldRequestAutomaticFeedbackState({
      reviewActivity: {
        todayReviewCount: 14,
        hasPreviousReviewDay: true,
      },
      promptState: emptyFeedbackPromptState,
      nowMillis,
    })).toBe(false);
  });

  it("does not request backend state without a previous review day", () => {
    expect(shouldRequestAutomaticFeedbackState({
      reviewActivity: {
        todayReviewCount: 15,
        hasPreviousReviewDay: false,
      },
      promptState: emptyFeedbackPromptState,
      nowMillis,
    })).toBe(false);
  });
});
