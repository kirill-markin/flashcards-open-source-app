/**
 * Shared identity -> workspace resolution used when minting a first-party
 * connection from a freshly verified Cognito ID token. Both the long-lived
 * agent API key flow (agentApiKeys.ts) and the OAuth authorization-code flow
 * (server/oauth/oauthStore.ts) resolve the same canonical user, ensure
 * org.user_settings, and select-or-bootstrap the connection's workspace, so the
 * logic lives here to stay identical across both paths.
 */
import { randomUUID } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  query,
  type DatabaseExecutor,
} from "../../db.js";

const AUTO_CREATED_WORKSPACE_NAME = "Personal";

type IdentityMappingRow = Readonly<{
  user_id: string;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

const upsertUserSettingsSql = [
  "INSERT INTO org.user_settings (user_id, email)",
  "VALUES ($1, $2)",
  "ON CONFLICT (user_id) DO UPDATE",
  "SET email = EXCLUDED.email",
  "WHERE org.user_settings.email IS NULL",
  "AND EXCLUDED.email IS NOT NULL",
].join(" ");

/**
 * Maps a Cognito subject to the canonical org user id via auth.user_identities,
 * falling back to the subject itself when no mapping row exists.
 */
export async function resolveCanonicalUserId(providerSubject: string): Promise<string> {
  const result = await query<IdentityMappingRow>(
    [
      "SELECT user_id",
      "FROM auth.user_identities",
      "WHERE provider_type = 'cognito' AND provider_subject = $1",
      "LIMIT 1",
    ].join(" "),
    [providerSubject],
  );

  return result.rows[0]?.user_id ?? providerSubject;
}

async function createWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<string> {
  const workspaceId = randomUUID();
  const bootstrapReplicaId = randomUUID();
  const bootstrapTimestamp = new Date().toISOString();
  const bootstrapOperationId = `bootstrap-workspace-${workspaceId}`;

  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });

  // The workspace row references the bootstrap replica via a deferred FK, so it
  // is inserted first and validated against the replica row at commit.
  await executor.query(
    [
      "INSERT INTO org.workspaces",
      "(",
      "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id",
      ")",
      "VALUES ($1, $2, $3, $4, $5)",
    ].join(" "),
    [workspaceId, AUTO_CREATED_WORKSPACE_NAME, bootstrapTimestamp, bootstrapReplicaId, bootstrapOperationId],
  );

  await executor.query(
    [
      "INSERT INTO org.workspace_memberships",
      "(workspace_id, user_id, role)",
      "VALUES ($1, $2, 'owner')",
    ].join(" "),
    [workspaceId, userId],
  );

  // Seed the workspace replica that owns the bootstrap scheduler-settings row,
  // mirroring the canonical backend workspace seed (org.workspaces ->
  // sync.workspace_replicas as the LWW actor).
  await executor.query(
    [
      "INSERT INTO sync.workspace_replicas",
      "(",
      "replica_id, workspace_id, user_id, actor_kind, actor_key, platform, app_version, last_seen_at",
      ")",
      "VALUES ($1, $2, $3, 'workspace_seed', 'workspace-seed', 'system', $4, now())",
    ].join(" "),
    [bootstrapReplicaId, workspaceId, userId, "server-bootstrap"],
  );

  return workspaceId;
}

/**
 * Ensures org.user_settings for the user and resolves the workspace a new
 * connection should be scoped to: the only existing workspace when there is
 * exactly one, an auto-created Personal workspace when there are none, or null
 * (unscoped, caller must select later) when the user belongs to several.
 *
 * Must run inside a user-scoped transaction so the workspace bootstrap and the
 * caller's connection insert share one atomic unit.
 */
export async function ensureUserSettingsAndSelectWorkspace(
  executor: DatabaseExecutor,
  userId: string,
  email: string,
): Promise<string | null> {
  await executor.query(upsertUserSettingsSql, [userId, email]);

  const membershipResult = await executor.query<WorkspaceMembershipRow>(
    [
      "SELECT workspace_id",
      "FROM org.workspace_memberships",
      "WHERE user_id = $1",
      "ORDER BY created_at ASC, workspace_id ASC",
    ].join(" "),
    [userId],
  );

  if (membershipResult.rows.length === 0) {
    return createWorkspaceInExecutor(executor, userId);
  }

  if (membershipResult.rows.length === 1) {
    const onlyWorkspace = membershipResult.rows[0];
    if (onlyWorkspace === undefined) {
      throw new Error("Expected one workspace membership row");
    }
    return onlyWorkspace.workspace_id;
  }

  return null;
}
