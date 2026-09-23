import { createHash } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import { declareContentWriteReplicaFacts } from "../../productAnalytics/serverFacts/contentWrites";
import { HttpError } from "../../shared/errors";
import { lockWorkspaceAccessLifecycleInExecutor } from "../../workspaces/accessLocks";

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
  // The automation marker as the claimed row already stored it, read under the same FOR UPDATE that
  // claims it (db/migrations/0141_sync_installation_automation_marker.sql). It is what makes an
  // earlier declaration outlive the requests that say nothing.
  is_automation: boolean;
}>;

type WorkspaceReplicaRow = Readonly<{
  replica_id: string;
  platform: WorkspaceReplicaPlatform;
}>;

type WorkspaceAccessLockRow = Readonly<{
  workspace_id: string;
}>;

type MarkedInstallationRow = Readonly<{
  installation_id: string;
}>;

type EnsureClientWorkspaceReplicaParams = Readonly<{
  workspaceId: string;
  userId: string;
  installationId: string;
  platform: SyncClientPlatform;
  appVersion: string | null;
  // This installation runs under automation, so nothing it does is product analytics. `true` is a
  // claim that is also stored, and `false` is the absence of a claim rather than a denial of one:
  // the stored marker is never cleared, so a request that says nothing leaves an earlier claim
  // standing.
  isAutomation: boolean;
}>;

type EnsureSystemWorkspaceReplicaParams = Readonly<{
  workspaceId: string;
  userId: string;
  actorKind: Exclude<WorkspaceReplicaActorKind, "client_installation">;
  actorKey: string;
  platform: WorkspaceReplicaPlatform;
  appVersion: string | null;
  signal: AbortSignal | null;
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
 *
 * Returns the automation marker this installation carries once the request is accounted for:
 * `stored OR declared`. The stored side is what the claim just read back, so a client that declared
 * automation when it registered and declares nothing afterwards is still automation on every later
 * request - the same answer the drain would reach by reading sync.installations itself, which is why
 * the caller may declare it to the content writes producer instead.
 */
async function ensureInstallationInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  installationId: string,
  platform: SyncClientPlatform,
  appVersion: string | null,
  isAutomation: boolean,
): Promise<boolean> {
  const claimResult = await executor.query<ClaimInstallationRow>(
    [
      "SELECT claim_status, installation_id, platform, previous_user_id, current_user_id, is_automation",
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
    if (claimRow.is_automation) {
      return true;
    }

    if (isAutomation) {
      await markInstallationAutomationInExecutor(executor, installationId);
      return true;
    }

    return false;
  }

  return assertNeverClaimStatus(claimRow.claim_status);
}

/**
 * Stores the client's own declaration that this installation runs under automation.
 *
 * Runs only on the transition: the claim above already returned the stored marker, so a request that
 * declares nothing and a request that repeats a declaration already stored both skip this and leave
 * every ordinary sync request - pushes and pulls alike - with no row write and no row lock of its
 * own.
 *
 * The statement can only ever set the marker, never clear it, which is the whole of the rule that an
 * installation that ran automation once is never reported as a person afterwards. It runs after the
 * claim above, which has already made the row the requesting identity's own, so the runtime update
 * policy on sync.installations reaches it (installations_scoped_update_runtime,
 * db/migrations/0035_sync_installations_and_workspace_replicas.sql). A row it does not reach is a
 * broken invariant of that ordering rather than a marker that may be skipped, so it raises instead
 * of returning quietly and letting a declaring installation keep producing analytics.
 */
async function markInstallationAutomationInExecutor(
  executor: DatabaseExecutor,
  installationId: string,
): Promise<void> {
  const result = await executor.query<MarkedInstallationRow>(
    [
      "UPDATE sync.installations",
      "SET is_automation = TRUE",
      "WHERE installation_id = $1",
      "RETURNING installation_id",
    ].join(" "),
    [installationId],
  );

  if (result.rows[0] === undefined) {
    throw new Error(
      `sync.installations row ${installationId} was not reachable for the automation marker`,
    );
  }
}

/**
 * Writes the replica row for one workspace actor, and names the platform behind it for the content
 * creations the same transaction goes on to write.
 *
 * Both branches pin actor_kind and platform - the insert writes them, the update matches on them and
 * refuses a row that disagrees with either - so on success those two facts are known of the stored
 * row rather than assumed of it, which is what makes declaring them sound. See
 * declareContentWriteReplicaFacts.
 *
 * The automation marker travels with them for the same reason: the caller passes the marker the
 * installation it just claimed really carries - what the claim read back, with this request's own
 * declaration folded in - so it is known of the stored row rather than assumed of it too.
 *
 * A declaration is live only in a transaction opened through one of the reporting wrappers in
 * ../../productAnalytics/serverFacts/contentWrites.ts, and dies with the executor it is keyed on
 * anywhere else. There it answers for every creation stamped with this replica id - today every card
 * and deck the transaction writes, for the three that ensure a replica here: the sync push
 * (../replication/push.ts), the sync bootstrap push (../replication/bootstrap.ts) and the guest
 * upgrade merge (../../guestAuth/merge/index.ts). ../replication/hotPull.ts and
 * ../replication/reviewHistory.ts ensure replicas in transactions that create no cards or decks, so
 * wiring either through a reporting wrapper means re-checking that.
 */
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
  isAutomation: boolean,
  signal: AbortSignal | null,
): Promise<string> {
  signal?.throwIfAborted();
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
  signal?.throwIfAborted();

  if (insertResult.rows.length === 1) {
    declareContentWriteReplicaFacts(executor, replicaId, { actorKind, platform, isAutomation });
    return replicaId;
  }

  signal?.throwIfAborted();
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
  signal?.throwIfAborted();

  if (updateResult.rows.length === 1) {
    declareContentWriteReplicaFacts(executor, replicaId, { actorKind, platform, isAutomation });
    return replicaId;
  }

  throw new HttpError(
    409,
    "workspace replica identity conflicts with existing sync metadata",
    "SYNC_REPLICA_CONFLICT",
  );
}

