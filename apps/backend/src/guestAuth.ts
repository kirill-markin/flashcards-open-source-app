import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  query,
  transaction,
  type DatabaseExecutor,
} from "./db";
import { HttpError } from "./errors";
import { compareLwwMetadata } from "./lww";
import { insertSyncChange } from "./syncChanges";
import {
  AUTO_CREATED_WORKSPACE_NAME,
  createWorkspaceInExecutor,
} from "./workspaces";

type GuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  revoked_at: Date | string | null;
}>;

type GuestWorkspaceRow = Readonly<{
  workspace_id: string | null;
}>;

type IdentityMappingRow = Readonly<{
  user_id: string;
}>;

type WorkspaceSummaryRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: Date | string;
}>;

type SyncDeviceRow = Readonly<{
  device_id: string;
  platform: string;
  app_version: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
}>;

type CardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  tags: ReadonlyArray<string>;
  effort_level: string;
  due_at: Date | string | null;
  created_at: Date | string;
  reps: number;
  lapses: number;
  fsrs_card_state: string;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: Date | string | null;
  fsrs_scheduled_days: number | null;
  client_updated_at: Date | string;
  last_modified_by_device_id: string;
  last_operation_id: string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}>;

type DeckRow = Readonly<{
  deck_id: string;
  name: string;
  filter_definition: Readonly<Record<string, unknown>>;
  created_at: Date | string;
  client_updated_at: Date | string;
  last_modified_by_device_id: string;
  last_operation_id: string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}>;

type ReviewEventRow = Readonly<{
  review_event_id: string;
  card_id: string;
  device_id: string;
  client_event_id: string;
  rating: number;
  reviewed_at_client: Date | string;
  reviewed_at_server: Date | string;
}>;

type WorkspaceSchedulerRow = Readonly<{
  fsrs_algorithm: string;
  fsrs_desired_retention: number;
  fsrs_learning_steps_minutes: ReadonlyArray<number>;
  fsrs_relearning_steps_minutes: ReadonlyArray<number>;
  fsrs_maximum_interval_days: number;
  fsrs_enable_fuzz: boolean;
  fsrs_client_updated_at: Date | string;
  fsrs_last_modified_by_device_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: Date | string;
}>;

type GuestUpgradeMode = "bound" | "merge_required";
type GuestUpgradeSelectionType = GuestUpgradeSelection["type"];

export type GuestSessionSnapshot = Readonly<{
  guestToken: string;
  userId: string;
  workspaceId: string;
}>;

export type GuestUpgradePreparation = Readonly<{
  mode: GuestUpgradeMode;
}>;

export type GuestUpgradeSelection =
  | Readonly<{
    type: "existing";
    workspaceId: string;
  }>
  | Readonly<{
    type: "create_new";
  }>;

export type GuestUpgradeCompletion = Readonly<{
  workspace: Readonly<{
    workspaceId: string;
    name: string;
    createdAt: string;
    isSelected: true;
  }>;
}>;

type GuestUpgradeHistoryWrite = Readonly<{
  upgradeId: string;
  sourceGuestUserId: string;
  sourceGuestWorkspaceId: string;
  sourceGuestSessionId: string;
  targetSubjectUserId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  selectionType: GuestUpgradeSelectionType;
  deviceIdMap: ReadonlyMap<string, string>;
}>;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hashGuestToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

async function loadGuestSessionInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  lockForUpdate: boolean,
): Promise<GuestSessionRow> {
  const result = await executor.query<GuestSessionRow>(
    [
      "SELECT session_id, user_id, revoked_at",
      "FROM auth.guest_sessions",
      "WHERE session_secret_hash = $1",
      lockForUpdate ? "FOR UPDATE" : "",
    ].join(" "),
    [hashGuestToken(guestToken)],
  );

  const row = result.rows[0];
  if (row === undefined || row.revoked_at !== null) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return row;
}

async function loadGuestWorkspaceIdInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<string> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const result = await executor.query<GuestWorkspaceRow>(
    "SELECT workspace_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
    [guestUserId],
  );
  const workspaceId = result.rows[0]?.workspace_id ?? null;
  if (workspaceId === null) {
    throw new Error("Guest user is missing selected workspace");
  }

  return workspaceId;
}

async function loadWorkspaceSummaryInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<GuestUpgradeCompletion["workspace"]> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const result = await executor.query<WorkspaceSummaryRow>(
    [
      "SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at",
      "FROM org.workspaces AS workspaces",
      "INNER JOIN org.workspace_memberships AS memberships",
      "ON memberships.workspace_id = workspaces.workspace_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return {
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: toIsoString(row.created_at),
    isSelected: true,
  };
}

async function loadIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
): Promise<string | null> {
  const result = await executor.query<IdentityMappingRow>(
    [
      "SELECT user_id",
      "FROM auth.user_identities",
      "WHERE provider_type = 'cognito' AND provider_subject = $1",
      "LIMIT 1",
    ].join(" "),
    [providerSubject],
  );

  return result.rows[0]?.user_id ?? null;
}

async function loadWorkspaceNameInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<string> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const result = await executor.query<WorkspaceSummaryRow>(
    [
      "SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at",
      "FROM org.workspaces AS workspaces",
      "INNER JOIN org.workspace_memberships AS memberships",
      "ON memberships.workspace_id = workspaces.workspace_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return row.name;
}

async function assertTargetWorkspaceAccessInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const summary = await loadWorkspaceSummaryInExecutor(executor, userId, workspaceId);
  if (summary.workspaceId !== workspaceId) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }
}

async function loadGuestDevicesInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<SyncDeviceRow>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<SyncDeviceRow>(
    [
      "SELECT device_id, platform, app_version, created_at, last_seen_at",
      "FROM sync.devices",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, device_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows;
}

async function loadGuestCardsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<CardRow>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<CardRow>(
    [
      "SELECT",
      "card_id, front_text, back_text, tags, effort_level, due_at, created_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.cards",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, card_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows;
}

async function loadGuestDecksInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<DeckRow>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<DeckRow>(
    [
      "SELECT",
      "deck_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_device_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, deck_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows;
}

async function loadGuestReviewEventsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<ReviewEventRow>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<ReviewEventRow>(
    [
      "SELECT review_event_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server",
      "FROM content.review_events",
      "WHERE workspace_id = $1",
      "ORDER BY review_sequence ASC, review_event_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows;
}

async function loadWorkspaceSchedulerInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceSchedulerRow> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId,
    workspaceId,
  });

  const result = await executor.query<WorkspaceSchedulerRow>(
    [
      "SELECT",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
      "FROM org.workspaces",
      "WHERE workspace_id = $1",
      "LIMIT 1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return row;
}

function schedulerWinnerIsGuest(
  guestScheduler: WorkspaceSchedulerRow,
  targetScheduler: WorkspaceSchedulerRow,
): boolean {
  return compareLwwMetadata({
    clientUpdatedAt: toIsoString(guestScheduler.fsrs_client_updated_at),
    lastModifiedByDeviceId: guestScheduler.fsrs_last_modified_by_device_id,
    lastOperationId: guestScheduler.fsrs_last_operation_id,
  }, {
    clientUpdatedAt: toIsoString(targetScheduler.fsrs_client_updated_at),
    lastModifiedByDeviceId: targetScheduler.fsrs_last_modified_by_device_id,
    lastOperationId: targetScheduler.fsrs_last_operation_id,
  }) > 0;
}

async function recreateGuestDevicesInExecutor(
  executor: DatabaseExecutor,
  guestDevices: ReadonlyArray<SyncDeviceRow>,
  targetUserId: string,
  targetWorkspaceId: string,
): Promise<ReadonlyMap<string, string>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });

  const deviceIdMapEntries: Array<readonly [string, string]> = [];
  for (const device of guestDevices) {
    const nextDeviceId = randomUUID().toLowerCase();
    await executor.query(
      [
        "INSERT INTO sync.devices",
        "(",
        "device_id, workspace_id, user_id, platform, app_version, created_at, last_seen_at",
        ")",
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ].join(" "),
      [
        nextDeviceId,
        targetWorkspaceId,
        targetUserId,
        device.platform,
        device.app_version,
        toIsoString(device.created_at),
        toIsoString(device.last_seen_at),
      ],
    );
    deviceIdMapEntries.push([device.device_id, nextDeviceId]);
  }

  return new Map<string, string>(deviceIdMapEntries);
}

