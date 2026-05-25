// @vitest-environment jsdom
import { act, useEffect, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeReviewReactionRating,
  reducedReviewReactionMotionMediaQuery,
  type ReviewReactionVariant,
} from "./reviewReaction";
import { ReviewRatingReactionLayer } from "./ReviewRatingReactionLayer";
import {
  loadReviewReactionLottieAssets,
  reviewReactionLottieFallbackVariant,
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

const lottieFailureExpectations: ReadonlyArray<LottieFailureExpectation> = [
  {
    rating: 0,
    randomValue: 0,
    variant: "againWormWiggle",
  },
  {
    rating: 0,
    randomValue: 0.5,
    variant: "againTornado",
  },
  {
    rating: 0,
    randomValue: 0.75,
    variant: "againSnailCrawl",
  },
  {
    rating: 0,
    randomValue: 0.95,
    variant: "againWiltedFlower",
  },
  {
    rating: 2,
    randomValue: 0,
    variant: "goodOwl",
  },
  {
    rating: 2,
    randomValue: 0.5,
    variant: "goodPoodle",
  },
  {
    rating: 2,
    randomValue: 0.75,
    variant: "goodWhale",
  },
  {
    rating: 2,
    randomValue: 0.95,
    variant: "goodPeacock",
  },
  {
    rating: 3,
    randomValue: 0,
    variant: "easyRoseBloom",
  },
  {
    rating: 3,
    randomValue: 0.5,
    variant: "easyRainbowStreak",
  },
  {
    rating: 3,
    randomValue: 0.75,
    variant: "easyPhoenixRise",
  },
  {
    rating: 3,
    randomValue: 0.95,
    variant: "easyUnicornFlyby",
  },
];

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

describe("ReviewRatingReactionLayer Lottie fallback", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let latestResult: UseReviewRatingReactionsResult | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    loadAnimationMock.mockReset();
    loadAnimationMock.mockImplementation(() => {
      throw new Error("Lottie render failed.");
    });
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL): Promise<Response> => (
      Promise.resolve(makeReviewReactionLottieResponse())
    )));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000101");
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

  async function renderHarness(): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Review reaction test root is not ready.");
    }

    await loadReviewReactionLottieAssets();

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

  async function emitReactionAfterLottieRenderFailure(
    rating: 0 | 1 | 2 | 3,
    randomValue: number,
  ): Promise<void> {
    vi.spyOn(Math, "random").mockReturnValue(randomValue);
    await act(async () => {
      requireLatestResult().emitReaction(rating);
      await flushReactionPromises();
    });
  }

  for (const expectation of lottieFailureExpectations) {
    it(`converts ${expectation.variant} render failures to the crown fallback duration`, async () => {
      installReviewReactionMotionPreference(false);
      await renderHarness();

      await emitReactionAfterLottieRenderFailure(expectation.rating, expectation.randomValue);

      expect(loadAnimationMock).toHaveBeenCalledTimes(1);
      expect(requireLatestResult().events).toEqual([
        {
          id: "00000000-0000-4000-8000-000000000101",
          rating: makeReviewReactionRating(expectation.rating),
          variant: reviewReactionLottieFallbackVariant,
        },
      ]);
      expect(requireReactionEventElement().dataset.reviewReactionVariant).toBe(reviewReactionLottieFallbackVariant);

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

  it("keeps reduced-motion cleanup at 400ms after Lottie render fallback", async () => {
    installReviewReactionMotionPreference(true);
    await renderHarness();

    await emitReactionAfterLottieRenderFailure(3, 0.5);

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
