import { randomUUID } from "node:crypto";
import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../database";
import { HttpError } from "../shared/errors";
import {
  addBackendBreadcrumb,
  captureBackendException,
  normalizeCaughtError,
  type BackendObservationScope,
  type WorkspaceTransactionDetails,
} from "../observability/sentry";
import { markBackendExceptionWrapperAsReported } from "../observability/reporting";
import {
  buildSystemWorkspaceReplicaId,
  ensureBootstrapSystemWorkspaceReplicaInExecutor,
} from "../sync/identity/replica";
import { insertSyncChange } from "../sync/replication/changes";
import {
  createWorkspaceCreateFailedError,
  createWorkspaceInvariantError,
  createWorkspaceTransactionScope,
  getDatabaseErrorDetails,
} from "./shared";
import { loadWorkspaceSummaryInExecutor } from "./queries";
import {
  lockUserSettingsForWorkspaceLifecycleInExecutor,
  persistSelectedWorkspaceForApiKeyConnectionInExecutor,
  persistSelectedWorkspaceForOAuthConnectionInExecutor,
  persistSelectedWorkspaceForUserInExecutor,
} from "./state";
import type { TimestampValue } from "./shared";
import type { WorkspaceSummary } from "./types";

type WorkspaceCreateFailureStage =
  | "create_workspace_row"
  | "create_bootstrap_replica"
  | "create_membership"
  | "load_scheduler_settings"
  | "seed_scheduler_change"
  | "select_workspace"
  | "load_workspace_summary";

type WorkspaceSchedulerSeedRow = Readonly<{
  fsrs_algorithm: string;
  fsrs_desired_retention: number;
  fsrs_learning_steps_minutes: ReadonlyArray<number>;
  fsrs_relearning_steps_minutes: ReadonlyArray<number>;
  fsrs_maximum_interval_days: number;
  fsrs_enable_fuzz: boolean;
  fsrs_client_updated_at: TimestampValue;
  fsrs_last_modified_by_replica_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: TimestampValue;
}>;

async function ensureUserSettingsRowInExecutor(executor: DatabaseExecutor, userId: string): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
}

function handleWorkspaceCreateFailure(
  error: unknown,
  userId: string,
  workspaceId: string,
  stage: WorkspaceCreateFailureStage,
  observationScope: BackendObservationScope | null,
): never {
  const scope = createWorkspaceTransactionScope(userId, workspaceId, observationScope);
  if (error instanceof HttpError) {
    const details: WorkspaceTransactionDetails = {
      userId,
      workspaceId,
      stage,
      code: error.code,
      cardsResetCount: null,
      memberCount: null,
      selectedWorkspaceIdBeforeDelete: null,
      selectedWorkspaceIdAfterPreparation: null,
      deletedCardsCount: null,
      sqlState: null,
      constraint: null,
      table: null,
      detail: null,
    };
    addBackendBreadcrumb({ action: "workspace_create_transaction_error", scope, details });
    throw error;
  }

  const databaseErrorDetails = getDatabaseErrorDetails(error);
  const details: WorkspaceTransactionDetails = {
    userId,
    workspaceId,
    stage,
    code: "WORKSPACE_CREATE_FAILED",
    ...databaseErrorDetails,
    cardsResetCount: null,
    memberCount: null,
    selectedWorkspaceIdBeforeDelete: null,
    selectedWorkspaceIdAfterPreparation: null,
    deletedCardsCount: null,
  };
  captureBackendException({
    action: "workspace_create_transaction_error",
    error: normalizeCaughtError(error),
    scope,
    details,
  });
  throw markBackendExceptionWrapperAsReported(createWorkspaceCreateFailedError());
}

export async function createWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  name: string,
): Promise<string> {
  return createWorkspaceInExecutorWithObservationScope(executor, userId, name, null);
}

