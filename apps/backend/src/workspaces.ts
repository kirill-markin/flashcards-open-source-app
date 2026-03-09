import { randomUUID } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "./db";
import { HttpError } from "./errors";

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
  is_selected: boolean;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function mapWorkspaceSummary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return {
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: toIsoString(row.created_at),
    isSelected: row.is_selected,
  };
}

async function loadWorkspaceSummaryInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceSummary> {
  const result = await executor.query<WorkspaceSummaryRow>(
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at,",
      "COALESCE(user_settings.workspace_id = workspaces.workspace_id, false) AS is_selected",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "LEFT JOIN org.user_settings user_settings ON user_settings.user_id = memberships.user_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return mapWorkspaceSummary(row);
}

export async function listUserWorkspaces(userId: string): Promise<ReadonlyArray<WorkspaceSummary>> {
  const result = await query<WorkspaceSummaryRow>(
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at,",
      "COALESCE(user_settings.workspace_id = workspaces.workspace_id, false) AS is_selected",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "LEFT JOIN org.user_settings user_settings ON user_settings.user_id = memberships.user_id",
      "WHERE memberships.user_id = $1",
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
    ].join(" "),
    [userId],
  );

  return result.rows.map(mapWorkspaceSummary);
}

export async function createWorkspaceForUser(userId: string, name: string): Promise<WorkspaceSummary> {
  return transaction(async (executor) => {
    await executor.query(
      "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [userId],
    );

    const workspaceId = randomUUID();
    const bootstrapDeviceId = randomUUID();
    const bootstrapTimestamp = new Date().toISOString();
    const bootstrapOperationId = `bootstrap-workspace-${workspaceId}`;

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

    await executor.query(
      "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
      [workspaceId, userId],
    );

    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId);
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

    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId);
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