/**
 * Persists durable guest-merge aliases before live guest rows are deleted.
 *
 * Lookup semantics:
 * - source_guest_user_id -> current target user/workspace
 * - source_guest_device_id -> recreated target_device_id
 *
 * The history tables intentionally avoid live-row foreign keys for guest and
 * target identity rows so destructive guest cleanup cannot erase this audit
 * trail.
 */
async function recordGuestUpgradeHistoryInExecutor(
  executor: DatabaseExecutor,
  history: GuestUpgradeHistoryWrite,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO auth.guest_upgrade_history",
      "(",
      "upgrade_id, source_guest_user_id, source_guest_workspace_id, source_guest_session_id,",
      "target_subject_user_id, target_user_id, target_workspace_id, selection_type",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    ].join(" "),
    [
      history.upgradeId,
      history.sourceGuestUserId,
      history.sourceGuestWorkspaceId,
      history.sourceGuestSessionId,
      history.targetSubjectUserId,
      history.targetUserId,
      history.targetWorkspaceId,
      history.selectionType,
    ],
  );

  for (const [sourceGuestDeviceId, targetDeviceId] of history.deviceIdMap) {
    await executor.query(
      [
        "INSERT INTO auth.guest_device_aliases",
        "(",
        "source_guest_device_id, upgrade_id, target_device_id",
        ")",
        "VALUES ($1, $2, $3)",
      ].join(" "),
      [
        sourceGuestDeviceId,
        history.upgradeId,
        targetDeviceId,
      ],
    );
  }
}

function requireMappedDeviceId(
  deviceIdMap: ReadonlyMap<string, string>,
  oldDeviceId: string,
): string {
  const nextDeviceId = deviceIdMap.get(oldDeviceId);
  if (nextDeviceId === undefined) {
    throw new Error(`Missing merged device mapping for ${oldDeviceId}`);
  }

  return nextDeviceId;
}

async function deleteGuestWorkspaceContentInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  await executor.query(
    "DELETE FROM content.decks WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
  await executor.query(
    "DELETE FROM content.cards WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
}

async function insertMergedCardsInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  cards: ReadonlyArray<CardRow>,
  deviceIdMap: ReadonlyMap<string, string>,
  mergeId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });

  for (const card of cards) {
    const nextDeviceId = requireMappedDeviceId(deviceIdMap, card.last_modified_by_device_id);
    await executor.query(
      [
        "INSERT INTO content.cards",
        "(",
        "card_id, workspace_id, front_text, back_text, tags, effort_level, due_at, reps, lapses,",
        "updated_at, deleted_at, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty,",
        "fsrs_last_reviewed_at, fsrs_scheduled_days, client_updated_at, last_modified_by_device_id, last_operation_id, created_at",
        ")",
        "VALUES",
        "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)",
      ].join(" "),
      [
        card.card_id,
        targetWorkspaceId,
        card.front_text,
        card.back_text,
        card.tags,
        card.effort_level,
        card.due_at === null ? null : toIsoString(card.due_at),
        card.reps,
        card.lapses,
        toIsoString(card.updated_at),
        card.deleted_at === null ? null : toIsoString(card.deleted_at),
        card.fsrs_card_state,
        card.fsrs_step_index,
        card.fsrs_stability,
        card.fsrs_difficulty,
        card.fsrs_last_reviewed_at === null ? null : toIsoString(card.fsrs_last_reviewed_at),
        card.fsrs_scheduled_days,
        toIsoString(card.client_updated_at),
        nextDeviceId,
        card.last_operation_id,
        toIsoString(card.created_at),
      ],
    );

    await insertSyncChange(
      executor,
      targetWorkspaceId,
      "card",
      card.card_id,
      "upsert",
      nextDeviceId,
      `guest-merge-${mergeId}-card-${card.card_id}`,
      toIsoString(card.client_updated_at),
    );
  }
}