export async function createWorkspaceInExecutorWithObservationScope(
  executor: DatabaseExecutor,
  userId: string,
  name: string,
  observationScope: BackendObservationScope | null,
): Promise<string> {
  await ensureUserSettingsRowInExecutor(executor, userId);
  await lockUserSettingsForWorkspaceLifecycleInExecutor(executor, userId);

  const workspaceId = randomUUID();
  const bootstrapTimestamp = new Date().toISOString();
  const bootstrapOperationId = `bootstrap-workspace-${workspaceId}`;
  const bootstrapReplicaId = buildSystemWorkspaceReplicaId(
    workspaceId,
    "workspace_seed",
    "workspace-seed",
  );
  let stage: WorkspaceCreateFailureStage = "create_workspace_row";

  try {
    await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
    await executor.query(
      [
        "INSERT INTO org.workspaces",
        "(",
        "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id",
        ")",
        "VALUES ($1, $2, $3, $4, $5)",
      ].join(" "),
      [workspaceId, name, bootstrapTimestamp, bootstrapReplicaId, bootstrapOperationId],
    );

    stage = "create_membership";
    await executor.query(
      [
        "INSERT INTO org.workspace_memberships",
        "(workspace_id, user_id, role)",
        "VALUES ($1, $2, 'owner')",
      ].join(" "),
      [workspaceId, userId],
    );

    stage = "create_bootstrap_replica";
    await ensureBootstrapSystemWorkspaceReplicaInExecutor(executor, {
      workspaceId,
      userId,
      actorKind: "workspace_seed",
      actorKey: "workspace-seed",
      platform: "system",
      appVersion: "server-bootstrap",
    }, bootstrapReplicaId);

    stage = "load_scheduler_settings";
    const workspaceResult = await executor.query<WorkspaceSchedulerSeedRow>(
      [
        "SELECT",
        "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
        "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
        "fsrs_last_modified_by_replica_id,",
        "fsrs_last_operation_id,",
        "fsrs_updated_at",
        "FROM org.workspaces",
        "WHERE workspace_id = $1",
      ].join(" "),
      [workspaceId],
    );
    const workspaceRow = workspaceResult.rows[0];
    if (workspaceRow === undefined) {
      throw createWorkspaceInvariantError(
        "Workspace creation failed while loading scheduler settings.",
        "WORKSPACE_CREATE_SETTINGS_UNAVAILABLE",
      );
    }

    stage = "seed_scheduler_change";
    await insertSyncChange(
      executor,
      workspaceId,
      "workspace_scheduler_settings",
      workspaceId,
      "upsert",
      workspaceRow.fsrs_last_modified_by_replica_id,
      workspaceRow.fsrs_last_operation_id,
      workspaceRow.fsrs_client_updated_at instanceof Date
        ? workspaceRow.fsrs_client_updated_at.toISOString()
        : new Date(workspaceRow.fsrs_client_updated_at).toISOString(),
    );

    return workspaceId;
  } catch (error) {
    handleWorkspaceCreateFailure(error, userId, workspaceId, stage, observationScope);
  }
}

export async function createWorkspaceForUser(userId: string, name: string): Promise<WorkspaceSummary> {
  return createWorkspaceForUserWithObservationScope(userId, name, null);
}

export async function createWorkspaceForUserWithObservationScope(
  userId: string,
  name: string,
  observationScope: BackendObservationScope | null,
): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => {
    const workspaceId = await createWorkspaceInExecutorWithObservationScope(executor, userId, name, observationScope);
    let stage: WorkspaceCreateFailureStage = "select_workspace";

    try {
      await persistSelectedWorkspaceForUserInExecutor(executor, userId, workspaceId);

      stage = "load_workspace_summary";
      return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
    } catch (error) {
      handleWorkspaceCreateFailure(error, userId, workspaceId, stage, observationScope);
    }
  });
}

export async function createWorkspaceForApiKeyConnection(
  userId: string,
  connectionId: string,
  name: string,
): Promise<WorkspaceSummary> {
  return createWorkspaceForApiKeyConnectionWithObservationScope(userId, connectionId, name, null);
}

export async function createWorkspaceForApiKeyConnectionWithObservationScope(
  userId: string,
  connectionId: string,
  name: string,
  observationScope: BackendObservationScope | null,
): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => {
    const workspaceId = await createWorkspaceInExecutorWithObservationScope(executor, userId, name, observationScope);
    let stage: WorkspaceCreateFailureStage = "select_workspace";

    try {
      await persistSelectedWorkspaceForApiKeyConnectionInExecutor(executor, userId, connectionId, workspaceId);

      stage = "load_workspace_summary";
      return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
    } catch (error) {
      handleWorkspaceCreateFailure(error, userId, workspaceId, stage, observationScope);
    }
  });
}

export async function createWorkspaceForOAuthConnection(
  userId: string,
  connectionId: string,
  name: string,
): Promise<WorkspaceSummary> {
  return createWorkspaceForOAuthConnectionWithObservationScope(userId, connectionId, name, null);
}

export async function createWorkspaceForOAuthConnectionWithObservationScope(
  userId: string,
  connectionId: string,
  name: string,
  observationScope: BackendObservationScope | null,
): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => {
    const workspaceId = await createWorkspaceInExecutorWithObservationScope(executor, userId, name, observationScope);
    let stage: WorkspaceCreateFailureStage = "select_workspace";

    try {
      await persistSelectedWorkspaceForOAuthConnectionInExecutor(executor, userId, connectionId, workspaceId);

      stage = "load_workspace_summary";
      return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
    } catch (error) {
      handleWorkspaceCreateFailure(error, userId, workspaceId, stage, observationScope);
    }
  });
}
