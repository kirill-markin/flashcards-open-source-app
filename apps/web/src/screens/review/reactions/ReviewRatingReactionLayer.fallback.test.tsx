// @vitest-environment jsdom
import { act, useEffect, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeReviewReactionRating,
  reviewReactionRatings,
  reviewReactionVariantDistributionEntries,
  reviewReactionVariantTotalWeight,
  reducedReviewReactionMotionMediaQuery,
  type ReviewReactionVariant,
} from "./reviewReaction";
import { ReviewRatingReactionLayer } from "./ReviewRatingReactionLayer";
import {
  loadReviewReactionLottieAsset,
  loadReviewReactionLottieAssets,
  reviewReactionLottieFallbackVariant,
  resetReviewReactionLottieStateForTests,
} from "./reviewReactionLottie";
import {
  useReviewRatingReactions,
  type UseReviewRatingReactionsResult,
} from "./useReviewRatingReactions";

const { loadAnimationMock } = vi.hoisted(() => ({
  loadAnimationMock: vi.fn(),
}));

vi.mock("lottie-web/build/player/lottie_light", () => ({
  default: {
    loadAnimation: loadAnimationMock,
  },
}));

type ReviewReactionLayerHarnessProps = Readonly<{
  onResult: (result: UseReviewRatingReactionsResult) => void;
}>;

type LottieFailureExpectation = Readonly<{
  rating: 0 | 1 | 2 | 3;
  randomValue: number;
  variant: ReviewReactionVariant;
}>;

type RenderHarnessOptions = Readonly<{
  shouldPreloadLottieAssets: boolean;
}>;

type DeferredReviewReactionLottieResponse = Readonly<{
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}>;

const lottieFailureExpectations: ReadonlyArray<LottieFailureExpectation> = reviewReactionRatings.flatMap((
  rating,
  ratingIndex,
) => {
  const totalWeight = reviewReactionVariantTotalWeight(rating);
  let cumulativeWeight = 0;
  return reviewReactionVariantDistributionEntries(rating).map((entry) => {
    const midpointRoll = cumulativeWeight + Math.floor(entry.weight / 2);
    cumulativeWeight += entry.weight;
    return {
      rating: ratingIndex as 0 | 1 | 2 | 3,
      randomValue: (midpointRoll + 0.1) / totalWeight,
      variant: entry.variant,
    };
  });
});

function ReviewReactionLayerHarness(props: ReviewReactionLayerHarnessProps): ReactElement {
  const { onResult } = props;
  const result = useReviewRatingReactions();

  useEffect(() => {
    onResult(result);
  }, [onResult, result]);

  return (
    <ReviewRatingReactionLayer
      events={result.events}
      onReactionEventFallback={result.handleReactionEventFallback}
    />
  );
}

function installReviewReactionMotionPreference(matches: boolean): void {
  const mediaQueryList = {
    matches,
    media: reducedReviewReactionMotionMediaQuery,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } satisfies Partial<MediaQueryList>;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => mediaQueryList as MediaQueryList),
  });
}

