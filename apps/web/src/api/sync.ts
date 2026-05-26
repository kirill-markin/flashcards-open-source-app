import {
  parseSyncBootstrapPullResultResponse,
  parseSyncBootstrapPushResultResponse,
  parseSyncPullResultResponse,
  parseSyncPushResultResponse,
  parseSyncReviewHistoryImportResultResponse,
  parseSyncReviewHistoryPullResultResponse,
} from "../apiContracts/sync";
import type {
  ReviewEvent,
  SyncBootstrapEntry,
  SyncBootstrapPullResult,
  SyncBootstrapPushResult,
  SyncPullResult,
  SyncPushOperation,
  SyncPushResult,
  SyncReviewHistoryImportResult,
  SyncReviewHistoryPullResult,
} from "../types";
import { parseContractResponse } from "./response";
import {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  requestJson,
} from "./transport";

export async function pushSyncOperations(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  operations: ReadonlyArray<SyncPushOperation>,
): Promise<SyncPushResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/push`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      operations,
    }),
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/sync/push`, parseSyncPushResultResponse);
}

export async function pullSyncChanges(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  afterHotChangeId: number,
  limit: number,
): Promise<SyncPullResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      afterHotChangeId,
      limit,
    }),
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/sync/pull`, parseSyncPullResultResponse);
}

export async function bootstrapPullSyncState(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  cursor: string | null,
  limit: number,
): Promise<SyncBootstrapPullResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/bootstrap`, {
    method: "POST",
    body: JSON.stringify({
      mode: "pull",
      installationId,
      platform,
      appVersion,
      cursor,
      limit,
    }),
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/sync/bootstrap`, parseSyncBootstrapPullResultResponse);
}

export async function bootstrapPushSyncState(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  entries: ReadonlyArray<SyncBootstrapEntry>,
): Promise<SyncBootstrapPushResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/bootstrap`, {
    method: "POST",
    body: JSON.stringify({
      mode: "push",
      installationId,
      platform,
      appVersion,
      entries,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/bootstrap`, parseSyncBootstrapPushResultResponse);
}

export async function pullReviewHistorySync(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  afterReviewSequenceId: number,
  limit: number,
): Promise<SyncReviewHistoryPullResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/review-history/pull`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      afterReviewSequenceId,
      limit,
    }),
  }, allowAuthRecoveryWithTransientNetworkRetry), `POST /workspaces/${workspaceId}/sync/review-history/pull`, parseSyncReviewHistoryPullResultResponse);
}

export async function importReviewHistorySync(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  reviewEvents: ReadonlyArray<ReviewEvent>,
): Promise<SyncReviewHistoryImportResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/review-history/import`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      reviewEvents,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/review-history/import`, parseSyncReviewHistoryImportResultResponse);
}
