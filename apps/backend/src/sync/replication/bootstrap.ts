import { upsertCardSnapshotInExecutor } from "../../cards";
import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import { upsertDeckSnapshotInExecutor } from "../../decks";
import { HttpError } from "../../shared/errors";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
} from "../../shared/pagination";
import { ensureWorkspaceReplicaInExecutor } from "../identity/replica";
import { ensureWorkspaceSyncMetadataInExecutor } from "./changes";
import { annotateSyncConflictHttpError } from "../conflicts/fork";
import { applyWorkspaceSchedulerSettingsSnapshotInExecutor } from "../../scheduling/workspaceSettings";
import {
  cardPayloadSchema,
  deckPayloadSchema,
  mediaAssetPayloadSchema,
  type SyncBootstrapInput,
  type SyncBootstrapPushEntry,
  workspaceSchedulerSettingsPayloadSchema,
} from "../contracts/input";
import {
  toCardMutationMetadata,
  toCardSnapshotInput,
  toDeckMutationMetadata,
  toDeckSnapshotInput,
  toWorkspaceSchedulerSettingsMutationMetadata,
  toWorkspaceSchedulerSettingsSnapshotInput,
} from "../contracts/snapshots";
import type {
  BootstrapProjectionRow,
  MaxChangeIdRow,
  RemoteEmptyRow,
  SyncBootstrapCursor,
  SyncBootstrapEntry,
  SyncBootstrapPullResult,
  SyncBootstrapPushResult,
} from "../contracts/types";

const mediaAssetSyncWriteRejectedMessage = "media_asset sync writes are not accepted; use the media upload API to create or update media assets.";

function toNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

async function loadCurrentMaxHotChangeId(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  const result = await executor.query<MaxChangeIdRow>(
    [
      "SELECT COALESCE(MAX(change_id), 0) AS max_change_id",
      "FROM sync.hot_changes",
      "WHERE workspace_id = $1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Failed to load current hot change id");
  }

  return toNumber(row.max_change_id) ?? 0;
}

export async function loadRemoteEmptyState(
  executor: DatabaseExecutor,
  workspaceId: string,
  includeMediaAssets: boolean,
): Promise<boolean> {
  const result = await executor.query<RemoteEmptyRow>(
    [
      "SELECT",
      "EXISTS (SELECT 1 FROM content.cards WHERE workspace_id = $1) AS has_cards,",
      "EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = $1) AS has_decks,",
      "EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = $1) AS has_review_events,",
      "EXISTS (SELECT 1 FROM content.media_assets WHERE workspace_id = $1) AS has_media_assets",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Failed to determine remote bootstrap state");
  }

  return row.has_cards === false
    && row.has_decks === false
    && row.has_review_events === false
    && (includeMediaAssets === false || row.has_media_assets === false);
}

export function encodeBootstrapCursor(cursor: SyncBootstrapCursor): string {
  return encodeOpaqueCursor([
    cursor.bootstrapHotChangeId,
    cursor.entityRank,
    cursor.entityId,
  ]);
}

export function decodeBootstrapCursor(cursor: string): SyncBootstrapCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 3) {
    throw new HttpError(400, "cursor is invalid");
  }

  const bootstrapHotChangeId = decodedCursor.values[0];
  const entityRank = decodedCursor.values[1];
  const entityId = decodedCursor.values[2];
  if (typeof bootstrapHotChangeId !== "number" || typeof entityRank !== "number" || typeof entityId !== "string") {
    throw new HttpError(400, "cursor is invalid");
  }

  return {
    bootstrapHotChangeId,
    entityRank,
    entityId,
  };
}

