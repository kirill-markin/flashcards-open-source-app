import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
  type MediaAssetState,
  type MediaBlobState,
} from "../models";
import { createQueryResult } from "../queryResult";
import {
  createMediaAssetQueryRow,
  createMediaBlobQueryRow,
} from "../rowShapes";

function requireMediaBlob(
  mediaBlobs: ReadonlyArray<MediaBlobState>,
  mediaBlobId: string,
): MediaBlobState {
  const mediaBlob = mediaBlobs.find((blob) => blob.media_blob_id === mediaBlobId);
  if (mediaBlob === undefined) {
    throw new Error(`Media blob row is missing for media_blob_id ${mediaBlobId}`);
  }

  return mediaBlob;
}

export function handleMediaExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { state } = context;

  // Narrow on the WHERE clause so the media asset join select, which also
  // names content.media_blobs, cannot fall into this branch.
  if (text.startsWith("SELECT") && text.includes("FROM content.media_blobs WHERE sha256 = $1")) {
    const sha256 = String(params[0]);
    const mediaBlob = state.mediaBlobs.find((blob) => blob.sha256 === sha256);
    return createQueryResult<Row>(
      mediaBlob === undefined ? [] : [createMediaBlobQueryRow(mediaBlob) as unknown as Row],
    );
  }

  if (
    text.startsWith("INSERT INTO content.media_blobs")
    && text.includes("ON CONFLICT (sha256) DO NOTHING")
  ) {
    const sha256 = String(params[0]);
    if (state.mediaBlobs.some((blob) => blob.sha256 === sha256)) {
      return createQueryResult<Row>([]);
    }

    const insertedMediaBlob: MediaBlobState = {
      media_blob_id: randomUUID(),
      sha256,
      mime_type: String(params[1]),
      size_bytes: Number(params[2]),
      storage_key: String(params[3]),
      normalization_version: String(params[4]),
      created_at: "2026-04-02T14:00:00.000Z",
      updated_at: "2026-04-02T14:00:00.000Z",
    };
    state.mediaBlobs.push(insertedMediaBlob);
    return createQueryResult<Row>([createMediaBlobQueryRow(insertedMediaBlob) as unknown as Row]);
  }

  if (text.startsWith("SELECT") && text.includes("FROM content.media_assets AS media_assets")) {
    const workspaceId = params[0];
    if (typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    const mediaAssetId = text.includes("media_assets.media_asset_id = $2")
      ? (typeof params[1] === "string" ? params[1] : null)
      : null;
    const rows = state.mediaAssets
      .filter((mediaAsset) => (
        mediaAsset.workspace_id === workspaceId
        && (mediaAssetId === null || mediaAsset.media_asset_id === mediaAssetId)
      ))
      .sort((left, right) => (
        left.created_at.localeCompare(right.created_at)
        || left.media_asset_id.localeCompare(right.media_asset_id)
      ))
      .map((mediaAsset) => createMediaAssetQueryRow(
        mediaAsset,
        requireMediaBlob(state.mediaBlobs, mediaAsset.media_blob_id),
      ) as unknown as Row);
    return createQueryResult<Row>(rows);
  }

  if (text === "DELETE FROM content.media_assets WHERE workspace_id = $1") {
    const workspaceId = String(params[0]);
    state.mediaAssets = state.mediaAssets.filter((mediaAsset) => mediaAsset.workspace_id !== workspaceId);
    return createQueryResult<Row>([]);
  }

  if (text.startsWith("WITH inserted_media_asset AS")) {
    const mediaAssetId = String(params[0]);
    // media_asset_id is the globally unique primary key, so a row in any
    // workspace makes the insert a no-op.
    if (state.mediaAssets.some((mediaAsset) => mediaAsset.media_asset_id === mediaAssetId)) {
      return createQueryResult<Row>([]);
    }

    const insertedMediaAsset: MediaAssetState = {
      media_asset_id: mediaAssetId,
      workspace_id: String(params[1]),
      media_blob_id: String(params[2]),
      source_url: params[3] === null ? null : String(params[3]),
      created_at: String(params[4]),
      client_updated_at: String(params[5]),
      last_modified_by_replica_id: String(params[6]),
      last_operation_id: String(params[7]),
      updated_at: String(params[5]),
      deleted_at: params[8] === null ? null : String(params[8]),
    };
    state.mediaAssets.push(insertedMediaAsset);
    return createQueryResult<Row>([createMediaAssetQueryRow(
      insertedMediaAsset,
      requireMediaBlob(state.mediaBlobs, insertedMediaAsset.media_blob_id),
    ) as unknown as Row]);
  }

  if (text.startsWith("WITH updated_media_asset AS")) {
    const workspaceId = String(params[0]);
    const mediaAssetId = String(params[1]);
    const index = state.mediaAssets.findIndex((mediaAsset) => (
      mediaAsset.workspace_id === workspaceId
      && mediaAsset.media_asset_id === mediaAssetId
    ));
    if (index === -1) {
      return createQueryResult<Row>([]);
    }

    const current = state.mediaAssets[index];
    if (current === undefined) {
      return createQueryResult<Row>([]);
    }

    const updatedMediaAsset: MediaAssetState = {
      ...current,
      source_url: params[2] === null ? null : String(params[2]),
      created_at: String(params[3]),
      deleted_at: params[4] === null ? null : String(params[4]),
      client_updated_at: String(params[5]),
      last_modified_by_replica_id: String(params[6]),
      last_operation_id: String(params[7]),
      updated_at: String(params[5]),
    };
    state.mediaAssets[index] = updatedMediaAsset;
    return createQueryResult<Row>([createMediaAssetQueryRow(
      updatedMediaAsset,
      requireMediaBlob(state.mediaBlobs, updatedMediaAsset.media_blob_id),
    ) as unknown as Row]);
  }

  return null;
}
