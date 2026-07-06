import { extractManagedMediaAssetIdsFromMarkdown } from "../../media/managedMediaMarkdown";
import type { MediaBlobCacheRecord, MediaTransferQueueRecord } from "../mediaTransfers";
import type { PersistedOutboxRecord } from "../sync/outbox";
import {
  closeDatabaseAfter,
  getAllFromStore,
  getFromStore,
  type CloudSettingsRecord,
  type StoredCard,
  type StoredMediaAsset,
  type WorkspaceSyncStateRecord,
} from "../core/database";

const problemRecordLimit = 5;

export type FailedCardOutboxDiagnosticRecord = Readonly<{
  operationId: string;
  cardId: string;
  attemptCount: number;
  createdAt: string;
  lastError: string;
}>;

export type FailedMediaTransferDiagnosticRecord = Readonly<{
  transferId: string;
  mediaAssetId: string;
  kind: MediaTransferQueueRecord["kind"];
  attemptCount: number;
  updatedAt: string;
  lastError: string;
}>;

export type MissingMediaReferenceDiagnosticRecord = Readonly<{
  mediaAssetId: string;
}>;

export type AssetMissingBlobDiagnosticRecord = Readonly<{
  mediaAssetId: string;
  sha256: string;
}>;

export type CardsSyncDiagnostics = Readonly<{
  workspaceId: string;
  installationId: string | null;
  cloudState: string | null;
  localActiveCards: number;
  localDeletedCards: number;
  pendingCardOperations: number;
  failedCardOperations: number;
  oldestPendingCardOperation: string | null;
  latestCardSyncSuccess: string | null;
  hotStateHydrated: boolean | null;
  hotCursor: number | null;
  reviewCursor: number | null;
  latestSyncError: string | null;
}>;

export type ManagedMediaSyncDiagnostics = Readonly<{
  localActiveMediaAssets: number;
  deletedMediaAssets: number;
  localMediaBlobs: number;
  localMediaBytes: number;
  referencedMediaInCards: number;
  referencesMissingLocalAsset: number;
  assetsMissingLocalBlob: number;
  pendingMediaUploads: number;
  failedMediaUploads: number;
  pendingMediaDownloads: number;
  failedMediaDownloads: number;
  oldestPendingMediaTransfer: string | null;
  latestMediaUploadSuccess: string | null;
  latestMediaDownloadCacheSuccess: string | null;
  latestMediaTransferError: string | null;
}>;

export type LocalSyncDiagnosticsProblemRecords = Readonly<{
  failedCardOutboxOperations: ReadonlyArray<FailedCardOutboxDiagnosticRecord>;
  failedMediaTransfers: ReadonlyArray<FailedMediaTransferDiagnosticRecord>;
  missingMediaReferences: ReadonlyArray<MissingMediaReferenceDiagnosticRecord>;
  assetsMissingLocalBlob: ReadonlyArray<AssetMissingBlobDiagnosticRecord>;
}>;

export type LocalSyncDiagnosticsReport = Readonly<{
  generatedAt: string;
  cardsSync: CardsSyncDiagnostics;
  managedMediaSync: ManagedMediaSyncDiagnostics;
  problemRecords: LocalSyncDiagnosticsProblemRecords;
}>;

type LocalSyncDiagnosticsStoreSnapshot = Readonly<{
  cards: ReadonlyArray<StoredCard>;
  outboxRecords: ReadonlyArray<PersistedOutboxRecord>;
  syncState: WorkspaceSyncStateRecord | null;
  mediaAssets: ReadonlyArray<StoredMediaAsset>;
  mediaBlobCacheRecords: ReadonlyArray<MediaBlobCacheRecord>;
  mediaTransferRecords: ReadonlyArray<MediaTransferQueueRecord>;
  cloudSettingsRecord: CloudSettingsRecord | null;
}>;

function isNonEmptyString(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== "";
}

function selectEarlierTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return right.localeCompare(left) < 0 ? right : left;
}

function selectLaterTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return right.localeCompare(left) > 0 ? right : left;
}

function compareOutboxRecordsByNewestError(
  left: PersistedOutboxRecord,
  right: PersistedOutboxRecord,
): number {
  const createdAtComparison = right.createdAt.localeCompare(left.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return right.operationId.localeCompare(left.operationId);
}

function compareMediaTransfersByNewestUpdate(
  left: MediaTransferQueueRecord,
  right: MediaTransferQueueRecord,
): number {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtComparison !== 0) {
    return updatedAtComparison;
  }

  return right.transferId.localeCompare(left.transferId);
}