export function parseBootstrapEntryRow(row: BootstrapProjectionRow): SyncBootstrapEntry {
  if (row.entity_type === "card") {
    return {
      entityType: "card",
      entityId: row.entity_id,
      action: "upsert",
      payload: cardPayloadSchema.parse(row.payload),
    };
  }

  if (row.entity_type === "deck") {
    return {
      entityType: "deck",
      entityId: row.entity_id,
      action: "upsert",
      payload: deckPayloadSchema.parse(row.payload),
    };
  }

  if (row.entity_type === "media_asset") {
    return {
      entityType: "media_asset",
      entityId: row.entity_id,
      action: "upsert",
      payload: mediaAssetPayloadSchema.parse(row.payload),
    };
  }

  return {
    entityType: "workspace_scheduler_settings",
    entityId: row.entity_id,
    action: "upsert",
    payload: workspaceSchedulerSettingsPayloadSchema.parse(row.payload),
  };
}

type BootstrapPushMediaAwarenessInput = Readonly<{
  includeMediaAssets?: boolean;
  entries: ReadonlyArray<Pick<SyncBootstrapPushEntry, "entityType">>,
}>;

export function bootstrapPushIncludesMediaAssets(
  input: BootstrapPushMediaAwarenessInput,
): boolean {
  return input.includeMediaAssets === true || input.entries.some((entry) => entry.entityType === "media_asset");
}

