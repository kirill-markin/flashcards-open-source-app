// @vitest-environment jsdom
import { act, useEffect, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  readyLottieVariants,
  releaseReviewReactionLottieRenderMock,
  reserveReviewReactionLottieRenderMock,
} = vi.hoisted(() => ({
  readyLottieVariants: new Set<string>(),
  releaseReviewReactionLottieRenderMock: vi.fn(),
  reserveReviewReactionLottieRenderMock: vi.fn(),
}));

vi.mock("./reviewReactionLottie", () => ({
  isReviewReactionLottieAssetReady: (variant: string): boolean => readyLottieVariants.has(variant),
  isReviewReactionLottieVariant: (variant: string): boolean => variant !== "fallbackCrownBounce",
  releaseReviewReactionLottieRender: releaseReviewReactionLottieRenderMock,
  reserveReviewReactionLottieRender: reserveReviewReactionLottieRenderMock,
  reviewReactionLottieFallbackVariant: "fallbackCrownBounce",
}));

import {
  useReviewRatingReactions,
  type UseReviewRatingReactionsResult,
} from "./useReviewRatingReactions";

type ReviewRatingReactionHarnessProps = Readonly<{
  onResult: (result: UseReviewRatingReactionsResult) => void;
  reviewReactionAnimationsEnabled: boolean;
}>;

function ReviewRatingReactionHarness(props: ReviewRatingReactionHarnessProps): ReactElement {
  const { onResult, reviewReactionAnimationsEnabled } = props;
  const result = useReviewRatingReactions({
    reviewReactionAnimationsEnabled,
  });

  useEffect(() => {
    onResult(result);
  }, [onResult, result]);

  return (
    <div>
      {result.events.map((event) => (
        <span
          key={event.id}
          data-testid="review-reaction-event"
          data-event-id={event.id}
          data-event-variant={event.variant}
        />
      ))}
    </div>
  );
}

describe("useReviewRatingReactions", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let latestResult: UseReviewRatingReactionsResult | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    readyLottieVariants.clear();
    for (const variant of [
      "goodOtter",
      "goodOwl",
      "goodRabbit",
      "goodSeal",
      "goodServiceDog",
      "goodPoodle",
      "goodChimpanzee",
      "goodWhale",
      "goodPeacock",
      "goodPig",
    ]) {
      readyLottieVariants.add(variant);
    }
    releaseReviewReactionLottieRenderMock.mockReset();
    reserveReviewReactionLottieRenderMock.mockReset();
    reserveReviewReactionLottieRenderMock.mockImplementation((_eventId: string, variant: string): boolean => (
      readyLottieVariants.has(variant)
    ));
    vi.spyOn(Math, "random").mockReturnValue(0.72);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000004");
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    latestResult = null;
  });

  afterEach(() => {
    const currentRoot = root;
    if (currentRoot !== null) {
      act(() => currentRoot.unmount());
    }

    container?.remove();
    container = null;
    root = null;
    latestResult = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function renderHarness(reviewReactionAnimationsEnabled: boolean): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Review reaction test root is not ready");
    }

    return act(async () => {
      currentRoot.render(
        <ReviewRatingReactionHarness
          onResult={(result) => {
            latestResult = result;
          }}
          reviewReactionAnimationsEnabled={reviewReactionAnimationsEnabled}
        />,
      );
    });
  }

  function requireLatestResult(): UseReviewRatingReactionsResult {
    if (latestResult === null) {
      throw new Error("Review reaction hook result was not rendered");
    }

    return latestResult;
  }

  it("cleans up retained reactions after batched emissions trim older events", async () => {
    await renderHarness(true);
    const { emitReaction } = requireLatestResult();

    await act(async () => {
      emitReaction(2);
      emitReaction(2);
      emitReaction(2);
      emitReaction(2);
    });

    expect(requireLatestResult().events.map((event) => event.id)).toEqual([
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ]);

    await act(async () => {
      vi.advanceTimersByTime(2879);
    });

    expect(requireLatestResult().events).toHaveLength(3);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(requireLatestResult().events).toHaveLength(0);
  });

  it("dismisses active reactions immediately and clears scheduled cleanup", async () => {
    await renderHarness(true);

    await act(async () => {
      requireLatestResult().emitReaction(2);
    });

    const [activeEvent] = requireLatestResult().events;
    if (activeEvent === undefined) {
      throw new Error("Review reaction event was not emitted");
    }

    await act(async () => {
      requireLatestResult().dismissReactions();
    });

    expect(requireLatestResult().events).toHaveLength(0);
    expect(releaseReviewReactionLottieRenderMock).toHaveBeenCalledTimes(1);
    expect(releaseReviewReactionLottieRenderMock).toHaveBeenCalledWith(activeEvent.id);

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(requireLatestResult().events).toHaveLength(0);
    expect(releaseReviewReactionLottieRenderMock).toHaveBeenCalledTimes(1);
  });

  it("uses a ready same-rating variant when the selected variant is not prewarmed", async () => {
    readyLottieVariants.clear();
    readyLottieVariants.add("goodRabbit");
    vi.mocked(Math.random)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);
    await renderHarness(true);

    await act(async () => {
      requireLatestResult().emitReaction(2);
    });

    expect(requireLatestResult().events).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        rating: "good",
        variant: "goodRabbit",
      },
    ]);
    expect(reserveReviewReactionLottieRenderMock).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "goodRabbit",
    );
  });

  it("does not emit a decorative event when the rating group has no ready variants", async () => {
    readyLottieVariants.clear();
    await renderHarness(true);

    await act(async () => {
      requireLatestResult().emitReaction(2);
    });

    expect(requireLatestResult().events).toHaveLength(0);
    expect(reserveReviewReactionLottieRenderMock).not.toHaveBeenCalled();
  });

  it("does not create reaction events when review animations are disabled", async () => {
    await renderHarness(false);

    await act(async () => {
      requireLatestResult().emitReaction(2);
    });

    expect(requireLatestResult().events).toHaveLength(0);
    expect(reserveReviewReactionLottieRenderMock).not.toHaveBeenCalled();
  });
});
