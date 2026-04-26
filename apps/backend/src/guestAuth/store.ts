import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../db";
import type { EffortLevel } from "../cards";
import type { DeckFilterDefinition } from "../decks";
import { HttpError } from "../errors";
import type { FsrsCardState } from "../schedule";
import type {
  SyncClientPlatform,
  WorkspaceReplicaActorKind,
  WorkspaceReplicaPlatform,
} from "../syncIdentity";
import type {
  GuestUpgradeCompletion,
  GuestUpgradeDroppedEntities,
  GuestUpgradeHistoryWrite,
} from "./types";
import { hashGuestToken, toIsoString } from "./shared";

type GuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  revoked_at: Date | string | null;
}>;

type GuestUpgradeHistoryReplayRow = Readonly<{
  source_guest_session_id: string;
  target_subject_user_id: string;
  target_user_id: string;
  target_workspace_id: string;
  dropped_entities: GuestUpgradeDroppedEntities | null;
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

type WorkspaceReplicaRow = Readonly<{
  replica_id: string;
  actor_kind: WorkspaceReplicaActorKind;
  installation_id: string | null;
  actor_key: string | null;
  platform: WorkspaceReplicaPlatform;
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
  last_modified_by_replica_id: string;
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
  last_modified_by_replica_id: string;
  last_operation_id: string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}>;

type ReviewEventRow = Readonly<{
  review_event_id: string;
  card_id: string;
  replica_id: string;
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
  fsrs_last_modified_by_replica_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: Date | string;
}>;

type DeletedGuestWorkspaceRow = Readonly<{
  workspace_id: string;
}>;

export type GuestSessionRecord = Readonly<{
  sessionId: string;
  userId: string;
  revokedAt: Date | string | null;
}>;

export type GuestUpgradeReplayRecord = Readonly<{
  sourceGuestSessionId: string;
  targetSubjectUserId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  droppedEntities?: GuestUpgradeDroppedEntities;
}>;

export type GuestReplicaRecord = Readonly<{
  replicaId: string;
  actorKind: WorkspaceReplicaActorKind;
  installationId: string | null;
  actorKey: string | null;
  platform: WorkspaceReplicaPlatform;
  appVersion: string | null;
  createdAt: Date | string;
  lastSeenAt: Date | string;
}>;

export type GuestCardRecord = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: Date | string | null;
  createdAt: Date | string;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: Date | string | null;
  fsrsScheduledDays: number | null;
  clientUpdatedAt: Date | string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}>;

export type GuestDeckRecord = Readonly<{
  deckId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: Date | string;
  clientUpdatedAt: Date | string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}>;

export type GuestReviewEventRecord = Readonly<{
  reviewEventId: string;
  cardId: string;
  replicaId: string;
  clientEventId: string;
  rating: number;
  reviewedAtClient: Date | string;
  reviewedAtServer: Date | string;
}>;

export type GuestWorkspaceSchedulerRecord = Readonly<{
  algorithm: string;
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
  clientUpdatedAt: Date | string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: Date | string;
}>;

function mapGuestSessionRecord(row: GuestSessionRow): GuestSessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    revokedAt: row.revoked_at,
  };
}

function mapGuestUpgradeReplayRecord(row: GuestUpgradeHistoryReplayRow): GuestUpgradeReplayRecord {
  return {
    sourceGuestSessionId: row.source_guest_session_id,
    targetSubjectUserId: row.target_subject_user_id,
    targetUserId: row.target_user_id,
    targetWorkspaceId: row.target_workspace_id,
    ...(row.dropped_entities === null
      ? {}
      : { droppedEntities: row.dropped_entities }),
  };
}

