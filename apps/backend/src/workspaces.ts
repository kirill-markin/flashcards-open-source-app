import { randomUUID } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "./db";
import { HttpError } from "./errors";
import { insertSyncChange } from "./syncChanges";

export const AUTO_CREATED_WORKSPACE_NAME = "Personal";

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
  isSelected: boolean;
}>;

type WorkspaceSummaryRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: Date | string;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

type UserSettingsWorkspaceRow = Readonly<{
  workspace_id: string | null;
}>;

type AgentApiKeySelectionRow = Readonly<{
  connection_id: string;
}>;

type WorkspaceSchedulerSeedRow = Readonly<{
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

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function mapWorkspaceSummary(row: WorkspaceSummaryRow, selectedWorkspaceId: string | null): WorkspaceSummary {
  return {
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: toIsoString(row.created_at),
    isSelected: selectedWorkspaceId === row.workspace_id,
  };
}

function toWorkspaceSchedulerSyncPayloadJson(row: WorkspaceSchedulerSeedRow): string {
  return JSON.stringify({
    algorithm: row.fsrs_algorithm,
    desiredRetention: row.fsrs_desired_retention,
    learningStepsMinutes: row.fsrs_learning_steps_minutes,
    relearningStepsMinutes: row.fsrs_relearning_steps_minutes,
    maximumIntervalDays: row.fsrs_maximum_interval_days,
    enableFuzz: row.fsrs_enable_fuzz,
    clientUpdatedAt: toIsoString(row.fsrs_client_updated_at),
    lastModifiedByDeviceId: row.fsrs_last_modified_by_device_id,
    lastOperationId: row.fsrs_last_operation_id,
    updatedAt: toIsoString(row.fsrs_updated_at),
  });
}

async function ensureUserSettingsRowInExecutor(executor: DatabaseExecutor, userId: string): Promise<void> {
  await executor.query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
}

async function loadWorkspaceSummaryInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  selectedWorkspaceId: string | null,
): Promise<WorkspaceSummary> {
  const result = await executor.query<WorkspaceSummaryRow>(
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return mapWorkspaceSummary(row, selectedWorkspaceId);
}

async function createWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  name: string,
): Promise<string> {
  await ensureUserSettingsRowInExecutor(executor, userId);

  const workspaceId = randomUUID();
  const bootstrapDeviceId = randomUUID();
  const bootstrapTimestamp = new Date().toISOString();
  const bootstrapOperationId = `bootstrap-workspace-${workspaceId}`;

  const workspaceInsertResult = await executor.query<WorkspaceSchedulerSeedRow>(
    [
      "INSERT INTO org.workspaces",
      "(",
      "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_device_id, fsrs_last_operation_id",
      ")",
      "VALUES ($1, $2, $3, $4, $5)",
      "RETURNING",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
    ].join(" "),
    [workspaceId, name, bootstrapTimestamp, bootstrapDeviceId, bootstrapOperationId],
  );
  const workspaceRow = workspaceInsertResult.rows[0];
  if (workspaceRow === undefined) {
    throw new Error("Workspace insert did not return scheduler settings");
  }

  await executor.query(
    [
      "INSERT INTO sync.devices",
      "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
      "VALUES ($1, $2, $3, 'ios', $4, now())",
    ].join(" "),
    [bootstrapDeviceId, workspaceId, userId, "server-bootstrap"],
  );

  await executor.query(
    [
      "INSERT INTO org.workspace_memberships",
      "(workspace_id, user_id, role)",
      "VALUES ($1, $2, 'owner')",
    ].join(" "),
    [workspaceId, userId],
  );

  await insertSyncChange(
    executor,
    workspaceId,
    "workspace_scheduler_settings",
    workspaceId,
    "upsert",
    workspaceRow.fsrs_last_modified_by_device_id,
    workspaceRow.fsrs_last_operation_id,
    toWorkspaceSchedulerSyncPayloadJson(workspaceRow),
  );

  return workspaceId;
}

type UserWorkspaceAccessRow = Readonly<{
  workspace_id: string;
}>;

async function listUserWorkspaceIdsInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<ReadonlyArray<string>> {
  const result = await executor.query<UserWorkspaceAccessRow>(
    [
      "SELECT memberships.workspace_id",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1",
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
    ].join(" "),
    [userId],
  );

  return result.rows.map((row) => row.workspace_id);
}

export async function ensureUserSelectedWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  selectedWorkspaceId: string | null,
): Promise<string> {
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, userId);

  if (workspaceIds.length === 0) {
    const autoCreatedWorkspaceId = await createWorkspaceInExecutor(executor, userId, AUTO_CREATED_WORKSPACE_NAME);
    await executor.query(
      "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
      [autoCreatedWorkspaceId, userId],
    );
    return autoCreatedWorkspaceId;
  }

  if (selectedWorkspaceId !== null && workspaceIds.includes(selectedWorkspaceId)) {
    return selectedWorkspaceId;
  }

  const earliestWorkspaceId = workspaceIds[0];
  if (earliestWorkspaceId === undefined) {
    throw new Error("Expected one accessible workspace");
  }

  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [earliestWorkspaceId, userId],
  );
  return earliestWorkspaceId;
}

