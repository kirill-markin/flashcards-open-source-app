// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWebSyncCache } from "../core/cache";
import {
  clearMobileAppPromotionPromptShownIfCurrent,
  emptyMobileAppPromotionState,
  loadMobileAppPromotionState,
  putMobileAppPromotionState,
  storeKnownMobileReviewEvent,
  storeMobileAppPromotionPromptShown,
} from "./mobileAppPromotion";

describe("local mobile app promotion state", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("keeps prompt state scoped by identity key", async () => {
    await putMobileAppPromotionState("user:user-1", {
      ...emptyMobileAppPromotionState,
      lastPromptShownLocalDate: "2026-03-10",
      lastPromptShownAt: "2026-03-10T12:00:00.000Z",
    });

    await storeKnownMobileReviewEvent({
      identityKey: "user:user-2",
    });

    await expect(loadMobileAppPromotionState("user:user-1")).resolves.toEqual({
      ...emptyMobileAppPromotionState,
      lastPromptShownLocalDate: "2026-03-10",
      lastPromptShownAt: "2026-03-10T12:00:00.000Z",
    });
    await expect(loadMobileAppPromotionState("user:user-2")).resolves.toEqual({
      ...emptyMobileAppPromotionState,
      knownHasMobileReviewEvent: true,
    });
    await expect(loadMobileAppPromotionState("installation:installation-1")).resolves.toEqual(
      emptyMobileAppPromotionState,
    );
  });

  it("stores the local date before returning the shown prompt state", async () => {
    await expect(storeMobileAppPromotionPromptShown({
      identityKey: "user:user-1",
      localDate: "2026-03-11",
      shownAt: "2026-03-11T08:00:00.000Z",
    })).resolves.toEqual({
      ...emptyMobileAppPromotionState,
      lastPromptShownLocalDate: "2026-03-11",
      lastPromptShownAt: "2026-03-11T08:00:00.000Z",
    });

    await expect(loadMobileAppPromotionState("user:user-1")).resolves.toEqual({
      ...emptyMobileAppPromotionState,
      lastPromptShownLocalDate: "2026-03-11",
      lastPromptShownAt: "2026-03-11T08:00:00.000Z",
    });
  });

  it("clears the prompt shown marker only when it still matches the current write", async () => {
    await putMobileAppPromotionState("user:user-1", {
      lastPromptShownLocalDate: "2026-03-11",
      lastPromptShownAt: "2026-03-11T08:00:00.000Z",
      knownHasMobileReviewEvent: true,
    });

    await expect(clearMobileAppPromotionPromptShownIfCurrent({
      identityKey: "user:user-1",
      localDate: "2026-03-11",
      shownAt: "2026-03-11T08:00:00.000Z",
    })).resolves.toEqual({
      lastPromptShownLocalDate: null,
      lastPromptShownAt: null,
      knownHasMobileReviewEvent: true,
    });
  });

  it("does not clear a newer prompt shown marker", async () => {
    await putMobileAppPromotionState("user:user-1", {
      ...emptyMobileAppPromotionState,
      lastPromptShownLocalDate: "2026-03-12",
      lastPromptShownAt: "2026-03-12T08:00:00.000Z",
    });

    await expect(clearMobileAppPromotionPromptShownIfCurrent({
      identityKey: "user:user-1",
      localDate: "2026-03-11",
      shownAt: "2026-03-11T08:00:00.000Z",
    })).resolves.toEqual({
      ...emptyMobileAppPromotionState,
      lastPromptShownLocalDate: "2026-03-12",
      lastPromptShownAt: "2026-03-12T08:00:00.000Z",
    });
  });
});