export async function processSyncBootstrap(
  workspaceId: string,
  userId: string,
  input: SyncBootstrapInput,
): Promise<SyncBootstrapPullResult | SyncBootstrapPushResult> {
  if (input.mode === "push") {
    return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
      const replicaId = await ensureWorkspaceReplicaInExecutor(executor, {
        workspaceId,
        userId,
        installationId: input.installationId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
      });
      await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
      const remoteIsEmpty = await loadRemoteEmptyState(
        executor,
        workspaceId,
        bootstrapPushIncludesMediaAssets(input),
      );
      if (remoteIsEmpty === false) {
        throw new HttpError(409, "Cloud bootstrap requires an empty remote workspace", "SYNC_BOOTSTRAP_NOT_EMPTY");
      }

      let appliedEntriesCount = 0;
      for (const [entryIndex, entry] of input.entries.entries()) {
        try {
          if (entry.entityType === "card") {
            await upsertCardSnapshotInExecutor(
              executor,
              workspaceId,
              toCardSnapshotInput(entry.payload),
              toCardMutationMetadata({
                clientUpdatedAt: entry.payload.clientUpdatedAt,
                lastModifiedByReplicaId: replicaId,
                lastOperationId: entry.payload.lastOperationId,
              }),
            );
            appliedEntriesCount += 1;
            continue;
          }

          if (entry.entityType === "deck") {
            await upsertDeckSnapshotInExecutor(
              executor,
              workspaceId,
              toDeckSnapshotInput(entry.payload),
              toDeckMutationMetadata({
                clientUpdatedAt: entry.payload.clientUpdatedAt,
                lastModifiedByReplicaId: replicaId,
                lastOperationId: entry.payload.lastOperationId,
              }),
            );
            appliedEntriesCount += 1;
            continue;
          }

          if (entry.entityType === "media_asset") {
            if (entry.entityId !== entry.payload.mediaAssetId) {
              throw new HttpError(400, "media_asset entityId must match payload.mediaAssetId", "SYNC_INVALID_INPUT");
            }

            if (entry.payload.workspaceId !== workspaceId) {
              throw new HttpError(
                400,
                "media_asset payload.workspaceId must match the authenticated workspaceId",
                "SYNC_INVALID_INPUT",
              );
            }

            throw new HttpError(
              400,
              mediaAssetSyncWriteRejectedMessage,
              "SYNC_MEDIA_ASSET_WRITE_REJECTED",
            );
          }

          await applyWorkspaceSchedulerSettingsSnapshotInExecutor(
            executor,
            workspaceId,
            toWorkspaceSchedulerSettingsSnapshotInput(entry.payload),
            toWorkspaceSchedulerSettingsMutationMetadata({
              clientUpdatedAt: entry.payload.clientUpdatedAt,
              lastModifiedByReplicaId: replicaId,
              lastOperationId: entry.payload.lastOperationId,
            }),
          );
          appliedEntriesCount += 1;
        } catch (error) {
          const annotatedError = annotateSyncConflictHttpError(error, {
            phase: "bootstrap",
            entryIndex,
          });
          throw annotatedError ?? error;
        }
      }

      return {
        mode: "push",
        appliedEntriesCount,
        bootstrapHotChangeId: await loadCurrentMaxHotChangeId(executor, workspaceId),
      };
    });
  }

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await ensureWorkspaceReplicaInExecutor(executor, {
      workspaceId,
      userId,
      installationId: input.installationId,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
    });
    await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
    const cursor = input.cursor === null
      ? {
        bootstrapHotChangeId: await loadCurrentMaxHotChangeId(executor, workspaceId),
        entityRank: -1,
        entityId: "",
      }
      : decodeBootstrapCursor(input.cursor);
    const remoteIsEmpty = await loadRemoteEmptyState(executor, workspaceId, input.includeMediaAssets === true);

    // TODO(old-mobile-cutoff): Remove legacy effort fields during final sync wire-drop cleanup.
    const result = await executor.query<BootstrapProjectionRow>(
      [
        "WITH bootstrap_entries AS (",
        "  SELECT",
        "    0 AS entity_rank,",
        "    'workspace_scheduler_settings'::text AS entity_type,",
        "    workspaces.workspace_id::text AS entity_id,",
        "    jsonb_build_object(",
        "      'algorithm', workspaces.fsrs_algorithm,",
        "      'desiredRetention', workspaces.fsrs_desired_retention,",
        "      'learningStepsMinutes', workspaces.fsrs_learning_steps_minutes,",
        "      'relearningStepsMinutes', workspaces.fsrs_relearning_steps_minutes,",
        "      'maximumIntervalDays', workspaces.fsrs_maximum_interval_days,",
        "      'enableFuzz', workspaces.fsrs_enable_fuzz,",
        "      'clientUpdatedAt', to_char(date_trunc('milliseconds', workspaces.fsrs_client_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'lastModifiedByReplicaId', workspaces.fsrs_last_modified_by_replica_id::text,",
        "      'lastOperationId', workspaces.fsrs_last_operation_id,",
        "      'updatedAt', to_char(date_trunc('milliseconds', workspaces.fsrs_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
        "    ) AS payload",
        "  FROM org.workspaces AS workspaces",
        "  WHERE workspaces.workspace_id = $1",
        "  UNION ALL",
        "  SELECT",
        "    1 AS entity_rank,",
        "    'card'::text AS entity_type,",
        "    cards.card_id::text AS entity_id,",
        "    jsonb_build_object(",
        "      'cardId', cards.card_id::text,",
        "      'frontText', cards.front_text,",
        "      'backText', cards.back_text,",
        "      'cardType', CASE WHEN btrim(cards.card_type) = '' THEN 'basic' ELSE cards.card_type END,",
        "      'metadata', cards.metadata,",
        "      'tags', cards.tags,",
        "      'effortLevel', 'fast',",
        "      'dueAt', CASE WHEN cards.due_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', cards.due_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END,",
        "      'createdAt', to_char(date_trunc('milliseconds', cards.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'reps', cards.reps,",
        "      'lapses', cards.lapses,",
        "      'fsrsCardState', cards.fsrs_card_state,",
        "      'fsrsStepIndex', cards.fsrs_step_index,",
        "      'fsrsStability', cards.fsrs_stability,",
        "      'fsrsDifficulty', cards.fsrs_difficulty,",
        "      'fsrsLastReviewedAt', CASE WHEN cards.fsrs_last_reviewed_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', cards.fsrs_last_reviewed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END,",
        "      'fsrsScheduledDays', cards.fsrs_scheduled_days,",
        "      'clientUpdatedAt', to_char(date_trunc('milliseconds', cards.client_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'lastModifiedByReplicaId', cards.last_modified_by_replica_id::text,",
        "      'lastOperationId', cards.last_operation_id,",
        "      'updatedAt', to_char(date_trunc('milliseconds', cards.updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'deletedAt', CASE WHEN cards.deleted_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', cards.deleted_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END",
        "    ) AS payload",
        "  FROM content.cards AS cards",
        "  WHERE cards.workspace_id = $1",
        "  UNION ALL",
        "  SELECT",
        "    2 AS entity_rank,",
        "    'deck'::text AS entity_type,",
        "    decks.deck_id::text AS entity_id,",
        "    jsonb_build_object(",
        "      'deckId', decks.deck_id::text,",
        "      'workspaceId', decks.workspace_id::text,",
        "      'name', decks.name,",
        "      'filterDefinition', jsonb_build_object(",
        "        'version', 2,",
        "        'effortLevels', '[]'::jsonb,",
        "        'tags', decks.filter_definition->'tags'",
        "      ),",
        "      'createdAt', to_char(date_trunc('milliseconds', decks.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'clientUpdatedAt', to_char(date_trunc('milliseconds', decks.client_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'lastModifiedByReplicaId', decks.last_modified_by_replica_id::text,",
        "      'lastOperationId', decks.last_operation_id,",
        "      'updatedAt', to_char(date_trunc('milliseconds', decks.updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'deletedAt', CASE WHEN decks.deleted_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', decks.deleted_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END",
        "    ) AS payload",
        "  FROM content.decks AS decks",
        "  WHERE decks.workspace_id = $1",
        "  UNION ALL",
        "  SELECT",
        "    3 AS entity_rank,",
        "    'media_asset'::text AS entity_type,",
        "    media_assets.media_asset_id::text AS entity_id,",
        "    jsonb_build_object(",
        "      'mediaAssetId', media_assets.media_asset_id::text,",
        "      'workspaceId', media_assets.workspace_id::text,",
        "      'mimeType', media_blobs.mime_type,",
        "      'sizeBytes', media_blobs.size_bytes,",
        "      'sha256', media_blobs.sha256,",
        "      'sourceUrl', media_assets.source_url,",
        "      'createdAt', to_char(date_trunc('milliseconds', media_assets.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'clientUpdatedAt', to_char(date_trunc('milliseconds', media_assets.client_updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'lastModifiedByReplicaId', media_assets.last_modified_by_replica_id::text,",
        "      'lastOperationId', media_assets.last_operation_id,",
        "      'updatedAt', to_char(date_trunc('milliseconds', media_assets.updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),",
        "      'deletedAt', CASE WHEN media_assets.deleted_at IS NULL THEN NULL ELSE to_char(date_trunc('milliseconds', media_assets.deleted_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END",
        "    ) AS payload",
        "  FROM content.media_assets AS media_assets",
        "  INNER JOIN content.media_blobs AS media_blobs",
        "  ON media_blobs.media_blob_id = media_assets.media_blob_id",
        "  WHERE media_assets.workspace_id = $1",
        "  AND $5::boolean",
        ")",
        "SELECT entity_rank, entity_type, entity_id, payload",
        "FROM bootstrap_entries",
        "WHERE (entity_rank > $2 OR (entity_rank = $2 AND entity_id > $3))",
        "ORDER BY entity_rank ASC, entity_id ASC",
        "LIMIT $4",
      ].join(" "),
      [workspaceId, cursor.entityRank, cursor.entityId, input.limit + 1, input.includeMediaAssets === true],
    );

    const hasMore = result.rows.length > input.limit;
    const visibleRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
    const entries = visibleRows.map(parseBootstrapEntryRow);
    const nextRow = hasMore ? visibleRows[visibleRows.length - 1] : undefined;

    return {
      mode: "pull",
      entries,
      nextCursor: nextRow === undefined
        ? null
        : encodeBootstrapCursor({
          bootstrapHotChangeId: cursor.bootstrapHotChangeId,
          entityRank: nextRow.entity_rank,
          entityId: nextRow.entity_id,
        }),
      hasMore,
      bootstrapHotChangeId: cursor.bootstrapHotChangeId,
      remoteIsEmpty,
    };
  });
}
