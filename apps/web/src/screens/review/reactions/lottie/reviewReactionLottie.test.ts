// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewReactionLottieVariant } from "./reviewReactionLottie";

const { lottiePlayerMock } = vi.hoisted(() => ({
  lottiePlayerMock: {
    loadAnimation: vi.fn(),
  },
}));

vi.mock("lottie-web/build/player/lottie_light", () => ({
  default: lottiePlayerMock,
}));

type ReviewReactionLottieModule = typeof import("./reviewReactionLottie");
type DeferredReviewReactionLottieSignal = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}>;

const failedVariant: ReviewReactionLottieVariant = "againWormWiggle";
const readyVariant: ReviewReactionLottieVariant = "againTornado";
const domLoadedVariant: ReviewReactionLottieVariant = "easySunrise";

async function importReviewReactionLottieModule(): Promise<ReviewReactionLottieModule> {
  return import("./reviewReactionLottie");
}

function makeReviewReactionLottieResponse(animationData: object): Response {
  return new Response(JSON.stringify(animationData), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

function makeDeferredReviewReactionLottieSignal(): DeferredReviewReactionLottieSignal {
  let resolveSignal: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });

  if (resolveSignal === null) {
    throw new Error("Review reaction Lottie test signal resolver was not initialized.");
  }

  return {
    promise,
    resolve: resolveSignal,
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

describe("reviewReactionLottie", () => {
  beforeEach(() => {
    lottiePlayerMock.loadAnimation.mockReset();
    lottiePlayerMock.loadAnimation.mockImplementation(() => makeLoadedReviewReactionLottieAnimationItem());
  });

  afterEach(async () => {
    const reviewReactionLottie = await importReviewReactionLottieModule();
    reviewReactionLottie.resetReviewReactionLottieStateForTests();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("isolates preload failures to the broken animation variant", async () => {
    const failedFetchError = new Error("Review reaction worm animation failed to fetch.");
    const retriedAnimationData = {
      layers: [],
      v: "retry",
    };
    let failedVariantFetchCount = 0;

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes("review_again_worm")) {
        failedVariantFetchCount += 1;
        if (failedVariantFetchCount === 1) {
          return Promise.reject(failedFetchError);
        }

        return Promise.resolve(makeReviewReactionLottieResponse(retriedAnimationData));
      }

      return Promise.resolve(makeReviewReactionLottieResponse({
        layers: [],
        v: url,
      }));
    }));

    const reviewReactionLottie = await importReviewReactionLottieModule();

    const preloadResult = await reviewReactionLottie.loadReviewReactionLottieAssets();

    expect(preloadResult.failures).toHaveLength(1);
    expect(preloadResult.failures[0]?.variant).toBe(failedVariant);
    expect(preloadResult.failures[0]?.error).toBeInstanceOf(Error);
    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(failedVariant)).toBe(false);
    expect(reviewReactionLottie.reviewReactionLottieAssetFailure(failedVariant)).toBeInstanceOf(Error);
    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(readyVariant)).toBe(true);

    const retriedAsset = await reviewReactionLottie.loadReviewReactionLottieAsset(failedVariant);

    expect(failedVariantFetchCount).toBe(2);
    expect(retriedAsset.animationData).toEqual(retriedAnimationData);
    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(failedVariant)).toBe(true);
    expect(reviewReactionLottie.reviewReactionLottieAssetFailure(failedVariant)).toBeNull();
  });

  it("reuses in-flight prewarm work for repeated prewarm calls", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<Response> => (
      Promise.resolve(makeReviewReactionLottieResponse({
        layers: [],
        v: input.toString(),
      }))
    )));

    const reviewReactionLottie = await importReviewReactionLottieModule();
    const [firstPreloadResult, secondPreloadResult] = await Promise.all([
      reviewReactionLottie.prewarmReviewReactionLottieAssets(),
      reviewReactionLottie.prewarmReviewReactionLottieAssets(),
    ]);

    expect(firstPreloadResult.failures).toHaveLength(0);
    expect(secondPreloadResult.failures).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(reviewReactionLottie.reviewReactionLottieVariants.length);
    expect(lottiePlayerMock.loadAnimation).toHaveBeenCalledTimes(
      reviewReactionLottie.reviewReactionLottieVariants.length,
    );
  });

  it("marks a variant ready only after the offscreen Lottie render is prepared", async () => {
    const domLoadedListenerRegistered = makeDeferredReviewReactionLottieSignal();
    let emitDomLoaded: (() => void) | null = null;
    lottiePlayerMock.loadAnimation.mockImplementation(() => ({
      addEventListener: vi.fn((eventName: string, listener: () => void): (() => void) => {
        if (eventName === "DOMLoaded") {
          emitDomLoaded = listener;
          domLoadedListenerRegistered.resolve();
        }

        return () => {
          if (eventName === "DOMLoaded") {
            emitDomLoaded = null;
          }
        };
      }),
      destroy: vi.fn(),
      goToAndStop: vi.fn(),
      isLoaded: false,
      play: vi.fn(),
      setSpeed: vi.fn(),
      totalFrames: 100,
    }));
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL): Promise<Response> => (
      Promise.resolve(makeReviewReactionLottieResponse({
        layers: [],
        v: "dom-loaded",
      }))
    )));

    const reviewReactionLottie = await importReviewReactionLottieModule();
    const assetPromise = reviewReactionLottie.loadReviewReactionLottieAsset(domLoadedVariant);
    await domLoadedListenerRegistered.promise;

    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(domLoadedVariant)).toBe(false);

    const currentEmitDomLoaded = emitDomLoaded;
    if (currentEmitDomLoaded === null) {
      throw new Error("Review reaction Lottie DOMLoaded listener was not registered.");
    }

    currentEmitDomLoaded();
    await assetPromise;

    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(domLoadedVariant)).toBe(true);
  });

  it("marks a variant failed when the offscreen Lottie render emits data_failed", async () => {
    const dataFailedListenerRegistered = makeDeferredReviewReactionLottieSignal();
    let emitDataFailed: (() => void) | null = null;
    lottiePlayerMock.loadAnimation.mockImplementation(() => ({
      addEventListener: vi.fn((eventName: string, listener: () => void): (() => void) => {
        if (eventName === "data_failed") {
          emitDataFailed = listener;
          dataFailedListenerRegistered.resolve();
        }

        return () => {
          if (eventName === "data_failed") {
            emitDataFailed = null;
          }
        };
      }),
      destroy: vi.fn(),
      goToAndStop: vi.fn(),
      isLoaded: false,
      play: vi.fn(),
      setSpeed: vi.fn(),
      totalFrames: 100,
    }));
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL): Promise<Response> => (
      Promise.resolve(makeReviewReactionLottieResponse({
        layers: [],
        v: "data-failed",
      }))
    )));

    const reviewReactionLottie = await importReviewReactionLottieModule();
    const assetPromise = reviewReactionLottie.loadReviewReactionLottieAsset(domLoadedVariant);
    await dataFailedListenerRegistered.promise;

    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(domLoadedVariant)).toBe(false);

    const currentEmitDataFailed = emitDataFailed;
    if (currentEmitDataFailed === null) {
      throw new Error("Review reaction Lottie data_failed listener was not registered.");
    }

    currentEmitDataFailed();

    await expect(assetPromise).rejects.toThrow("Failed to prepare review reaction Lottie render instance");
    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(domLoadedVariant)).toBe(false);
    expect(reviewReactionLottie.reviewReactionLottieAssetFailure(domLoadedVariant)).toBeInstanceOf(Error);
  });
});
