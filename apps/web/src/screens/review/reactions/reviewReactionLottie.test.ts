import { afterEach, describe, expect, it, vi } from "vitest";
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

const failedVariant: ReviewReactionLottieVariant = "againWormWiggle";
const readyVariant: ReviewReactionLottieVariant = "againTornado";

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

describe("reviewReactionLottie", () => {
  afterEach(() => {
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
    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(readyVariant)).toBe(true);

    const retriedAsset = await reviewReactionLottie.loadReviewReactionLottieAsset(failedVariant);

    expect(failedVariantFetchCount).toBe(2);
    expect(retriedAsset.animationData).toEqual(retriedAnimationData);
    expect(reviewReactionLottie.isReviewReactionLottieAssetReady(failedVariant)).toBe(true);
  });
});
