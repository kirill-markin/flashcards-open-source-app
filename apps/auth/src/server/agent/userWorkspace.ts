import { createHash, randomUUID } from "node:crypto";
import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  transaction,
  type DatabaseExecutor,
} from "../../db.js";
import { buildSystemWorkspaceReplicaId } from "../sync/workspaceReplicaId.js";

const AUTO_CREATED_WORKSPACE_NAME = "Personal";

type IdentityMappingRow = Readonly<{
  user_id: string;
}>;

type UserSettingsRow = Readonly<{
  user_id: string;
}>;

type DeletedSubjectRow = Readonly<{
  subject_sha256: string;
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

const selectIdentityMappingSql = [
  "SELECT auth.canonical_account_id(user_id) AS user_id",
  "FROM auth.user_identities",
  "WHERE provider_type = 'cognito' AND provider_subject = $1",
  "LIMIT 1",
].join(" ");

async function resolveCanonicalUserIdInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
): Promise<string | null> {
  const result = await executor.query<IdentityMappingRow>(selectIdentityMappingSql, [providerSubject]);

  return result.rows[0]?.user_id ?? null;
}

/**
 * Serializes one Cognito subject's identity lifecycle against every other path that may create the
 * account behind it. The key text and the seed must stay byte-identical to
 * lockCognitoIdentityLifecycleInExecutor in apps/backend/src/auth/userIdentities.ts: the two
 * services share no code, so this is one lock only for as long as both hash the same string.
 */
async function lockIdentityLifecycleInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
): Promise<void> {
  await executor.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1::text, 2::bigint))",
    [providerSubject],
  );
}

/**
 * Raised when the subject's account was deleted. A Cognito ID token cannot be revoked and outlives
 * the deletion, so the tombstone is what refuses it; the backend answers the same case with
 * 410 ACCOUNT_DELETED (apps/backend/src/auth/deletedSubjects.ts).
 */
export class DeletedSubjectError extends Error {
  constructor() {
    super("This account has already been deleted.");
    this.name = "DeletedSubjectError";
  }
}

/**
 * Must stay byte-identical to hashDeletedSubject in apps/backend/src/auth/deletedSubjects.ts, which
 * writes the tombstones this reads: the two services share no code.
 */
function hashDeletedSubject(providerSubject: string): string {
  return createHash("sha256").update(providerSubject, "utf8").digest("hex");
}

async function assertSubjectIsNotDeletedInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
): Promise<void> {
  const result = await executor.query<DeletedSubjectRow>(
    "SELECT subject_sha256 FROM auth.deleted_subjects WHERE subject_sha256 = $1 LIMIT 1",
    [hashDeletedSubject(providerSubject)],
  );
  if (result.rows.length > 0) {
    throw new DeletedSubjectError();
  }
}

/**
 * Raised when the subject turned out to be bound to another user id between the read and the
 * insert. The transaction that raises it rolls back, so it never leaves a profile behind.
 */
class CognitoIdentityMappingConflictError extends Error {
  constructor(providerSubject: string, requestedUserId: string, existingUserId: string) {
    super(
      `Cognito subject ${providerSubject} is already bound to application user ${existingUserId}; cannot bind it to ${requestedUserId}.`,
    );
    this.name = "CognitoIdentityMappingConflictError";
  }
}

/**
 * Binds the subject while the caller's transaction is open. The row is always reread so a writer
 * that bound the subject first is raised rather than hidden by ON CONFLICT DO NOTHING.
 *
 * Equivalent to bindCognitoIdentityMappingInExecutor in apps/backend/src/auth/userIdentities.ts,
 * restated here because the two services share no code.
 */
async function bindIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
  userId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "SELECT auth.bind_cognito_account($1, $2)",
    [providerSubject, userId],
  );

  const boundUserId = await resolveCanonicalUserIdInExecutor(executor, providerSubject);
  if (boundUserId === null) {
    throw new Error(`Failed to load Cognito identity mapping for subject ${providerSubject} after binding.`);
  }
  if (boundUserId !== userId) {
    throw new CognitoIdentityMappingConflictError(providerSubject, userId, boundUserId);
  }
}

/**
 * Returns the account already bound to the subject, adopts the account stored under the subject
 * itself, or mints a surrogate id for a subject that has never been seen, binding the subject to
 * whichever it is. The lifecycle lock is the first statement, so the read that decides between
 * those three is not racing the backend or the guest flows. Profile and binding share one
 * transaction, so a lost race takes the profile back out with it.
 */
async function createOrAdoptAccountForSubject(
  providerSubject: string,
  email: string,
): Promise<string> {
  return transaction(async (executor) => {
    await lockIdentityLifecycleInExecutor(executor, providerSubject);
    await assertSubjectIsNotDeletedInExecutor(executor, providerSubject);
    // Reread under the lock. The caller's read ran unlocked and may have missed a writer that has
    // committed since; adopting or minting on that stale answer is what gives one person two
    // accounts, and it is also what would make the other paths' bind throw at them.
    const mappedUserId = await resolveCanonicalUserIdInExecutor(executor, providerSubject);
    if (mappedUserId !== null) {
      await executor.query("SELECT auth.lock_account_lifecycle($1)", [mappedUserId]);
      await assertSubjectIsNotDeletedInExecutor(executor, providerSubject);
      return mappedUserId;
    }

    await applyUserDatabaseScopeInExecutor(executor, { userId: providerSubject });
    const adopted = await executor.query<UserSettingsRow>(
      "SELECT user_id FROM org.user_settings WHERE user_id = $1 LIMIT 1",
      [providerSubject],
    );

    if (adopted.rows[0] !== undefined) {
      await bindIdentityMappingInExecutor(executor, providerSubject, providerSubject);
      return providerSubject;
    }

    const mintedUserId = randomUUID();
    await applyUserDatabaseScopeInExecutor(executor, { userId: mintedUserId });
    // Deliberately no ON CONFLICT: a minted id that already names an account must fail here rather
    // than hand this subject that account. The caller's own upsert fills the email in either case.
    await executor.query(
      "INSERT INTO org.user_settings (user_id, email) VALUES ($1, $2)",
      [mintedUserId, email],
    );
    // Profile before mapping: auth.user_identities.user_id references org.user_settings(user_id)
    // (db/migrations/0031_guest_ai_identity_and_quota.sql).
    await bindIdentityMappingInExecutor(executor, providerSubject, mintedUserId);

    return mintedUserId;
  });
}

export async function resolveOrCreateCanonicalUserId(
  providerSubject: string,
  email: string,
): Promise<string> {
  return createOrAdoptAccountForSubject(providerSubject, email);
}

async function createWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<string> {
  const workspaceId = randomUUID();
  const bootstrapReplicaId = buildSystemWorkspaceReplicaId(
    workspaceId,
    "workspace_seed",
    "workspace-seed",
  );
  const bootstrapTimestamp = new Date().toISOString();
  const bootstrapOperationId = `bootstrap-workspace-${workspaceId}`;

  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });

  // The workspace row references the bootstrap replica via a deferred FK, so it
  // is inserted first and validated against the replica row at commit.
  await executor.query(
    [
      "INSERT INTO org.workspaces",
      "(",
      "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id, creation_origin",
      ")",
      "VALUES ($1, $2, $3, $4, $5, 'automatic_starter')",
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
      "ON CONFLICT (replica_id) DO NOTHING",
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
  await executor.query("SELECT auth.lock_account_lifecycle($1)", [userId]);
  await executor.query("SELECT auth.assert_account_live($1)", [userId]);
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
