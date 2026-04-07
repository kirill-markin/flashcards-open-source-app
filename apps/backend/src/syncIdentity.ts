import { createHash } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "./db";
import { HttpError } from "./errors";

export type SyncClientPlatform = "ios" | "android" | "web";
export type WorkspaceReplicaActorKind =
  | "client_installation"
  | "workspace_seed"
  | "workspace_reset"
  | "agent_connection"
  | "ai_chat";
export type WorkspaceReplicaPlatform = SyncClientPlatform | "system";

type ClaimInstallationStatus =
  | "inserted"
  | "refreshed"
  | "reassigned"
  | "platform_mismatch";

type ClaimInstallationRow = Readonly<{
  claim_status: ClaimInstallationStatus;
  installation_id: string;
  platform: SyncClientPlatform;
  previous_user_id: string | null;
  current_user_id: string;
}>;

type WorkspaceReplicaRow = Readonly<{
  replica_id: string;
  platform: WorkspaceReplicaPlatform;
}>;

type EnsureClientWorkspaceReplicaParams = Readonly<{
  workspaceId: string;
  userId: string;
  installationId: string;
  platform: SyncClientPlatform;
  appVersion: string | null;
}>;

type EnsureSystemWorkspaceReplicaParams = Readonly<{
  workspaceId: string;
  userId: string;
  actorKind: Exclude<WorkspaceReplicaActorKind, "client_installation">;
  actorKey: string;
  platform: WorkspaceReplicaPlatform;
  appVersion: string | null;
}>;

function toUuidFromSeed(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  const baseHex = digest.slice(0, 32).split("");

  baseHex[12] = "5";
  baseHex[16] = ((parseInt(baseHex[16], 16) & 0x3) | 0x8).toString(16);

  return [
    baseHex.slice(0, 8).join(""),
    baseHex.slice(8, 12).join(""),
    baseHex.slice(12, 16).join(""),
    baseHex.slice(16, 20).join(""),
    baseHex.slice(20, 32).join(""),
  ].join("-");
}

function assertNeverClaimStatus(status: never): never {
  throw new Error(`Unsupported installation claim status: ${status}`);
}

export function buildSystemWorkspaceReplicaId(
  workspaceId: string,
  actorKind: Exclude<WorkspaceReplicaActorKind, "client_installation">,
  actorKey: string,
): string {
  return toUuidFromSeed(`${workspaceId}:${actorKind}:${actorKey}`);
}

/**
 * Installations are global physical app/browser identities. They may change
 * users and workspaces over time, but their platform must remain stable.
 */
async function ensureInstallationInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  installationId: string,
  platform: SyncClientPlatform,
  appVersion: string | null,
): Promise<void> {
  const claimResult = await executor.query<ClaimInstallationRow>(
    [
      "SELECT claim_status, installation_id, platform, previous_user_id, current_user_id",
      "FROM sync.claim_installation($1, $2, $3, $4)",
    ].join(" "),
    [installationId, platform, userId, appVersion],
  );

  const claimRow = claimResult.rows[0];
  if (claimRow === undefined) {
    throw new Error("sync.claim_installation returned no rows");
  }

  if (claimRow.claim_status === "platform_mismatch") {
    throw new HttpError(
      409,
      "installationId is already registered with a different platform",
      "SYNC_INSTALLATION_PLATFORM_MISMATCH",
    );
  }

  if (
    claimRow.claim_status === "inserted"
    || claimRow.claim_status === "refreshed"
    || claimRow.claim_status === "reassigned"
  ) {
    return;
  }

  return assertNeverClaimStatus(claimRow.claim_status);
}

