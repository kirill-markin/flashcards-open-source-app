import {
  parseMediaAssetDownloadUrlResponse,
  parseMediaAssetUploadSessionAbortResponse,
  parseMediaAssetUploadSessionCompleteResponse,
  parseMediaAssetUploadSessionCreateResponse,
  parseMediaAssetUploadSessionPartUrlsResponse,
} from "../../apiContracts/mediaAssets";
import type {
  CompleteMediaAssetUploadSessionInput,
  MediaAssetDownloadUrlResult,
  MediaAssetUploadSessionAbortResult,
  MediaAssetUploadSessionCompleteResult,
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionCreateResult,
  MediaAssetUploadSessionPartUrlsInput,
  MediaAssetUploadSessionPartUrlsResult,
} from "../../types";
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

export async function createMediaAssetUploadSession(
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaAssetUploadSessionCreateResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/media-assets/upload-sessions`, {
    method: "POST",
    body: JSON.stringify(input),
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/media-assets/upload-sessions`, parseMediaAssetUploadSessionCreateResponse);
}

export async function createMediaAssetUploadPartUrls(
  workspaceId: string,
  sessionId: string,
  input: MediaAssetUploadSessionPartUrlsInput,
): Promise<MediaAssetUploadSessionPartUrlsResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/media-assets/upload-sessions/${sessionId}/parts`, {
    method: "POST",
    body: JSON.stringify(input),
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/media-assets/upload-sessions/${sessionId}/parts`, parseMediaAssetUploadSessionPartUrlsResponse);
}

export async function completeMediaAssetUploadSession(
  workspaceId: string,
  sessionId: string,
  input: CompleteMediaAssetUploadSessionInput,
): Promise<MediaAssetUploadSessionCompleteResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/media-assets/upload-sessions/${sessionId}/complete`, {
    method: "POST",
    body: JSON.stringify(input),
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/media-assets/upload-sessions/${sessionId}/complete`, parseMediaAssetUploadSessionCompleteResponse);
}

export async function abortMediaAssetUploadSession(
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSessionAbortResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/media-assets/upload-sessions/${sessionId}/abort`, {
    method: "POST",
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/media-assets/upload-sessions/${sessionId}/abort`, parseMediaAssetUploadSessionAbortResponse);
}
