import type { DatabaseExecutor } from "../database";
import { HttpError } from "../shared/errors";

export async function assertReplicaBelongsToWorkspaceInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
): Promise<void> {
  const result = await executor.query<Readonly<{ ok: number }>>(
    [
      "SELECT 1 AS ok",
      "FROM sync.workspace_replicas",
      "WHERE workspace_id = $1",
      "AND replica_id = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, replicaId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
}