async function upsertWorkspaceReplicaInExecutor(
  executor: DatabaseExecutor,
  replicaId: string,
  workspaceId: string,
  userId: string,
  actorKind: WorkspaceReplicaActorKind,
  installationId: string | null,
  actorKey: string | null,
  platform: WorkspaceReplicaPlatform,
  appVersion: string | null,
): Promise<string> {
  const insertResult = await executor.query<WorkspaceReplicaRow>(
    [
      "INSERT INTO sync.workspace_replicas",
      "(",
      "replica_id, workspace_id, user_id, actor_kind, installation_id, actor_key, platform, app_version, last_seen_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())",
      "ON CONFLICT (replica_id) DO NOTHING",
      "RETURNING replica_id, platform",
    ].join(" "),
    [replicaId, workspaceId, userId, actorKind, installationId, actorKey, platform, appVersion],
  );

  if (insertResult.rows.length === 1) {
    return replicaId;
  }

  const updateResult = await executor.query<WorkspaceReplicaRow>(
    [
      "UPDATE sync.workspace_replicas",
      "SET user_id = $3, app_version = $8, last_seen_at = now()",
      "WHERE replica_id = $1",
      "AND workspace_id = $2",
      "AND actor_kind = $4",
      "AND installation_id IS NOT DISTINCT FROM $5",
      "AND actor_key IS NOT DISTINCT FROM $6",
      "AND platform = $7",
      "RETURNING replica_id, platform",
    ].join(" "),
    [replicaId, workspaceId, userId, actorKind, installationId, actorKey, platform, appVersion],
  );

  if (updateResult.rows.length === 1) {
    return replicaId;
  }

  throw new HttpError(
    409,
    "workspace replica identity conflicts with existing sync metadata",
    "SYNC_REPLICA_CONFLICT",
  );
}

/**
 * Client-authenticated sync requests provide only installation identity. The
 * backend derives the immutable workspace replica and stamps it into canonical
 * rows and sync history.
 */
export async function ensureWorkspaceReplicaInExecutor(
  executor: DatabaseExecutor,
  params: EnsureClientWorkspaceReplicaParams,
): Promise<string> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: params.userId,
    workspaceId: params.workspaceId,
  });
  await ensureInstallationInExecutor(
    executor,
    params.userId,
    params.installationId,
    params.platform,
    params.appVersion,
  );

  const replicaId = toUuidFromSeed(`${params.workspaceId}:${params.installationId}`);
  return upsertWorkspaceReplicaInExecutor(
    executor,
    replicaId,
    params.workspaceId,
    params.userId,
    "client_installation",
    params.installationId,
    null,
    params.platform,
    params.appVersion,
  );
}

export async function ensureWorkspaceReplica(
  params: EnsureClientWorkspaceReplicaParams,
): Promise<string> {
  return transactionWithWorkspaceScope(
    { userId: params.userId, workspaceId: params.workspaceId },
    async (executor) => ensureWorkspaceReplicaInExecutor(executor, params),
  );
}

/**
 * Non-client actors never move between workspaces either. Each one gets a
 * deterministic workspace replica keyed by actor kind plus actor-specific key.
 */
export async function ensureSystemWorkspaceReplica(
  params: EnsureSystemWorkspaceReplicaParams,
): Promise<string> {
  const replicaId = buildSystemWorkspaceReplicaId(params.workspaceId, params.actorKind, params.actorKey);

  return transactionWithWorkspaceScope(
    { userId: params.userId, workspaceId: params.workspaceId },
    async (executor) => ensureSystemWorkspaceReplicaInExecutor(executor, params, replicaId),
  );
}

export async function ensureSystemWorkspaceReplicaInExecutor(
  executor: DatabaseExecutor,
  params: EnsureSystemWorkspaceReplicaParams,
  explicitReplicaId?: string,
): Promise<string> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: params.userId,
    workspaceId: params.workspaceId,
  });
  const replicaId = explicitReplicaId ?? buildSystemWorkspaceReplicaId(
    params.workspaceId,
    params.actorKind,
    params.actorKey,
  );

  return upsertWorkspaceReplicaInExecutor(
    executor,
    replicaId,
    params.workspaceId,
    params.userId,
    params.actorKind,
    null,
    params.actorKey,
    params.platform,
    params.appVersion,
  );
}