function mapGuestReplicaRecord(row: WorkspaceReplicaRow): GuestReplicaRecord {
  return {
    replicaId: row.replica_id,
    actorKind: row.actor_kind,
    installationId: row.installation_id,
    actorKey: row.actor_key,
    platform: row.platform,
    appVersion: row.app_version,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapGuestCardRecord(row: CardRow): GuestCardRecord {
  return {
    cardId: row.card_id,
    frontText: row.front_text,
    backText: row.back_text,
    tags: row.tags,
    effortLevel: row.effort_level as EffortLevel,
    dueAt: row.due_at,
    createdAt: row.created_at,
    reps: row.reps,
    lapses: row.lapses,
    fsrsCardState: row.fsrs_card_state as FsrsCardState,
    fsrsStepIndex: row.fsrs_step_index,
    fsrsStability: row.fsrs_stability,
    fsrsDifficulty: row.fsrs_difficulty,
    fsrsLastReviewedAt: row.fsrs_last_reviewed_at,
    fsrsScheduledDays: row.fsrs_scheduled_days,
    clientUpdatedAt: row.client_updated_at,
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapGuestDeckRecord(row: DeckRow): GuestDeckRecord {
  return {
    deckId: row.deck_id,
    name: row.name,
    filterDefinition: row.filter_definition as DeckFilterDefinition,
    createdAt: row.created_at,
    clientUpdatedAt: row.client_updated_at,
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapGuestReviewEventRecord(row: ReviewEventRow): GuestReviewEventRecord {
  return {
    reviewEventId: row.review_event_id,
    cardId: row.card_id,
    replicaId: row.replica_id,
    clientEventId: row.client_event_id,
    rating: row.rating,
    reviewedAtClient: row.reviewed_at_client,
    reviewedAtServer: row.reviewed_at_server,
  };
}

function mapGuestWorkspaceSchedulerRecord(row: WorkspaceSchedulerRow): GuestWorkspaceSchedulerRecord {
  return {
    algorithm: row.fsrs_algorithm,
    desiredRetention: row.fsrs_desired_retention,
    learningStepsMinutes: row.fsrs_learning_steps_minutes,
    relearningStepsMinutes: row.fsrs_relearning_steps_minutes,
    maximumIntervalDays: row.fsrs_maximum_interval_days,
    enableFuzz: row.fsrs_enable_fuzz,
    clientUpdatedAt: row.fsrs_client_updated_at,
    lastModifiedByReplicaId: row.fsrs_last_modified_by_replica_id,
    lastOperationId: row.fsrs_last_operation_id,
    updatedAt: row.fsrs_updated_at,
  };
}

export async function loadGuestSessionRecordInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  lockForUpdate: boolean,
): Promise<GuestSessionRecord | null> {
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
  return row === undefined ? null : mapGuestSessionRecord(row);
}

export async function loadGuestSessionInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  lockForUpdate: boolean,
): Promise<GuestSessionRecord> {
  const session = await loadGuestSessionRecordInExecutor(executor, guestToken, lockForUpdate);
  if (session === null || session.revokedAt !== null) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return session;
}

export async function loadGuestUpgradeReplayInExecutor(
  executor: DatabaseExecutor,
  guestSessionId: string,
): Promise<GuestUpgradeReplayRecord | null> {
  // Compatibility read path for released clients that retry
  // `/guest-auth/upgrade/complete` after the merge committed and the original
  // guest session was already revoked.
  const result = await executor.query<GuestUpgradeHistoryReplayRow>(
    [
      "SELECT source_guest_session_id, target_subject_user_id, target_user_id, target_workspace_id, dropped_entities",
      "FROM auth.guest_upgrade_history",
      "WHERE source_guest_session_id = $1",
      "LIMIT 1",
    ].join(" "),
    [guestSessionId],
  );

  const row = result.rows[0];
  return row === undefined ? null : mapGuestUpgradeReplayRecord(row);
}

export async function loadGuestUpgradeReplayByGuestTokenInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
): Promise<GuestUpgradeReplayRecord | null> {
  const result = await executor.query<GuestUpgradeHistoryReplayRow>(
    [
      "SELECT source_guest_session_id, target_subject_user_id, target_user_id, target_workspace_id, dropped_entities",
      "FROM auth.guest_upgrade_history",
      "WHERE source_guest_session_secret_hash = $1",
      "LIMIT 1",
    ].join(" "),
    [hashGuestToken(guestToken)],
  );

  const row = result.rows[0];
  return row === undefined ? null : mapGuestUpgradeReplayRecord(row);
}

export async function loadGuestWorkspaceIdInExecutor(
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

export async function loadWorkspaceSummaryInExecutor(
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

export async function loadIdentityMappingInExecutor(
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

export async function hasCognitoIdentityMappingForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<boolean> {
  const result = await executor.query<IdentityMappingRow>(
    [
      "SELECT user_id",
      "FROM auth.user_identities",
      "WHERE provider_type = 'cognito' AND user_id = $1",
      "LIMIT 1",
    ].join(" "),
    [userId],
  );

  return result.rows[0] !== undefined;
}

export async function bindIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
  userId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    [
      "INSERT INTO auth.user_identities (provider_type, provider_subject, user_id)",
      "VALUES ('cognito', $1, $2)",
      "ON CONFLICT (provider_type, provider_subject) DO NOTHING",
    ].join(" "),
    [providerSubject, userId],
  );
}

export async function updateUserEmailInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  email: string | null,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "UPDATE org.user_settings SET email = $1 WHERE user_id = $2",
    [email, userId],
  );
}

export async function loadWorkspaceNameInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<string> {
  const workspace = await loadWorkspaceSummaryInExecutor(executor, userId, workspaceId);
  return workspace.name;
}

export async function assertTargetWorkspaceAccessInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const workspace = await loadWorkspaceSummaryInExecutor(executor, userId, workspaceId);
  if (workspace.workspaceId !== workspaceId) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }
}

