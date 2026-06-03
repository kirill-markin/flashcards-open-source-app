// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWebSyncCache } from "./cache";
import {
  emptyFeedbackPromptState,
  loadFeedbackPromptState,
  putFeedbackPromptState,
  storeFeedbackSubmittedAt,
} from "./feedback";

describe("local feedback prompt state", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("keeps prompt state scoped by identity key", async () => {
    await putFeedbackPromptState("user:user-1", {
      ...emptyFeedbackPromptState,
      lastAutomaticFeedbackPromptShownAt: "2026-04-18T09:00:00.000Z",
      nextAutomaticFeedbackPromptAt: "2026-05-18T09:00:00.000Z",
    });

    await storeFeedbackSubmittedAt({
      identityKey: "user:user-2",
      feedbackState: {
        automaticPromptCooldownDays: 30,
        lastAutomaticPromptShownAt: null,
        lastFeedbackSubmittedAt: "2026-04-20T09:00:00.000Z",
        nextAutomaticPromptAt: "2026-05-20T09:00:00.000Z",
      },
      submittedAt: "2026-04-20T09:00:00.000Z",
    });

    await expect(loadFeedbackPromptState("user:user-1")).resolves.toEqual({
      ...emptyFeedbackPromptState,
      lastAutomaticFeedbackPromptShownAt: "2026-04-18T09:00:00.000Z",
      nextAutomaticFeedbackPromptAt: "2026-05-18T09:00:00.000Z",
    });
    await expect(loadFeedbackPromptState("user:user-2")).resolves.toEqual({
      ...emptyFeedbackPromptState,
      lastFeedbackSubmittedAt: "2026-04-20T09:00:00.000Z",
      nextAutomaticFeedbackPromptAt: "2026-05-20T09:00:00.000Z",
      lastFeedbackStateFetchedAt: "2026-04-20T09:00:00.000Z",
    });
    await expect(loadFeedbackPromptState("installation:installation-1")).resolves.toEqual(emptyFeedbackPromptState);
  });
});