async function insertMergedDecksInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  decks: ReadonlyArray<DeckRow>,
  deviceIdMap: ReadonlyMap<string, string>,
  mergeId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });

  for (const deck of decks) {
    const nextDeviceId = requireMappedDeviceId(deviceIdMap, deck.last_modified_by_device_id);
    await executor.query(
      [
        "INSERT INTO content.decks",
        "(",
        "deck_id, workspace_id, name, filter_definition, created_at, updated_at, deleted_at,",
        "client_updated_at, last_modified_by_device_id, last_operation_id",
        ")",
        "VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)",
      ].join(" "),
      [
        deck.deck_id,
        targetWorkspaceId,
        deck.name,
        JSON.stringify(deck.filter_definition),
        toIsoString(deck.created_at),
        toIsoString(deck.updated_at),
        deck.deleted_at === null ? null : toIsoString(deck.deleted_at),
        toIsoString(deck.client_updated_at),
        nextDeviceId,
        deck.last_operation_id,
      ],
    );

    await insertSyncChange(
      executor,
      targetWorkspaceId,
      "deck",
      deck.deck_id,
      "upsert",
      nextDeviceId,
      `guest-merge-${mergeId}-deck-${deck.deck_id}`,
      toIsoString(deck.client_updated_at),
    );
  }
}

async function insertMergedReviewEventsInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  reviewEvents: ReadonlyArray<ReviewEventRow>,
  deviceIdMap: ReadonlyMap<string, string>,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });

  for (const reviewEvent of reviewEvents) {
    const nextDeviceId = requireMappedDeviceId(deviceIdMap, reviewEvent.device_id);
    await executor.query(
      [
        "INSERT INTO content.review_events",
        "(",
        "review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server",
        ")",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      ].join(" "),
      [
        reviewEvent.review_event_id,
        targetWorkspaceId,
        reviewEvent.card_id,
        nextDeviceId,
        reviewEvent.client_event_id,
        reviewEvent.rating,
        toIsoString(reviewEvent.reviewed_at_client),
        toIsoString(reviewEvent.reviewed_at_server),
      ],
    );
  }
}

/**
 * Merges portable guest workspace state into the selected destination workspace
 * and returns the durable alias metadata that must be recorded before the live
 * guest rows are deleted.
 *
 * V1 intentionally preserves only correlation metadata for future debugging.
 * Guest-only chat rows and other cascade-deleted live records still disappear
 * during cleanup and are not copied here.
 */