export async function loadGuestReplicasInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<GuestReplicaRecord>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<WorkspaceReplicaRow>(
    [
      "SELECT replica_id, actor_kind, installation_id, actor_key, platform, app_version, created_at, last_seen_at",
      "FROM sync.workspace_replicas",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, replica_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapGuestReplicaRecord);
}

export async function loadGuestCardsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<GuestCardRecord>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<CardRow>(
    [
      "SELECT",
      "card_id, front_text, back_text, tags, effort_level, due_at, created_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at",
      "FROM content.cards",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, card_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapGuestCardRecord);
}

export async function loadGuestDecksInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<GuestDeckRecord>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<DeckRow>(
    [
      "SELECT",
      "deck_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_replica_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, deck_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapGuestDeckRecord);
}

export async function loadGuestReviewEventsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<GuestReviewEventRecord>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<ReviewEventRow>(
    [
      "SELECT review_event_id, card_id, replica_id, client_event_id, rating, reviewed_at_client, reviewed_at_server",
      "FROM content.review_events",
      "WHERE workspace_id = $1",
      "ORDER BY review_sequence ASC, review_event_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapGuestReviewEventRecord);
}

export async function loadWorkspaceSchedulerInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<GuestWorkspaceSchedulerRecord> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId,
    workspaceId,
  });

  const result = await executor.query<WorkspaceSchedulerRow>(
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
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return mapGuestWorkspaceSchedulerRecord(row);
}

export async function deleteGuestWorkspaceContentInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  await executor.query(
    "DELETE FROM content.review_events WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
  await executor.query(
    "DELETE FROM content.decks WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
  await executor.query(
    "DELETE FROM content.cards WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
}

export async function updateWorkspaceSchedulerFromGuestInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  scheduler: GuestWorkspaceSchedulerRecord,
  replicaId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
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
      "fsrs_last_modified_by_replica_id = $8,",
      "fsrs_last_operation_id = $9,",
      "fsrs_updated_at = $10",
      "WHERE workspace_id = $11",
    ].join(" "),
    [
      scheduler.algorithm,
      scheduler.desiredRetention,
      JSON.stringify(scheduler.learningStepsMinutes),
      JSON.stringify(scheduler.relearningStepsMinutes),
      scheduler.maximumIntervalDays,
      scheduler.enableFuzz,
      toIsoString(scheduler.clientUpdatedAt),
      replicaId,
      scheduler.lastOperationId,
      toIsoString(scheduler.updatedAt),
      targetWorkspaceId,
    ],
  );
}

