import type { CardRow } from "../../cards/types";
import { CARD_COLUMNS, mapCard } from "../../cards/shared";
import type { Card } from "../../cards";
import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import type {
  Deck,
  DeckRow,
} from "../../decks";
import { mapDeck } from "../../decks";
import {
  MEDIA_ASSET_COLUMNS,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
} from "../../mediaAssets";
import type {
  MediaAsset,
  MediaAssetRow,
} from "../../mediaAssets/types";
import { HttpError } from "../../shared/errors";
import { ensureWorkspaceReplicaInExecutor } from "../identity/replica";
import { ensureWorkspaceSyncMetadataInExecutor, loadMinAvailableHotChangeId } from "./changes";
import type { WorkspaceSchedulerSettings } from "../../scheduling/workspaceSettings";
import type { SyncPullInput } from "../contracts/input";
import type {
  HotChangeRow,
  LegacySyncCardPayload,
  LegacySyncDeckPayload,
  SyncBootstrapEntry,
  SyncPullResult,
  TimestampValue,
  WorkspaceSchedulerSettingsRow,
} from "../contracts/types";

type HotPullProjectionRow = Readonly<{
  change_id: string | number | null;
  entity_type: HotChangeRow["entity_type"] | null;
  entity_id: string | null;
  current_max_hot_change_id: string | number | null;
}>;

function toNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toIsoString(value: TimestampValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toWorkspaceSchedulerSettings(row: WorkspaceSchedulerSettingsRow): WorkspaceSchedulerSettings {
  if (row.fsrs_algorithm !== "fsrs-6") {
    throw new Error(`Unsupported scheduler algorithm: ${row.fsrs_algorithm}`);
  }

  return {
    algorithm: row.fsrs_algorithm,
    desiredRetention: row.fsrs_desired_retention,
    learningStepsMinutes: [...row.fsrs_learning_steps_minutes],
    relearningStepsMinutes: [...row.fsrs_relearning_steps_minutes],
    maximumIntervalDays: row.fsrs_maximum_interval_days,
    enableFuzz: row.fsrs_enable_fuzz,
    clientUpdatedAt: toIsoString(row.fsrs_client_updated_at),
    lastModifiedByReplicaId: row.fsrs_last_modified_by_replica_id,
    lastOperationId: row.fsrs_last_operation_id,
    updatedAt: toIsoString(row.fsrs_updated_at),
  };
}

// TODO(old-mobile-cutoff): Remove legacy effort output during final sync wire-drop cleanup.
function toLegacySyncCardPayload(card: Card): LegacySyncCardPayload {
  return {
    ...card,
    effortLevel: "fast",
  };
}

// TODO(old-mobile-cutoff): Remove legacy effortLevels output during final sync wire-drop cleanup.
function toLegacySyncDeckPayload(deck: Deck): LegacySyncDeckPayload {
  return {
    ...deck,
    filterDefinition: {
      ...deck.filterDefinition,
      effortLevels: [],
    },
  };
}

async function loadWorkspaceSchedulerSettingsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<WorkspaceSchedulerSettings> {
  const result = await executor.query<WorkspaceSchedulerSettingsRow>(
    [
      "SELECT",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_replica_id, fsrs_last_operation_id, fsrs_updated_at",
      "FROM org.workspaces",
      "WHERE workspace_id = $1",
      "LIMIT 1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Workspace scheduler settings row is missing");
  }

  return toWorkspaceSchedulerSettings(row);
}

async function loadCardsByIdsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Card>> {
  if (cardIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<CardRow>(
    [
      "SELECT",
      CARD_COLUMNS,
      "FROM content.cards",
      "WHERE workspace_id = $1 AND card_id = ANY($2::uuid[])",
    ].join(" "),
    [workspaceId, [...cardIds]],
  );

  return new Map(result.rows.map((row) => [row.card_id, mapCard(row)]));
}

async function loadDecksByIdsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deckIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Deck>> {
  if (deckIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<DeckRow>(
    [
      "SELECT",
      "deck_id, workspace_id, name, filter_definition, created_at, client_updated_at, last_modified_by_replica_id,",
      "last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1 AND deck_id = ANY($2::uuid[])",
    ].join(" "),
    [workspaceId, [...deckIds]],
  );

  return new Map(result.rows.map((row) => [row.deck_id, mapDeck(row)]));
}

async function loadMediaAssetsByIdsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  mediaAssetIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, MediaAsset>> {
  if (mediaAssetIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<MediaAssetRow>(
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1 AND media_assets.media_asset_id = ANY($2::uuid[])",
    ].join(" "),
    [workspaceId, [...mediaAssetIds]],
  );

  return new Map(result.rows.map((row) => [row.media_asset_id, mapMediaAssetRow(row)]));
}

export function resolveNextHotChangeId(
  afterHotChangeId: number,
  changes: ReadonlyArray<Readonly<{ changeId: number }>>,
  currentMaxHotChangeId: number | null,
  hasMore: boolean,
): number {
  if (changes.length > 0) {
    const lastVisibleChangeId = changes[changes.length - 1]?.changeId ?? afterHotChangeId;
    if (hasMore || currentMaxHotChangeId === null) {
      return lastVisibleChangeId;
    }

    return Math.max(lastVisibleChangeId, currentMaxHotChangeId);
  }

  if (hasMore) {
    return afterHotChangeId;
  }

  return currentMaxHotChangeId === null ? afterHotChangeId : Math.max(afterHotChangeId, currentMaxHotChangeId);
}

function readCurrentMaxHotChangeId(rows: ReadonlyArray<HotPullProjectionRow>): number {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to load current hot change id");
  }

  return toNumber(row.current_max_hot_change_id) ?? 0;
}

function toVisibleHotChangeRows(rows: ReadonlyArray<HotPullProjectionRow>): ReadonlyArray<HotChangeRow> {
  return rows.flatMap((row) => {
    if (row.change_id === null && row.entity_type === null && row.entity_id === null) {
      return [];
    }

    if (row.change_id === null || row.entity_type === null || row.entity_id === null) {
      throw new Error("Hot pull projection row must include a complete visible change");
    }

    return [{
      change_id: row.change_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
    }];
  });
}

export async function buildHotChangesFromRows(
  executor: DatabaseExecutor,
  workspaceId: string,
  rows: ReadonlyArray<HotChangeRow>,
): Promise<ReadonlyArray<Readonly<SyncBootstrapEntry & { changeId: number }>>> {
  const cardIds = rows.filter((row) => row.entity_type === "card").map((row) => row.entity_id);
  const deckIds = rows.filter((row) => row.entity_type === "deck").map((row) => row.entity_id);
  const mediaAssetIds = rows.filter((row) => row.entity_type === "media_asset").map((row) => row.entity_id);
  const workspaceSettingsNeeded = rows.some((row) => row.entity_type === "workspace_scheduler_settings");

  const [cardsById, decksById, mediaAssetsById, workspaceSchedulerSettings] = await Promise.all([
    loadCardsByIdsInExecutor(executor, workspaceId, cardIds),
    loadDecksByIdsInExecutor(executor, workspaceId, deckIds),
    loadMediaAssetsByIdsInExecutor(executor, workspaceId, mediaAssetIds),
    workspaceSettingsNeeded ? loadWorkspaceSchedulerSettingsInExecutor(executor, workspaceId) : Promise.resolve(null),
  ]);

  return rows.map((row) => {
    const changeId = toNumber(row.change_id);
    if (changeId === null) {
      throw new Error("Hot change id must not be NULL");
    }

    if (row.entity_type === "card") {
      const card = cardsById.get(row.entity_id);
      if (card === undefined) {
        throw new Error(`Hot sync card ${row.entity_id} is missing`);
      }

      return {
        changeId,
        entityType: "card" as const,
        entityId: row.entity_id,
        action: "upsert" as const,
        payload: toLegacySyncCardPayload(card),
      };
    }

    if (row.entity_type === "deck") {
      const deck = decksById.get(row.entity_id);
      if (deck === undefined) {
        throw new Error(`Hot sync deck ${row.entity_id} is missing`);
      }

      return {
        changeId,
        entityType: "deck" as const,
        entityId: row.entity_id,
        action: "upsert" as const,
        payload: toLegacySyncDeckPayload(deck),
      };
    }

    if (row.entity_type === "media_asset") {
      const mediaAsset = mediaAssetsById.get(row.entity_id);
      if (mediaAsset === undefined) {
        throw new Error(`Hot sync media asset ${row.entity_id} is missing`);
      }

      return {
        changeId,
        entityType: "media_asset" as const,
        entityId: row.entity_id,
        action: "upsert" as const,
        payload: mediaAsset,
      };
    }

    if (workspaceSchedulerSettings === null) {
      throw new Error("Hot sync workspace scheduler settings row is missing");
    }

    return {
      changeId,
      entityType: "workspace_scheduler_settings" as const,
      entityId: row.entity_id,
      action: "upsert" as const,
      payload: workspaceSchedulerSettings,
    };
  });
}

export async function processSyncPull(
  workspaceId: string,
  userId: string,
  input: SyncPullInput,
): Promise<SyncPullResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await ensureWorkspaceReplicaInExecutor(executor, {
      workspaceId,
      userId,
      installationId: input.installationId,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
    });
    await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
    const minAvailableHotChangeId = await loadMinAvailableHotChangeId(executor, workspaceId);
    if (input.afterHotChangeId > 0 && input.afterHotChangeId < minAvailableHotChangeId) {
      throw new HttpError(
        409,
        "Cloud sync requires a fresh bootstrap.",
        "SYNC_BOOTSTRAP_REQUIRED",
      );
    }

    const result = await executor.query<HotPullProjectionRow>(
      [
        "WITH current_max AS (",
        "  SELECT COALESCE(MAX(change_id), 0) AS current_max_hot_change_id",
        "  FROM sync.hot_changes",
        "  WHERE workspace_id = $1",
        "),",
        "latest_changes AS (",
        "  SELECT DISTINCT ON (entity_type, entity_id)",
        "    change_id, entity_type, entity_id",
        "  FROM sync.hot_changes",
        "  WHERE workspace_id = $1 AND change_id > $2",
        "  AND ($4::boolean OR entity_type <> 'media_asset')",
        "  ORDER BY entity_type ASC, entity_id ASC, change_id DESC",
        "),",
        "visible_page AS (",
        "  SELECT change_id, entity_type, entity_id",
        "  FROM latest_changes",
        "  ORDER BY change_id ASC",
        "  LIMIT $3",
        ")",
        "SELECT visible_page.change_id, visible_page.entity_type, visible_page.entity_id,",
        "current_max.current_max_hot_change_id",
        "FROM current_max",
        "LEFT JOIN visible_page ON TRUE",
        "ORDER BY visible_page.change_id ASC NULLS LAST",
      ].join(" "),
      [workspaceId, input.afterHotChangeId, input.limit + 1, input.includeMediaAssets === true],
    );

    const visibleProjectionRows = toVisibleHotChangeRows(result.rows);
    const hasMore = visibleProjectionRows.length > input.limit;
    const visibleRows = hasMore ? visibleProjectionRows.slice(0, input.limit) : visibleProjectionRows;
    const changes = await buildHotChangesFromRows(executor, workspaceId, visibleRows);
    const currentMaxHotChangeId = input.includeMediaAssets !== true && hasMore === false
      ? readCurrentMaxHotChangeId(result.rows)
      : null;
    const nextHotChangeId = resolveNextHotChangeId(input.afterHotChangeId, changes, currentMaxHotChangeId, hasMore);

    return {
      changes,
      nextHotChangeId,
      hasMore,
    };
  });
}
