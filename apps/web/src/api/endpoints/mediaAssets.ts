import { parseMediaAssetDownloadUrlResponse } from "../../apiContracts/mediaAssets";
import type { MediaAssetDownloadUrlResult } from "../../types";
import { parseContractResponse } from "../transport/response";
import {
  allowAuthRecoveryWithTransientNetworkRetry,
  requestJson,
} from "../transport/transport";

export async function loadMediaAssetDownloadUrl(
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAssetDownloadUrlResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/media-assets/${mediaAssetId}/download-url`, {
    method: "GET",
  }, allowAuthRecoveryWithTransientNetworkRetry), `GET /workspaces/${workspaceId}/media-assets/${mediaAssetId}/download-url`, parseMediaAssetDownloadUrlResponse);
}
