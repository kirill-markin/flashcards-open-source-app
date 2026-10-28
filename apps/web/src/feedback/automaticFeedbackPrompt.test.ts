import { describe, expect, it } from "vitest";
import { emptyFeedbackPromptState } from "../localDb/feedback/feedback";
import {
  shouldRequestAutomaticFeedbackState,
} from "./automaticFeedbackPrompt";

const nowMillis = new Date("2026-04-18T09:00:00.000Z").getTime();
const settings = { enabled: true, minReviewsToday: 5, minReviewDays: 3, cooldownDays: 30 };

describe("automatic feedback prompt eligibility", () => {
  it("does not request backend state while the last automatic showing is within the cooldown", () => {
    expect(shouldRequestAutomaticFeedbackState({
      settings,
      promptState: {
        ...emptyFeedbackPromptState,
        lastAutomaticFeedbackPromptShownAt: "2026-04-08T09:00:00.000Z",
      },
      nowMillis,
    })).toBe(false);
  });

  it("requests backend state when the prompt is due and the local copy was never fetched", () => {
    expect(shouldRequestAutomaticFeedbackState({
      settings,
      promptState: {
        ...emptyFeedbackPromptState,
        lastFeedbackSubmittedAt: "2026-04-17T09:00:00.000Z",
      },
      nowMillis,
    })).toBe(true);
  });
});
