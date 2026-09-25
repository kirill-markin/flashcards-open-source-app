import { parseAiUsageStatusResponse } from "../../apiContracts/aiUsage";
import type { AiUsageStatus } from "../../types";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecoveryWithTransientNetworkRetry, requestJson } from "../transport/transport";

export async function loadAiUsage(): Promise<AiUsageStatus> {
  return parseContractResponse(
    await requestJson("/me/ai-usage", {
      method: "GET",
    }, allowAuthRecoveryWithTransientNetworkRetry),
    "GET /me/ai-usage",
    parseAiUsageStatusResponse,
  );
}
