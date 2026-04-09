import {
  queryWithUserScope,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../db";
import { HttpError } from "../errors";
import {
  createWorkspaceForApiKeyConnection,
  createWorkspaceInExecutor,
} from "./create";
import {
  assertUserHasWorkspaceMembershipInExecutor,
  listUserWorkspaceIdsInExecutor,
  listUserWorkspacesForSelectedWorkspace,
  loadWorkspaceSummaryInExecutor,
} from "./queries";
import { createWorkspaceInvariantError } from "./shared";
import {
  persistSelectedWorkspaceForApiKeyConnectionInExecutor,
  persistSelectedWorkspaceForUserInExecutor,
} from "./state";
import {
  AUTO_CREATED_WORKSPACE_NAME,
  type WorkspaceSummary,
} from "./types";

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

export async function ensureUserSelectedWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  selectedWorkspaceId: string | null,
): Promise<string> {
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, userId);

  if (workspaceIds.length === 0) {
    const autoCreatedWorkspaceId = await createWorkspaceInExecutor(executor, userId, AUTO_CREATED_WORKSPACE_NAME);
    await persistSelectedWorkspaceForUserInExecutor(executor, userId, autoCreatedWorkspaceId);
    return autoCreatedWorkspaceId;
  }

  if (selectedWorkspaceId !== null && workspaceIds.includes(selectedWorkspaceId)) {
    return selectedWorkspaceId;
  }

  const earliestWorkspaceId = workspaceIds[0];
  if (earliestWorkspaceId === undefined) {
    throw createWorkspaceInvariantError(
      "Workspace selection could not be recovered because no accessible workspace was found.",
      "WORKSPACE_SELECTION_RECOVERY_FAILED",
    );
  }

  await persistSelectedWorkspaceForUserInExecutor(executor, userId, earliestWorkspaceId);
  return earliestWorkspaceId;
}

export async function setSelectedWorkspaceForApiKeyConnectionInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  connectionId: string,
  selectedWorkspaceId: string | null,
): Promise<void> {
  if (selectedWorkspaceId !== null) {
    await assertUserHasWorkspaceMembershipInExecutor(executor, userId, selectedWorkspaceId);
  }

  await persistSelectedWorkspaceForApiKeyConnectionInExecutor(
    executor,
    userId,
    connectionId,
    selectedWorkspaceId,
  );
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

export async function selectWorkspaceForUser(userId: string, workspaceId: string): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => {
    await assertUserHasWorkspaceMembershipInExecutor(executor, userId, workspaceId);
    await persistSelectedWorkspaceForUserInExecutor(executor, userId, workspaceId);
    return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, workspaceId);
  });
}

export async function selectWorkspaceForApiKeyConnection(
  userId: string,
  connectionId: string,
  workspaceId: string,
): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => {
    await assertUserHasWorkspaceMembershipInExecutor(executor, userId, workspaceId);
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
      throw createWorkspaceInvariantError(
        "Workspace selection could not be recovered because no workspace was available.",
        "WORKSPACE_SELECTION_RECOVERY_FAILED",
      );
    }

    await setSelectedWorkspaceForApiKeyConnection(userId, connectionId, onlyWorkspace.workspaceId);
    return onlyWorkspace.workspaceId;
  }

  if (selectedWorkspaceId !== null) {
    await setSelectedWorkspaceForApiKeyConnection(userId, connectionId, null);
  }

  return null;
}