async function flushReactionPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeReviewReactionLottieResponse(): Response {
  return new Response(JSON.stringify({
    layers: [],
    v: "test",
  }), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

function makeDeferredReviewReactionLottieResponse(): DeferredReviewReactionLottieResponse {
  let resolveDeferredResponse: ((response: Response) => void) | null = null;
  const promise = new Promise<Response>((resolve) => {
    resolveDeferredResponse = resolve;
  });

  if (resolveDeferredResponse === null) {
    throw new Error("Review reaction Lottie test response resolver was not initialized.");
  }

  return {
    promise,
    resolve: resolveDeferredResponse,
  };
}

function makeLoadedReviewReactionLottieAnimationItem(): object {
  return {
    addEventListener: vi.fn((_eventName: string, _listener: () => void): (() => void) => vi.fn()),
    destroy: vi.fn(),
    goToAndStop: vi.fn(),
    isLoaded: true,
    play: vi.fn(),
    setSpeed: vi.fn(),
    totalFrames: 100,
  };
}

function makeFailingPlaybackReviewReactionLottieAnimationItem(): object {
  const listenersByEventName = new Map<string, Array<() => void>>();
  let isDestroyed = false;
  const emitEvent = (eventName: string): void => {
    for (const listener of listenersByEventName.get(eventName) ?? []) {
      listener();
    }
  };

  return {
    addEventListener: vi.fn((eventName: string, listener: () => void): (() => void) => {
      const listeners = listenersByEventName.get(eventName) ?? [];
      listeners.push(listener);
      listenersByEventName.set(eventName, listeners);
      return () => {
        if (isDestroyed) {
          throw new Error("Lottie listener was removed after destroy.");
        }

        listenersByEventName.set(
          eventName,
          listeners.filter((existingListener) => existingListener !== listener),
        );
      };
    }),
    destroy: vi.fn(() => {
      isDestroyed = true;
    }),
    goToAndStop: vi.fn(() => {
      emitEvent("error");
    }),
    isLoaded: true,
    play: vi.fn(() => {
      emitEvent("error");
    }),
    setSpeed: vi.fn(),
    totalFrames: 100,
  };
}

describe("ReviewRatingReactionLayer Lottie fallback", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let latestResult: UseReviewRatingReactionsResult | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    resetReviewReactionLottieStateForTests();
    loadAnimationMock.mockReset();
    loadAnimationMock.mockImplementation(() => makeLoadedReviewReactionLottieAnimationItem());
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL): Promise<Response> => (
      Promise.resolve(makeReviewReactionLottieResponse())
    )));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000101")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000102")
      .mockReturnValue("00000000-0000-4000-8000-000000000103");
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function renderHarness(options: RenderHarnessOptions): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Review reaction test root is not ready.");
    }

    if (options.shouldPreloadLottieAssets) {
      await loadReviewReactionLottieAssets();
    }

    await act(async () => {
      currentRoot.render(
        <ReviewReactionLayerHarness
          onResult={(result) => {
            latestResult = result;
          }}
        />,
      );
    });
  }

  function requireLatestResult(): UseReviewRatingReactionsResult {
    if (latestResult === null) {
      throw new Error("Review reaction hook result was not rendered.");
    }

    return latestResult;
  }

  function requireReactionEventElement(): HTMLElement {
    const currentContainer = container;
    if (currentContainer === null) {
      throw new Error("Review reaction test container is not ready.");
    }

    const eventElement = currentContainer.querySelector<HTMLElement>("[data-testid='review-rating-reaction-event']");
    if (eventElement === null) {
      throw new Error("Review reaction event was not rendered.");
    }

    return eventElement;
  }

  function queryReactionEventElement(): HTMLElement | null {
    const currentContainer = container;
    if (currentContainer === null) {
      throw new Error("Review reaction test container is not ready.");
    }

    return currentContainer.querySelector<HTMLElement>("[data-testid='review-rating-reaction-event']");
  }

  function queryCrownFallbackArtElement(): SVGSVGElement | null {
    const currentContainer = container;
    if (currentContainer === null) {
      throw new Error("Review reaction test container is not ready.");
    }

    return currentContainer.querySelector<SVGSVGElement>(".review-rating-reaction-crown-fallback-art");
  }

  function requireCrownFallbackArtElement(): SVGSVGElement {
    const fallbackArtElement = queryCrownFallbackArtElement();
    if (fallbackArtElement === null) {
      throw new Error("Review reaction crown fallback art was not rendered.");
    }

    return fallbackArtElement;
  }

  async function emitReactionAfterLottiePlaybackFailure(
    rating: 0 | 1 | 2 | 3,
    randomValue: number,
  ): Promise<void> {
    vi.spyOn(Math, "random").mockReturnValue(randomValue);
    await act(async () => {
      requireLatestResult().emitReaction(rating);
      await flushReactionPromises();
    });
  }

  it("does not show the crown fallback while a cold Lottie asset is still loading", async () => {
    installReviewReactionMotionPreference(false);
    const deferredResponse = makeDeferredReviewReactionLottieResponse();
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL): Promise<Response> => deferredResponse.promise);
    const loadingAssetPromise = loadReviewReactionLottieAsset("easySunrise");

    await renderHarness({ shouldPreloadLottieAssets: false });

    vi.spyOn(Math, "random").mockReturnValue(0);
    await act(async () => {
      requireLatestResult().emitReaction(3);
      await flushReactionPromises();
    });

    expect(requireLatestResult().events).toHaveLength(0);
    expect(queryReactionEventElement()).toBeNull();
    expect(queryCrownFallbackArtElement()).toBeNull();
    expect(loadAnimationMock).not.toHaveBeenCalled();

    deferredResponse.resolve(makeReviewReactionLottieResponse());
    await act(async () => {
      await loadingAssetPromise;
      await flushReactionPromises();
    });
  });

  for (const expectation of lottieFailureExpectations) {
    it(`converts ${expectation.variant} playback error events to the crown fallback duration`, async () => {
      installReviewReactionMotionPreference(false);
      loadAnimationMock.mockImplementation(() => makeFailingPlaybackReviewReactionLottieAnimationItem());
      await renderHarness({ shouldPreloadLottieAssets: true });

      await emitReactionAfterLottiePlaybackFailure(expectation.rating, expectation.randomValue);

      expect(requireLatestResult().events).toEqual([
        {
          id: "00000000-0000-4000-8000-000000000102",
          rating: makeReviewReactionRating(expectation.rating),
          variant: reviewReactionLottieFallbackVariant,
        },
      ]);
      expect(requireReactionEventElement().dataset.reviewReactionVariant).toBe(reviewReactionLottieFallbackVariant);
      expect(requireCrownFallbackArtElement()).toBeInstanceOf(SVGSVGElement);

      await act(async () => {
        vi.advanceTimersByTime(1729);
      });

      expect(requireLatestResult().events).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(requireLatestResult().events).toHaveLength(0);
    });
  }

  it("keeps reduced-motion cleanup at 400ms after Lottie playback error fallback", async () => {
    installReviewReactionMotionPreference(true);
    loadAnimationMock.mockImplementation(() => makeFailingPlaybackReviewReactionLottieAnimationItem());
    await renderHarness({ shouldPreloadLottieAssets: true });

    await emitReactionAfterLottiePlaybackFailure(3, 0.5);

    expect(requireReactionEventElement().dataset.reviewReactionVariant).toBe(reviewReactionLottieFallbackVariant);

    await act(async () => {
      vi.advanceTimersByTime(399);
    });

    expect(requireLatestResult().events).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(requireLatestResult().events).toHaveLength(0);
  });
});
