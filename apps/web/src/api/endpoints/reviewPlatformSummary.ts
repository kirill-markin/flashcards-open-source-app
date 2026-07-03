import { parseReviewPlatformSummaryResponse } from "../../apiContracts/reviewPlatformSummary";
import type { ReviewPlatformSummary } from "../../types";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecoveryWithTransientNetworkRetry, requestJson } from "../transport/transport";

export async function loadReviewPlatformSummary(): Promise<ReviewPlatformSummary> {
  return parseContractResponse(
    await requestJson("/me/review-platform-summary", {
      method: "GET",
    }, allowAuthRecoveryWithTransientNetworkRetry),
    "GET /me/review-platform-summary",
    parseReviewPlatformSummaryResponse,
  );
}
