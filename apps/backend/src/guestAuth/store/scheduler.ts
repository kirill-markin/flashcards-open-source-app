import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import { toIsoString } from "../shared";

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
