import { randomUUID } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  queryWithUserScope,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "./db";
import { HttpError } from "./errors";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  type CursorPageInput,
} from "./pagination";
import { insertSyncChange } from "./syncChanges";

export const AUTO_CREATED_WORKSPACE_NAME = "Personal";
export const deleteWorkspaceConfirmationText = "delete workspace";

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
  isSelected: boolean;
}>;

export type WorkspaceSummaryPage = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  nextCursor: string | null;
}>;

export type WorkspaceDeletePreview = Readonly<{
  workspaceId: string;
  workspaceName: string;
  activeCardCount: number;
  confirmationText: string;
  isLastAccessibleWorkspace: boolean;
}>;

export type DeleteWorkspaceResult = Readonly<{
  ok: true;
  deletedWorkspaceId: string;
  deletedCardsCount: number;
  workspace: WorkspaceSummary;
}>;

type WorkspaceSummaryRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: Date | string;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

type WorkspaceManagementRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: Date | string;
  role: string;
  member_count: number;
}>;

type ActiveCardCountRow = Readonly<{
  active_card_count: string | number;
}>;

type WorkspacePageCursor = Readonly<{
  createdAt: string;
  workspaceId: string;
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

const maximumWorkspacePageSize = 100;

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

function assertWorkspaceOwner(role: string): void {
  if (role !== "owner") {
    throw new HttpError(403, "Only workspace owners can manage this workspace", "WORKSPACE_OWNER_REQUIRED");
  }
}

function assertWorkspaceIsSoleMember(memberCount: number): void {
  if (memberCount !== 1) {
    throw new HttpError(
      409,
      "This workspace cannot be deleted while it still has multiple members.",
      "WORKSPACE_DELETE_SHARED",
    );
  }
}

function assertDeleteWorkspaceConfirmationText(confirmationText: string): void {
  if (confirmationText !== deleteWorkspaceConfirmationText) {
    throw new HttpError(
      400,
      `Type "${deleteWorkspaceConfirmationText}" exactly to confirm workspace deletion.`,
      "WORKSPACE_DELETE_CONFIRMATION_INVALID",
    );
  }
}

function decodeWorkspacePageCursor(cursor: string): WorkspacePageCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 2) {
    throw new HttpError(400, "cursor does not match the requested workspaces order");
  }

  const createdAt = decodedCursor.values[0];
  const workspaceId = decodedCursor.values[1];
  if (typeof createdAt !== "string" || typeof workspaceId !== "string") {
    throw new HttpError(400, "cursor does not match the requested workspaces order");
  }

  return {
    createdAt,
    workspaceId,
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

async function loadWorkspaceManagementRowInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceManagementRow> {
  const result = await executor.query<WorkspaceManagementRow>(
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at,",
      "memberships.role,",
      "(",
      "SELECT COUNT(*)::int",
      "FROM org.workspace_memberships all_memberships",
      "WHERE all_memberships.workspace_id = memberships.workspace_id",
      ") AS member_count",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
      "FOR UPDATE OF memberships, workspaces",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return row;
}

async function loadActiveCardCountInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  const result = await executor.query<ActiveCardCountRow>(
    [
      "SELECT COUNT(*)::int AS active_card_count",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Active card count query did not return a row");
  }

  return typeof row.active_card_count === "number"
    ? row.active_card_count
    : Number.parseInt(row.active_card_count, 10);
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

  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });

  await executor.query(
    [
      "INSERT INTO org.workspaces",
      "(",
      "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_device_id, fsrs_last_operation_id",
      ")",
      "VALUES ($1, $2, $3, $4, $5)",
    ].join(" "),
    [workspaceId, name, bootstrapTimestamp, bootstrapDeviceId, bootstrapOperationId],
  );

  await executor.query(
    [
      "INSERT INTO org.workspace_memberships",
      "(workspace_id, user_id, role)",
      "VALUES ($1, $2, 'owner')",
    ].join(" "),
    [workspaceId, userId],
  );

  const workspaceResult = await executor.query<WorkspaceSchedulerSeedRow>(
    [
      "SELECT",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
      "FROM org.workspaces",
      "WHERE workspace_id = $1",
    ].join(" "),
    [workspaceId],
  );
  const workspaceRow = workspaceResult.rows[0];
  if (workspaceRow === undefined) {
    throw new Error("Workspace bootstrap could not load scheduler settings");
  }

  await executor.query(
    [
      "INSERT INTO sync.devices",
      "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
      "VALUES ($1, $2, $3, 'ios', $4, now())",
    ].join(" "),
    [bootstrapDeviceId, workspaceId, userId, "server-bootstrap"],
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
  await transactionWithUserScope({ userId }, async (executor) => {
    await setSelectedWorkspaceForApiKeyConnectionInExecutor(executor, userId, connectionId, selectedWorkspaceId);
  });
}

/**
 * Returns the full visible workspace set for internal bootstrap decisions that
 * must reason about the entire collection at once.
 *
 * Keep this helper because `ensureApiKeyWorkspaceSelection()` needs the full
 * set to decide whether to auto-create, auto-select, clear selection, or keep
 * the current selection. Transport-facing API reads should use
 * `listUserWorkspacesPageForSelectedWorkspace()` instead.
 */
export async function listUserWorkspacesForSelectedWorkspace(
  userId: string,
  selectedWorkspaceId: string | null,
): Promise<ReadonlyArray<WorkspaceSummary>> {
  const result = await queryWithUserScope<WorkspaceSummaryRow>(
    { userId },
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

export async function listUserWorkspacesPageForSelectedWorkspace(
  userId: string,
  selectedWorkspaceId: string | null,
  input: CursorPageInput,
): Promise<WorkspaceSummaryPage> {
  if (input.limit < 1 || input.limit > maximumWorkspacePageSize) {
    throw new HttpError(400, `limit must be an integer between 1 and ${maximumWorkspacePageSize}`);
  }

  const decodedCursor = input.cursor === null ? null : decodeWorkspacePageCursor(input.cursor);
  const cursorClause = decodedCursor === null
    ? ""
    : "AND (workspaces.created_at > $2 OR (workspaces.created_at = $2 AND workspaces.workspace_id > $3))";
  const params = decodedCursor === null
    ? [userId, input.limit + 1]
    : [userId, new Date(decodedCursor.createdAt), decodedCursor.workspaceId, input.limit + 1];
  const limitParamIndex = decodedCursor === null ? 2 : 4;

  const result = await queryWithUserScope<WorkspaceSummaryRow>(
    { userId },
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1",
      cursorClause,
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
      `LIMIT $${limitParamIndex}`,
    ].join(" "),
    params,
  );

  const hasNextPage = result.rows.length > input.limit;
  const visibleRows = hasNextPage ? result.rows.slice(0, input.limit) : result.rows;
  const nextRow = hasNextPage ? visibleRows[visibleRows.length - 1] : undefined;

  return {
    workspaces: visibleRows.map((row) => mapWorkspaceSummary(row, selectedWorkspaceId)),
    nextCursor: nextRow === undefined ? null : encodeOpaqueCursor([
      toIsoString(nextRow.created_at),
      nextRow.workspace_id,
    ]),
  };
}

export async function createWorkspaceForUser(userId: string, name: string): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => {
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
  return transactionWithUserScope({ userId }, async (executor) => {
    const workspaceId = await createWorkspaceInExecutor(executor, userId, name);
    await setSelectedWorkspaceForApiKeyConnectionInExecutor(executor, userId, connectionId, workspaceId);

    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
  });
}

export async function renameWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  name: string,
  selectedWorkspaceId: string | null,
): Promise<WorkspaceSummary> {
  const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
  assertWorkspaceOwner(managedWorkspace.role);
  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
  await executor.query(
    "UPDATE org.workspaces SET name = $1 WHERE workspace_id = $2",
    [name, workspaceId],
  );

  return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, selectedWorkspaceId);
}