function isCardOutboxRecord(record: PersistedOutboxRecord): boolean {
  return record.operation.entityType === "card";
}

function isFailedOutboxRecord(record: PersistedOutboxRecord): boolean {
  return record.attemptCount > 0 && isNonEmptyString(record.lastError);
}

function isPendingMediaTransfer(record: MediaTransferQueueRecord): boolean {
  return record.status === "queued" || record.status === "in_progress";
}

function requireFiniteMediaSize(record: MediaBlobCacheRecord): number {
  if (Number.isFinite(record.sizeBytes) === false || record.sizeBytes < 0) {
    throw new Error(`Invalid media blob cache size. sha256=${record.sha256}, sizeBytes=${String(record.sizeBytes)}`);
  }

  return record.sizeBytes;
}

function collectReferencedMediaAssetIds(activeCards: ReadonlyArray<StoredCard>): ReadonlyArray<string> {
  const referencedMediaAssetIds = new Set<string>();
  for (const card of activeCards) {
    for (const mediaAssetId of extractManagedMediaAssetIdsFromMarkdown(card.frontText)) {
      referencedMediaAssetIds.add(mediaAssetId);
    }

    for (const mediaAssetId of extractManagedMediaAssetIdsFromMarkdown(card.backText)) {
      referencedMediaAssetIds.add(mediaAssetId);
    }
  }

  return [...referencedMediaAssetIds].sort((left, right) => left.localeCompare(right));
}

function buildFailedCardOutboxProblemRecords(
  failedCardRecords: ReadonlyArray<PersistedOutboxRecord>,
): ReadonlyArray<FailedCardOutboxDiagnosticRecord> {
  return [...failedCardRecords]
    .sort(compareOutboxRecordsByNewestError)
    .slice(0, problemRecordLimit)
    .map((record) => ({
      operationId: record.operationId,
      cardId: record.operation.entityId,
      attemptCount: record.attemptCount,
      createdAt: record.createdAt,
      lastError: record.lastError,
    }));
}

function buildFailedMediaTransferProblemRecords(
  failedMediaTransfers: ReadonlyArray<MediaTransferQueueRecord>,
): ReadonlyArray<FailedMediaTransferDiagnosticRecord> {
  return [...failedMediaTransfers]
    .sort(compareMediaTransfersByNewestUpdate)
    .slice(0, problemRecordLimit)
    .map((record) => ({
      transferId: record.transferId,
      mediaAssetId: record.mediaAssetId,
      kind: record.kind,
      attemptCount: record.attemptCount,
      updatedAt: record.updatedAt,
      lastError: record.lastError ?? "",
    }));
}

function buildMissingMediaReferenceProblemRecords(
  missingMediaAssetIds: ReadonlyArray<string>,
): ReadonlyArray<MissingMediaReferenceDiagnosticRecord> {
  return missingMediaAssetIds
    .slice(0, problemRecordLimit)
    .map((mediaAssetId) => ({ mediaAssetId }));
}

function buildAssetsMissingBlobProblemRecords(
  assetsMissingLocalBlob: ReadonlyArray<StoredMediaAsset>,
): ReadonlyArray<AssetMissingBlobDiagnosticRecord> {
  return [...assetsMissingLocalBlob]
    .sort((left, right) => left.mediaAssetId.localeCompare(right.mediaAssetId))
    .slice(0, problemRecordLimit)
    .map((mediaAsset) => ({
      mediaAssetId: mediaAsset.mediaAssetId,
      sha256: mediaAsset.sha256,
    }));
}

function selectLatestOutboxError(outboxRecords: ReadonlyArray<PersistedOutboxRecord>): string | null {
  const latestFailedRecord = outboxRecords
    .filter(isFailedOutboxRecord)
    .sort(compareOutboxRecordsByNewestError)[0];
  return latestFailedRecord?.lastError ?? null;
}

function selectLatestMediaTransferError(mediaTransferRecords: ReadonlyArray<MediaTransferQueueRecord>): string | null {
  const latestFailedRecord = mediaTransferRecords
    .filter((record) => record.status === "failed" && isNonEmptyString(record.lastError))
    .sort(compareMediaTransfersByNewestUpdate)[0];
  return latestFailedRecord?.lastError ?? null;
}

function selectLatestMediaDownloadCacheSuccess(
  mediaBlobCacheRecords: ReadonlyArray<MediaBlobCacheRecord>,
  mediaDownloadTransfers: ReadonlyArray<MediaTransferQueueRecord>,
): string | null {
  let latestSuccess: string | null = null;
  for (const record of mediaBlobCacheRecords) {
    latestSuccess = selectLaterTimestamp(latestSuccess, record.lastAccessedAt);
    latestSuccess = selectLaterTimestamp(latestSuccess, record.createdAt);
  }

  for (const record of mediaDownloadTransfers) {
    if (record.status === "completed") {
      latestSuccess = selectLaterTimestamp(latestSuccess, record.completedAt);
    }
  }

  return latestSuccess;
}

