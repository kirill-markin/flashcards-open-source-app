import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import type {
  SyncClientPlatform,
  WorkspaceReplicaActorKind,
  WorkspaceReplicaPlatform,
} from "../../sync/identity/replica";

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
