import type { DatabaseExecutor } from "./db";

function toUniqueSortedWorkspaceIds(workspaceIds: ReadonlyArray<string>): Array<string> {
  return [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right));
}

export async function lockWorkspaceAccessLifecycleInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await executor.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0::bigint))",
    [userId, workspaceId],
  );
}

export async function lockUserWorkspaceAccessLifecyclesInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceIds: ReadonlyArray<string>,
): Promise<void> {
  const sortedWorkspaceIds = toUniqueSortedWorkspaceIds(workspaceIds);

  for (const workspaceId of sortedWorkspaceIds) {
    await lockWorkspaceAccessLifecycleInExecutor(executor, userId, workspaceId);
  }
}
