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
  is_automation: boolean;
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
  // The stored automation marker of the installation behind this replica, read here because the
  // merge recreates the replica in the target workspace and makes no declaration of its own. A
  // system actor has no installation and is never automation.
  isAutomation: boolean;
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
    isAutomation: row.is_automation,
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
      "SELECT replicas.replica_id, replicas.actor_kind, replicas.installation_id, replicas.actor_key,",
      "replicas.platform, replicas.app_version, replicas.created_at, replicas.last_seen_at,",
      "COALESCE(installations.is_automation, FALSE) AS is_automation",
      "FROM sync.workspace_replicas AS replicas",
      "LEFT JOIN sync.installations AS installations",
      "ON installations.installation_id = replicas.installation_id",
      "WHERE replicas.workspace_id = $1",
      "ORDER BY replicas.created_at ASC, replicas.replica_id ASC",
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