function buildCardsSyncDiagnostics(
  workspaceId: string,
  snapshot: LocalSyncDiagnosticsStoreSnapshot,
): CardsSyncDiagnostics {
  const workspaceCards = snapshot.cards.filter((card) => card.workspaceId === workspaceId);
  const activeCards = workspaceCards.filter((card) => card.deletedAt === null);
  const deletedCards = workspaceCards.filter((card) => card.deletedAt !== null);
  const workspaceOutboxRecords = snapshot.outboxRecords.filter((record) => record.workspaceId === workspaceId);
  const cardOutboxRecords = workspaceOutboxRecords.filter(isCardOutboxRecord);
  const failedCardRecords = cardOutboxRecords.filter(isFailedOutboxRecord);
  let oldestPendingCardOperation: string | null = null;

  for (const record of cardOutboxRecords) {
    oldestPendingCardOperation = selectEarlierTimestamp(oldestPendingCardOperation, record.createdAt);
  }

  return {
    workspaceId,
    installationId: snapshot.cloudSettingsRecord?.settings.installationId ?? null,
    cloudState: snapshot.cloudSettingsRecord?.settings.cloudState ?? null,
    localActiveCards: activeCards.length,
    localDeletedCards: deletedCards.length,
    pendingCardOperations: cardOutboxRecords.length,
    failedCardOperations: failedCardRecords.length,
    oldestPendingCardOperation,
    latestCardSyncSuccess: snapshot.syncState?.updatedAt ?? null,
    hotStateHydrated: snapshot.syncState?.hasHydratedHotState ?? null,
    hotCursor: snapshot.syncState?.lastAppliedHotChangeId ?? null,
    reviewCursor: snapshot.syncState?.lastAppliedReviewSequenceId ?? null,
    latestSyncError: selectLatestOutboxError(workspaceOutboxRecords),
  };
}

function buildManagedMediaSyncDiagnostics(
  workspaceId: string,
  snapshot: LocalSyncDiagnosticsStoreSnapshot,
): ManagedMediaSyncDiagnostics {
  const activeCards = snapshot.cards.filter((card) => card.workspaceId === workspaceId && card.deletedAt === null);
  const referencedMediaAssetIds = collectReferencedMediaAssetIds(activeCards);
  const workspaceMediaAssets = snapshot.mediaAssets.filter((mediaAsset) => mediaAsset.workspaceId === workspaceId);
  const activeMediaAssets = workspaceMediaAssets.filter((mediaAsset) => mediaAsset.deletedAt === null);
  const deletedMediaAssets = workspaceMediaAssets.filter((mediaAsset) => mediaAsset.deletedAt !== null);
  const activeMediaAssetIds = new Set<string>(activeMediaAssets.map((mediaAsset) => mediaAsset.mediaAssetId));
  const mediaBlobCacheHashes = new Set<string>(snapshot.mediaBlobCacheRecords.map((record) => record.sha256));
  const missingMediaAssetIds = referencedMediaAssetIds.filter((mediaAssetId) => activeMediaAssetIds.has(mediaAssetId) === false);
  const assetsMissingLocalBlob = activeMediaAssets.filter((mediaAsset) => mediaBlobCacheHashes.has(mediaAsset.sha256) === false);
  const workspaceMediaTransfers = snapshot.mediaTransferRecords.filter((record) => record.workspaceId === workspaceId);
  const uploadTransfers = workspaceMediaTransfers.filter((record) => record.kind === "upload");
  const downloadTransfers = workspaceMediaTransfers.filter((record) => record.kind === "download");
  const pendingMediaTransfers = workspaceMediaTransfers.filter(isPendingMediaTransfer);
  let oldestPendingMediaTransfer: string | null = null;
  let latestMediaUploadSuccess: string | null = null;
  let localMediaBytes = 0;

  for (const record of pendingMediaTransfers) {
    oldestPendingMediaTransfer = selectEarlierTimestamp(oldestPendingMediaTransfer, record.createdAt);
  }

  for (const record of uploadTransfers) {
    if (record.status === "completed") {
      latestMediaUploadSuccess = selectLaterTimestamp(latestMediaUploadSuccess, record.completedAt);
    }
  }

  for (const record of snapshot.mediaBlobCacheRecords) {
    localMediaBytes += requireFiniteMediaSize(record);
  }

  return {
    localActiveMediaAssets: activeMediaAssets.length,
    deletedMediaAssets: deletedMediaAssets.length,
    localMediaBlobs: snapshot.mediaBlobCacheRecords.length,
    localMediaBytes,
    referencedMediaInCards: referencedMediaAssetIds.length,
    referencesMissingLocalAsset: missingMediaAssetIds.length,
    assetsMissingLocalBlob: assetsMissingLocalBlob.length,
    pendingMediaUploads: uploadTransfers.filter(isPendingMediaTransfer).length,
    failedMediaUploads: uploadTransfers.filter((record) => record.status === "failed").length,
    pendingMediaDownloads: downloadTransfers.filter(isPendingMediaTransfer).length,
    failedMediaDownloads: downloadTransfers.filter((record) => record.status === "failed").length,
    oldestPendingMediaTransfer,
    latestMediaUploadSuccess,
    latestMediaDownloadCacheSuccess: selectLatestMediaDownloadCacheSuccess(
      snapshot.mediaBlobCacheRecords,
      downloadTransfers,
    ),
    latestMediaTransferError: selectLatestMediaTransferError(workspaceMediaTransfers),
  };
}

