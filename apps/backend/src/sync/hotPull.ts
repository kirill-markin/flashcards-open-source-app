import type { CardRow } from "../cards/types";
import { mapCard } from "../cards/shared";
import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../db";
import type {
  Deck,
  DeckRow,
} from "../decks";
import { mapDeck } from "../decks";
import { HttpError } from "../errors";
import { ensureWorkspaceReplica } from "../syncIdentity";
import { ensureWorkspaceSyncMetadataInExecutor, loadMinAvailableHotChangeId } from "../syncChanges";
import type { WorkspaceSchedulerSettings } from "../workspaceSchedulerSettings";
import type { SyncPullInput } from "./input";
import type {
  HotChangeRow,
  SyncBootstrapEntry,
  SyncPullResult,
  TimestampValue,
  WorkspaceSchedulerSettingsRow,
} from "./types";

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
): Promise<ReadonlyMap<string, import("../cards").Card>> {
  if (cardIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<CardRow>(
    [
      "SELECT",
      "card_id, front_text, back_text, tags, effort_level, due_at, created_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at",
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

export async function buildHotChangesFromRows(
  executor: DatabaseExecutor,
  workspaceId: string,
  rows: ReadonlyArray<HotChangeRow>,
): Promise<ReadonlyArray<Readonly<SyncBootstrapEntry & { changeId: number }>>> {
  const cardIds = rows.filter((row) => row.entity_type === "card").map((row) => row.entity_id);
  const deckIds = rows.filter((row) => row.entity_type === "deck").map((row) => row.entity_id);
  const workspaceSettingsNeeded = rows.some((row) => row.entity_type === "workspace_scheduler_settings");

  const [cardsById, decksById, workspaceSchedulerSettings] = await Promise.all([
    loadCardsByIdsInExecutor(executor, workspaceId, cardIds),
    loadDecksByIdsInExecutor(executor, workspaceId, deckIds),
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
        payload: card,
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
        payload: deck,
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
  await ensureWorkspaceReplica({
    workspaceId,
    userId,
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
  });

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
    const minAvailableHotChangeId = await loadMinAvailableHotChangeId(executor, workspaceId);
    if (input.afterHotChangeId > 0 && input.afterHotChangeId < minAvailableHotChangeId) {
      throw new HttpError(
        409,
        "Cloud sync requires a fresh bootstrap.",
        "SYNC_BOOTSTRAP_REQUIRED",
      );
    }

    const result = await executor.query<HotChangeRow>(
      [
        "WITH latest_changes AS (",
        "  SELECT DISTINCT ON (entity_type, entity_id)",
        "    change_id, entity_type, entity_id",
        "  FROM sync.hot_changes",
        "  WHERE workspace_id = $1 AND change_id > $2",
        "  ORDER BY entity_type ASC, entity_id ASC, change_id DESC",
        ")",
        "SELECT change_id, entity_type, entity_id",
        "FROM latest_changes",
        "ORDER BY change_id ASC",
        "LIMIT $3",
      ].join(" "),
      [workspaceId, input.afterHotChangeId, input.limit + 1],
    );

    const hasMore = result.rows.length > input.limit;
    const visibleRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
    const changes = await buildHotChangesFromRows(executor, workspaceId, visibleRows);
    const nextHotChangeId = changes.length === 0
      ? input.afterHotChangeId
      : changes[changes.length - 1].changeId;

    return {
      changes,
      nextHotChangeId,
      hasMore,
    };
  });
}