export async function renameWorkspaceForUser(
  userId: string,
  workspaceId: string,
  name: string,
  selectedWorkspaceId: string | null,
): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => renameWorkspaceInExecutor(
    executor,
    userId,
    workspaceId,
    name,
    selectedWorkspaceId,
  ));
}

export async function loadWorkspaceDeletePreviewInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDeletePreview> {
  const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
  assertWorkspaceOwner(managedWorkspace.role);
  assertWorkspaceIsSoleMember(managedWorkspace.member_count);
  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
  const activeCardCount = await loadActiveCardCountInExecutor(executor, workspaceId);
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, userId);

  return {
    workspaceId,
    workspaceName: managedWorkspace.name,
    activeCardCount,
    confirmationText: deleteWorkspaceConfirmationText,
    isLastAccessibleWorkspace: workspaceIds.length === 1,
  };
}

export async function loadWorkspaceDeletePreviewForUser(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDeletePreview> {
  return transactionWithUserScope({ userId }, async (executor) => loadWorkspaceDeletePreviewInExecutor(
    executor,
    userId,
    workspaceId,
  ));
}

export async function deleteWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  confirmationText: string,
): Promise<DeleteWorkspaceResult> {
  assertDeleteWorkspaceConfirmationText(confirmationText);
  const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
  assertWorkspaceOwner(managedWorkspace.role);
  assertWorkspaceIsSoleMember(managedWorkspace.member_count);
  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
  const deletedCardsCount = await loadActiveCardCountInExecutor(executor, workspaceId);
  await executor.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [workspaceId]);
  const selectedWorkspaceId = await ensureUserSelectedWorkspaceInExecutor(executor, userId, workspaceId);
  const workspace = await loadWorkspaceSummaryInExecutor(executor, userId, selectedWorkspaceId, selectedWorkspaceId);

  return {
    ok: true,
    deletedWorkspaceId: workspaceId,
    deletedCardsCount,
    workspace,
  };
}

export async function deleteWorkspaceForUser(
  userId: string,
  workspaceId: string,
  confirmationText: string,
): Promise<DeleteWorkspaceResult> {
  return transactionWithUserScope({ userId }, async (executor) => deleteWorkspaceInExecutor(
    executor,
    userId,
    workspaceId,
    confirmationText,
  ));
}

export async function selectWorkspaceForUser(userId: string, workspaceId: string): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => {
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
  return transactionWithUserScope({ userId }, async (executor) => {
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
  const result = await queryWithUserScope<WorkspaceMembershipRow>(
    { userId },
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