export async function recordGuestUpgradeHistoryInExecutor(
  executor: DatabaseExecutor,
  history: GuestUpgradeHistoryWrite,
): Promise<void> {
  // Legacy/idempotency-only audit record. Keep it while old clients can retry
  // completion after session revocation; it is not a local-outbox replay layer.
  await executor.query(
    [
      "INSERT INTO auth.guest_upgrade_history",
      "(",
      "upgrade_id, source_guest_user_id, source_guest_workspace_id, source_guest_session_id,",
      "source_guest_session_secret_hash, target_subject_user_id, target_user_id, target_workspace_id,",
      "selection_type, dropped_entities",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
    ].join(" "),
    [
      history.upgradeId,
      history.sourceGuestUserId,
      history.sourceGuestWorkspaceId,
      history.sourceGuestSessionId,
      history.sourceGuestSessionSecretHash,
      history.targetSubjectUserId,
      history.targetUserId,
      history.targetWorkspaceId,
      history.selectionType,
      history.droppedEntities === undefined
        ? null
        : JSON.stringify(history.droppedEntities),
    ],
  );

  for (const [sourceGuestReplicaId, targetReplicaId] of history.replicaIdMap) {
    // Replica aliases are the last durable routing bridge for stale shipped
    // clients that still reference pre-merge guest replica ids. They do not
    // alias card/deck/review ids. Remove them only together with the rest of
    // the guest-upgrade compatibility layer.
    await executor.query(
      [
        "INSERT INTO auth.guest_replica_aliases",
        "(",
        "source_guest_replica_id, upgrade_id, target_replica_id",
        ")",
        "VALUES ($1, $2, $3)",
      ].join(" "),
      [
        sourceGuestReplicaId,
        history.upgradeId,
        targetReplicaId,
      ],
    );
  }
}

export async function selectWorkspaceForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [workspaceId, userId],
  );
}

export async function revokeGuestSessionInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  await executor.query(
    "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1",
    [guestSessionId],
  );
}

export async function deleteWorkspaceInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  await executor.query(
    "DELETE FROM org.workspaces WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
}

export async function deleteGuestWorkspaceIfOwnedBySoleMemberInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<boolean> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const result = await executor.query<DeletedGuestWorkspaceRow>(
    [
      "DELETE FROM org.workspaces AS workspaces",
      "WHERE workspaces.workspace_id = $1",
      "AND EXISTS (",
      "SELECT 1",
      "FROM org.workspace_memberships memberships",
      "WHERE memberships.workspace_id = workspaces.workspace_id",
      "AND memberships.user_id = $2",
      "AND memberships.role = 'owner'",
      ")",
      "AND 1 = (",
      "SELECT COUNT(*)::int",
      "FROM org.workspace_memberships all_memberships",
      "WHERE all_memberships.workspace_id = workspaces.workspace_id",
      ")",
      "RETURNING workspaces.workspace_id",
    ].join(" "),
    [guestWorkspaceId, guestUserId],
  );

  return result.rows[0] !== undefined;
}

export async function deleteUserSettingsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  await executor.query(
    "DELETE FROM org.user_settings WHERE user_id = $1",
    [guestUserId],
  );
}

export function requireMappedReplicaId(
  replicaIdMap: ReadonlyMap<string, string>,
  oldReplicaId: string,
): string {
  const nextReplicaId = replicaIdMap.get(oldReplicaId);
  if (nextReplicaId === undefined) {
    throw new Error(`Missing merged replica mapping for ${oldReplicaId}`);
  }

  return nextReplicaId;
}

export function toSyncClientPlatform(platform: WorkspaceReplicaPlatform): SyncClientPlatform {
  if (platform === "system") {
    throw new Error("Client installation replica cannot use system platform");
  }

  return platform;
}