function buildProblemRecords(
  workspaceId: string,
  snapshot: LocalSyncDiagnosticsStoreSnapshot,
): LocalSyncDiagnosticsProblemRecords {
  const activeCards = snapshot.cards.filter((card) => card.workspaceId === workspaceId && card.deletedAt === null);
  const referencedMediaAssetIds = collectReferencedMediaAssetIds(activeCards);
  const activeMediaAssets = snapshot.mediaAssets.filter((mediaAsset) => (
    mediaAsset.workspaceId === workspaceId && mediaAsset.deletedAt === null
  ));
  const activeMediaAssetIds = new Set<string>(activeMediaAssets.map((mediaAsset) => mediaAsset.mediaAssetId));
  const mediaBlobCacheHashes = new Set<string>(snapshot.mediaBlobCacheRecords.map((record) => record.sha256));
  const missingMediaAssetIds = referencedMediaAssetIds.filter((mediaAssetId) => activeMediaAssetIds.has(mediaAssetId) === false);
  const assetsMissingLocalBlob = activeMediaAssets.filter((mediaAsset) => mediaBlobCacheHashes.has(mediaAsset.sha256) === false);
  const failedCardRecords = snapshot.outboxRecords
    .filter((record) => record.workspaceId === workspaceId && isCardOutboxRecord(record) && isFailedOutboxRecord(record));
  const failedMediaTransfers = snapshot.mediaTransferRecords.filter((record) => (
    record.workspaceId === workspaceId && record.status === "failed"
  ));

  return {
    failedCardOutboxOperations: buildFailedCardOutboxProblemRecords(failedCardRecords),
    failedMediaTransfers: buildFailedMediaTransferProblemRecords(failedMediaTransfers),
    missingMediaReferences: buildMissingMediaReferenceProblemRecords(missingMediaAssetIds),
    assetsMissingLocalBlob: buildAssetsMissingBlobProblemRecords(assetsMissingLocalBlob),
  };
}

async function loadLocalSyncDiagnosticsStoreSnapshot(workspaceId: string): Promise<LocalSyncDiagnosticsStoreSnapshot> {
  return closeDatabaseAfter(async (database) => ({
    cards: await getAllFromStore<StoredCard>(database, "cards"),
    outboxRecords: await getAllFromStore<PersistedOutboxRecord>(database, "outbox"),
    syncState: await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId) ?? null,
    mediaAssets: await getAllFromStore<StoredMediaAsset>(database, "mediaAssets"),
    mediaBlobCacheRecords: await getAllFromStore<MediaBlobCacheRecord>(database, "mediaBlobCache"),
    mediaTransferRecords: await getAllFromStore<MediaTransferQueueRecord>(database, "mediaTransferQueue"),
    cloudSettingsRecord: await getFromStore<CloudSettingsRecord>(database, "meta", "cloud_settings") ?? null,
  }));
}

export async function loadLocalSyncDiagnosticsReport(workspaceId: string): Promise<LocalSyncDiagnosticsReport> {
  const snapshot = await loadLocalSyncDiagnosticsStoreSnapshot(workspaceId);

  return {
    generatedAt: new Date().toISOString(),
    cardsSync: buildCardsSyncDiagnostics(workspaceId, snapshot),
    managedMediaSync: buildManagedMediaSyncDiagnostics(workspaceId, snapshot),
    problemRecords: buildProblemRecords(workspaceId, snapshot),
  };
}