async function mergeGuestWorkspaceIntoTargetInExecutor(
  executor: DatabaseExecutor,
  params: Readonly<{
    guestSessionId: string;
    guestUserId: string;
    guestWorkspaceId: string;
    targetSubjectUserId: string;
    targetUserId: string;
    targetWorkspaceId: string;
    selectionType: GuestUpgradeSelectionType;
  }>,
): Promise<GuestUpgradeHistoryWrite> {
  const upgradeId = randomUUID().toLowerCase();
  const guestDevices = await loadGuestDevicesInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestCards = await loadGuestCardsInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestDecks = await loadGuestDecksInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestReviewEvents = await loadGuestReviewEventsInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestScheduler = await loadWorkspaceSchedulerInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const targetScheduler = await loadWorkspaceSchedulerInExecutor(executor, params.targetUserId, params.targetWorkspaceId);

  await deleteGuestWorkspaceContentInExecutor(executor, params.guestUserId, params.guestWorkspaceId);

  const deviceIdMap = await recreateGuestDevicesInExecutor(
    executor,
    guestDevices,
    params.targetUserId,
    params.targetWorkspaceId,
  );

  await insertMergedCardsInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestCards,
    deviceIdMap,
    upgradeId,
  );
  await insertMergedDecksInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestDecks,
    deviceIdMap,
    upgradeId,
  );
  await insertMergedReviewEventsInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestReviewEvents,
    deviceIdMap,
  );

  if (schedulerWinnerIsGuest(guestScheduler, targetScheduler)) {
    const nextDeviceId = requireMappedDeviceId(deviceIdMap, guestScheduler.fsrs_last_modified_by_device_id);
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: params.targetUserId,
      workspaceId: params.targetWorkspaceId,
    });
    await executor.query(
      [
        "UPDATE org.workspaces",
        "SET",
        "fsrs_algorithm = $1,",
        "fsrs_desired_retention = $2,",
        "fsrs_learning_steps_minutes = $3::jsonb,",
        "fsrs_relearning_steps_minutes = $4::jsonb,",
        "fsrs_maximum_interval_days = $5,",
        "fsrs_enable_fuzz = $6,",
        "fsrs_client_updated_at = $7,",
        "fsrs_last_modified_by_device_id = $8,",
        "fsrs_last_operation_id = $9,",
        "fsrs_updated_at = $10",
        "WHERE workspace_id = $11",
      ].join(" "),
      [
        guestScheduler.fsrs_algorithm,
        guestScheduler.fsrs_desired_retention,
        JSON.stringify(guestScheduler.fsrs_learning_steps_minutes),
        JSON.stringify(guestScheduler.fsrs_relearning_steps_minutes),
        guestScheduler.fsrs_maximum_interval_days,
        guestScheduler.fsrs_enable_fuzz,
        toIsoString(guestScheduler.fsrs_client_updated_at),
        nextDeviceId,
        guestScheduler.fsrs_last_operation_id,
        toIsoString(guestScheduler.fsrs_updated_at),
        params.targetWorkspaceId,
      ],
    );
    await insertSyncChange(
      executor,
      params.targetWorkspaceId,
      "workspace_scheduler_settings",
      params.targetWorkspaceId,
      "upsert",
      nextDeviceId,
      `guest-merge-${upgradeId}-scheduler-${params.targetWorkspaceId}`,
      toIsoString(guestScheduler.fsrs_client_updated_at),
    );
  }

  return {
    upgradeId,
    sourceGuestUserId: params.guestUserId,
    sourceGuestWorkspaceId: params.guestWorkspaceId,
    sourceGuestSessionId: params.guestSessionId,
    targetSubjectUserId: params.targetSubjectUserId,
    targetUserId: params.targetUserId,
    targetWorkspaceId: params.targetWorkspaceId,
    selectionType: params.selectionType,
    deviceIdMap,
  };
}

export async function authenticateGuestSession(guestToken: string): Promise<Readonly<{
  userId: string;
}>> {
  const result = await query<GuestSessionRow>(
    [
      "SELECT session_id, user_id, revoked_at",
      "FROM auth.guest_sessions",
      "WHERE session_secret_hash = $1",
      "LIMIT 1",
    ].join(" "),
    [hashGuestToken(guestToken)],
  );

  const row = result.rows[0];
  if (row === undefined || row.revoked_at !== null) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return {
    userId: row.user_id,
  };
}

export async function createGuestSession(): Promise<GuestSessionSnapshot> {
  return transaction(async (executor) => {
    const userId = randomUUID().toLowerCase();
    const guestToken = randomBytes(32).toString("hex");

    await applyUserDatabaseScopeInExecutor(executor, { userId });
    const workspaceId = await createWorkspaceInExecutor(executor, userId, AUTO_CREATED_WORKSPACE_NAME);
    await executor.query(
      "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
      [workspaceId, userId],
    );
    await executor.query(
      [
        "INSERT INTO auth.guest_sessions",
        "(session_id, session_secret_hash, user_id)",
        "VALUES ($1, $2, $3)",
      ].join(" "),
      [randomUUID().toLowerCase(), hashGuestToken(guestToken), userId],
    );

    return {
      guestToken,
      userId,
      workspaceId,
    };
  });
}

/**
 * Prepares one guest upgrade attempt using the already-open executor.
 *
 * `bound` keeps the existing guest user id and therefore does not create any
 * destructive merge history. Only `merge_required` leads to guest cleanup and
 * history recording later during completion.
 */