async function lockWorkspaceAccessInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  signal: AbortSignal | null,
): Promise<void> {
  signal?.throwIfAborted();
  await lockWorkspaceAccessLifecycleInExecutor(executor, userId, workspaceId);
  signal?.throwIfAborted();

  const result = await executor.query<WorkspaceAccessLockRow>(
    [
      "SELECT workspaces.workspace_id",
      "FROM org.workspaces AS workspaces",
      "WHERE security.current_user_id() = $1",
      "AND workspaces.workspace_id = $2",
      "AND security.user_has_workspace_access(workspaces.workspace_id)",
      "FOR KEY SHARE OF workspaces",
    ].join(" "),
    [userId, workspaceId],
  );
  signal?.throwIfAborted();

  if (result.rows[0] === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }
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
  await lockWorkspaceAccessInExecutor(executor, params.userId, params.workspaceId, null);
  // The stored marker, this request's declaration folded into it. Declaring params.isAutomation here
  // instead would let a request that says nothing report an installation that already claimed
  // automation as a person's, because a declared replica is never read back from storage.
  const isAutomation = await ensureInstallationInExecutor(
    executor,
    params.userId,
    params.installationId,
    params.platform,
    params.appVersion,
    params.isAutomation,
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
    isAutomation,
    null,
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
  params.signal?.throwIfAborted();
  const replicaId = await transactionWithWorkspaceScope(
    { userId: params.userId, workspaceId: params.workspaceId },
    async (executor) => ensureSystemWorkspaceReplicaInExecutor(executor, params),
  );
  params.signal?.throwIfAborted();
  return replicaId;
}

export async function ensureSystemWorkspaceReplicaInExecutor(
  executor: DatabaseExecutor,
  params: EnsureSystemWorkspaceReplicaParams,
): Promise<string> {
  params.signal?.throwIfAborted();
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: params.userId,
    workspaceId: params.workspaceId,
  });
  params.signal?.throwIfAborted();
  await lockWorkspaceAccessInExecutor(
    executor,
    params.userId,
    params.workspaceId,
    params.signal,
  );
  params.signal?.throwIfAborted();

  const replicaId = buildSystemWorkspaceReplicaId(
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
    // A system actor has no installation behind it, so there is nothing that could have declared
    // automation: workspace_replicas_client_installation_shape holds installation_id NULL here.
    false,
    params.signal,
  );
}

export async function ensureBootstrapSystemWorkspaceReplicaInExecutor(
  executor: DatabaseExecutor,
  params: EnsureSystemWorkspaceReplicaParams,
  replicaId: string,
): Promise<string> {
  params.signal?.throwIfAborted();
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: params.userId,
    workspaceId: params.workspaceId,
  });
  params.signal?.throwIfAborted();

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
    // A system actor has no installation behind it, so there is nothing that could have declared
    // automation: workspace_replicas_client_installation_shape holds installation_id NULL here.
    false,
    params.signal,
  );
}
