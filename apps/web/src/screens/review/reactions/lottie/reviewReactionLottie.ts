import type { ReviewReactionFallbackVariant } from "../reviewReaction";
import type { ReviewReactionLottieVariant } from "./reviewReactionLottieCatalog";
import {
  ReviewReactionLottieRuntime,
  type ReviewReactionLottieAsset,
  type ReviewReactionLottieMountedRender,
  type ReviewReactionLottiePreloadResult,
} from "./reviewReactionLottieRuntime";

export {
  isReviewReactionLottieVariant,
  reviewReactionLottieVariants,
} from "./reviewReactionLottieCatalog";
export type { ReviewReactionLottieVariant } from "./reviewReactionLottieCatalog";
export type {
  ReviewReactionLottieAsset,
  ReviewReactionLottieAssetFailure,
  ReviewReactionLottieMountedRender,
  ReviewReactionLottiePreloadResult,
} from "./reviewReactionLottieRuntime";

const reviewReactionLottieRuntime = new ReviewReactionLottieRuntime();

export const reviewReactionLottieFallbackVariant: ReviewReactionFallbackVariant = "fallbackCrownBounce";

export function isReviewReactionLottieAssetReady(variant: ReviewReactionLottieVariant): boolean {
  return reviewReactionLottieRuntime.isAssetReady(variant);
}

export function reviewReactionLottieAssetFailure(variant: ReviewReactionLottieVariant): unknown | null {
  return reviewReactionLottieRuntime.assetFailure(variant);
}

export function resetReviewReactionLottieStateForTests(): void {
  reviewReactionLottieRuntime.resetStateForTests();
}

export async function loadReviewReactionLottieAsset(
  variant: ReviewReactionLottieVariant,
): Promise<ReviewReactionLottieAsset> {
  return reviewReactionLottieRuntime.loadAsset(variant);
}

export async function prewarmReviewReactionLottieAssets(): Promise<ReviewReactionLottiePreloadResult> {
  return reviewReactionLottieRuntime.prewarmAssets();
}

export async function loadReviewReactionLottieAssets(): Promise<ReviewReactionLottiePreloadResult> {
  return reviewReactionLottieRuntime.prewarmAssets();
}

export function startReviewReactionLottiePrewarm(recoverySignal: AbortSignal): () => void {
  return reviewReactionLottieRuntime.startPrewarm(recoverySignal);
}

export function reserveReviewReactionLottieRender(
  eventId: string,
  variant: ReviewReactionLottieVariant,
): boolean {
  return reviewReactionLottieRuntime.reserveRender(eventId, variant);
}

export function mountReservedReviewReactionLottieRender(
  eventId: string,
  variant: ReviewReactionLottieVariant,
  container: HTMLDivElement,
): ReviewReactionLottieMountedRender {
  return reviewReactionLottieRuntime.mountReservedRender(eventId, variant, container);
}

export function unmountReservedReviewReactionLottieRender(eventId: string): void {
  reviewReactionLottieRuntime.unmountReservedRender(eventId);
}

export function releaseReviewReactionLottieRender(eventId: string): void {
  reviewReactionLottieRuntime.releaseRender(eventId);
}