export async function prepareGuestUpgradeInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  cognitoSubject: string,
  email: string | null,
): Promise<GuestUpgradePreparation> {
  const guestSession = await loadGuestSessionInExecutor(executor, guestToken, true);
  const existingMappedUserId = await loadIdentityMappingInExecutor(executor, cognitoSubject);

  if (existingMappedUserId === null || existingMappedUserId === guestSession.user_id) {
    await applyUserDatabaseScopeInExecutor(executor, { userId: guestSession.user_id });
    await executor.query(
      [
        "INSERT INTO auth.user_identities (provider_type, provider_subject, user_id)",
        "VALUES ('cognito', $1, $2)",
        "ON CONFLICT (provider_type, provider_subject) DO NOTHING",
      ].join(" "),
      [cognitoSubject, guestSession.user_id],
    );
    await executor.query(
      "UPDATE org.user_settings SET email = $1 WHERE user_id = $2",
      [email, guestSession.user_id],
    );

    return {
      mode: "bound",
    };
  }

  return {
    mode: "merge_required",
  };
}

export async function prepareGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  email: string | null,
): Promise<GuestUpgradePreparation> {
  return transaction(async (executor) => prepareGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, email));
}

/**
 * Completes one guest upgrade attempt using the already-open executor.
 *
 * For `merge_required`, V1 records durable guest/user/device aliases before the
 * live guest rows are deleted. Server-side guest chat rows still disappear via
 * cascade and are intentionally not copied in this version.
 */
export async function completeGuestUpgradeInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  cognitoSubject: string,
  selection: GuestUpgradeSelection,
): Promise<GuestUpgradeCompletion> {
  const guestSession = await loadGuestSessionInExecutor(executor, guestToken, true);
  const targetUserId = await loadIdentityMappingInExecutor(executor, cognitoSubject);
  if (targetUserId === null) {
    throw new HttpError(409, "Create or sign in to the destination account first.", "GUEST_UPGRADE_ACCOUNT_REQUIRED");
  }

  if (targetUserId === guestSession.user_id) {
    const guestWorkspaceId = await loadGuestWorkspaceIdInExecutor(executor, guestSession.user_id);
    return {
      workspace: await loadWorkspaceSummaryInExecutor(executor, guestSession.user_id, guestWorkspaceId),
    };
  }

  const guestWorkspaceId = await loadGuestWorkspaceIdInExecutor(executor, guestSession.user_id);
  const targetWorkspaceId = selection.type === "existing"
    ? selection.workspaceId
    : await (async () => {
      const guestWorkspaceName = await loadWorkspaceNameInExecutor(executor, guestSession.user_id, guestWorkspaceId);
      await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
      const nextWorkspaceId = await createWorkspaceInExecutor(executor, targetUserId, guestWorkspaceName);
      await executor.query(
        "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
        [nextWorkspaceId, targetUserId],
      );
      return nextWorkspaceId;
    })();

  await assertTargetWorkspaceAccessInExecutor(executor, targetUserId, targetWorkspaceId);
  const guestUpgradeHistory = await mergeGuestWorkspaceIntoTargetInExecutor(
    executor,
    {
      guestSessionId: guestSession.session_id,
      guestUserId: guestSession.user_id,
      guestWorkspaceId,
      targetSubjectUserId: cognitoSubject,
      targetUserId,
      targetWorkspaceId,
      selectionType: selection.type,
    },
  );
  await recordGuestUpgradeHistoryInExecutor(executor, guestUpgradeHistory);

  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [targetWorkspaceId, targetUserId],
  );

  await applyUserDatabaseScopeInExecutor(executor, { userId: guestSession.user_id });
  await executor.query(
    "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1",
    [guestSession.session_id],
  );
  await executor.query(
    "DELETE FROM org.workspaces WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
  await executor.query(
    "DELETE FROM org.user_settings WHERE user_id = $1",
    [guestSession.user_id],
  );

  return {
    workspace: await loadWorkspaceSummaryInExecutor(executor, targetUserId, targetWorkspaceId),
  };
}

export async function completeGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  selection: GuestUpgradeSelection,
): Promise<GuestUpgradeCompletion> {
  return transaction(async (executor) => completeGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, selection));
}