async function setSelectedWorkspaceForApiKeyConnectionInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  connectionId: string,
  selectedWorkspaceId: string | null,
): Promise<void> {
  const result = await executor.query<AgentApiKeySelectionRow>(
    [
      "UPDATE auth.agent_api_keys",
      "SET selected_workspace_id = $1",
      "WHERE user_id = $2 AND connection_id = $3 AND revoked_at IS NULL",
      "RETURNING connection_id",
    ].join(" "),
    [selectedWorkspaceId, userId, connectionId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Agent connection not found", "AGENT_API_KEY_NOT_FOUND");
  }
}

export async function setSelectedWorkspaceForApiKeyConnection(
  userId: string,
  connectionId: string,
  selectedWorkspaceId: string | null,
): Promise<void> {
  await transaction(async (executor) => {
    await setSelectedWorkspaceForApiKeyConnectionInExecutor(executor, userId, connectionId, selectedWorkspaceId);
  });
}

export async function listUserWorkspaces(userId: string): Promise<ReadonlyArray<WorkspaceSummary>> {
  const selectionResult = await query<UserSettingsWorkspaceRow>(
    "SELECT workspace_id FROM org.user_settings WHERE user_id = $1",
    [userId],
  );
  const selectedWorkspaceId = selectionResult.rows[0]?.workspace_id ?? null;

  return listUserWorkspacesForSelectedWorkspace(userId, selectedWorkspaceId);
}

export async function listUserWorkspacesForSelectedWorkspace(
  userId: string,
  selectedWorkspaceId: string | null,
): Promise<ReadonlyArray<WorkspaceSummary>> {
  const result = await query<WorkspaceSummaryRow>(
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1",
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
    ].join(" "),
    [userId],
  );

  return result.rows.map((row) => mapWorkspaceSummary(row, selectedWorkspaceId));
}

export async function createWorkspaceForUser(userId: string, name: string): Promise<WorkspaceSummary> {
  return transaction(async (executor) => {
    const workspaceId = await createWorkspaceInExecutor(executor, userId, name);

    await executor.query(
      "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
      [workspaceId, userId],
    );

    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
  });
}

export async function createWorkspaceForApiKeyConnection(
  userId: string,
  connectionId: string,
  name: string,
): Promise<WorkspaceSummary> {
  return transaction(async (executor) => {
    const workspaceId = await createWorkspaceInExecutor(executor, userId, name);
    await setSelectedWorkspaceForApiKeyConnectionInExecutor(executor, userId, connectionId, workspaceId);

    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
  });
}

export async function selectWorkspaceForUser(userId: string, workspaceId: string): Promise<WorkspaceSummary> {
  return transaction(async (executor) => {
    const membershipResult = await executor.query<WorkspaceMembershipRow>(
      [
        "SELECT workspace_id",
        "FROM org.workspace_memberships",
        "WHERE user_id = $1 AND workspace_id = $2",
      ].join(" "),
      [userId, workspaceId],
    );

    if (membershipResult.rows.length === 0) {
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    }

    await executor.query(
      "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
      [workspaceId, userId],
    );

    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
  });
}

export async function selectWorkspaceForApiKeyConnection(
  userId: string,
  connectionId: string,
  workspaceId: string,
): Promise<WorkspaceSummary> {
  return transaction(async (executor) => {
    const membershipResult = await executor.query<WorkspaceMembershipRow>(
      [
        "SELECT workspace_id",
        "FROM org.workspace_memberships",
        "WHERE user_id = $1 AND workspace_id = $2",
      ].join(" "),
      [userId, workspaceId],
    );

    if (membershipResult.rows.length === 0) {
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    }

    await setSelectedWorkspaceForApiKeyConnectionInExecutor(executor, userId, connectionId, workspaceId);

    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
  });
}

export async function assertUserHasWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
  const result = await query<WorkspaceMembershipRow>(
    [
      "SELECT workspace_id",
      "FROM org.workspace_memberships",
      "WHERE user_id = $1 AND workspace_id = $2",
    ].join(" "),
    [userId, workspaceId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }
}

export async function ensureApiKeyWorkspaceSelection(
  userId: string,
  connectionId: string,
  selectedWorkspaceId: string | null,
): Promise<string | null> {
  const workspaces = await listUserWorkspacesForSelectedWorkspace(userId, selectedWorkspaceId);
  const selectedWorkspaceIsAccessible = selectedWorkspaceId !== null
    && workspaces.some((workspace) => workspace.workspaceId === selectedWorkspaceId);

  if (selectedWorkspaceIsAccessible) {
    return selectedWorkspaceId;
  }

  if (workspaces.length === 0) {
    const workspace = await createWorkspaceForApiKeyConnection(userId, connectionId, AUTO_CREATED_WORKSPACE_NAME);
    return workspace.workspaceId;
  }

  if (workspaces.length === 1) {
    const onlyWorkspace = workspaces[0];
    if (onlyWorkspace === undefined) {
      throw new Error("Expected one workspace to exist");
    }

    await setSelectedWorkspaceForApiKeyConnection(userId, connectionId, onlyWorkspace.workspaceId);
    return onlyWorkspace.workspaceId;
  }

  if (selectedWorkspaceId !== null) {
    await setSelectedWorkspaceForApiKeyConnection(userId, connectionId, null);
  }

  return null;
}
