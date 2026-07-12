import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../database";
import { unsafeQuery } from "../database/unsafe";

export type CognitoIdentityMapping = Readonly<{
  providerSubject: string;
  userId: string;
}>;

type CognitoIdentityMappingRow = Readonly<{
  provider_subject: string;
  user_id: string;
}>;

const loadCognitoIdentityMappingSql = [
  "SELECT provider_subject, user_id",
  "FROM auth.user_identities",
  "WHERE provider_type = 'cognito' AND provider_subject = $1",
  "LIMIT 1",
].join(" ");

function mapCognitoIdentityMapping(row: CognitoIdentityMappingRow): CognitoIdentityMapping {
  return {
    providerSubject: row.provider_subject,
    userId: row.user_id,
  };
}

export class CognitoIdentityMappingConflictError extends Error {
  readonly providerSubject: string;
  readonly requestedUserId: string;
  readonly existingUserId: string;

  constructor(providerSubject: string, requestedUserId: string, existingUserId: string) {
    super(
      `Cognito subject ${providerSubject} is already bound to application user ${existingUserId}; cannot bind it to ${requestedUserId}.`,
    );
    this.name = "CognitoIdentityMappingConflictError";
    this.providerSubject = providerSubject;
    this.requestedUserId = requestedUserId;
    this.existingUserId = existingUserId;
  }
}

/**
 * Serializes one Cognito subject's identity lifecycle. Always acquire this
 * transaction-scoped lock before user-settings, guest-session, or workspace
 * lifecycle locks.
 */
export async function lockCognitoIdentityLifecycleInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
): Promise<void> {
  await executor.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1::text, 2::bigint))",
    [providerSubject],
  );
}

export async function loadCognitoIdentityMapping(
  providerSubject: string,
): Promise<CognitoIdentityMapping | null> {
  const result = await unsafeQuery<CognitoIdentityMappingRow>(
    loadCognitoIdentityMappingSql,
    [providerSubject],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapCognitoIdentityMapping(row);
}

export async function loadCognitoIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
): Promise<CognitoIdentityMapping | null> {
  const result = await executor.query<CognitoIdentityMappingRow>(
    loadCognitoIdentityMappingSql,
    [providerSubject],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapCognitoIdentityMapping(row);
}

/**
 * Inserts an immutable Cognito mapping while the caller owns the subject lock.
 * The resulting row is always reread so an unexpected conflicting writer is
 * surfaced instead of being hidden by ON CONFLICT DO NOTHING.
 */
export async function bindCognitoIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
  userId: string,
): Promise<CognitoIdentityMapping> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    [
      "INSERT INTO auth.user_identities (provider_type, provider_subject, user_id)",
      "VALUES ('cognito', $1, $2)",
      "ON CONFLICT (provider_type, provider_subject) DO NOTHING",
    ].join(" "),
    [providerSubject, userId],
  );

  const mapping = await loadCognitoIdentityMappingInExecutor(executor, providerSubject);
  if (mapping === null) {
    throw new Error(`Failed to load Cognito identity mapping for subject ${providerSubject} after binding.`);
  }
  if (mapping.userId !== userId) {
    throw new CognitoIdentityMappingConflictError(providerSubject, userId, mapping.userId);
  }

  return mapping;
}

export async function hasCognitoIdentityMappingForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<boolean> {
  const result = await executor.query<Readonly<{ user_id: string }>>(
    [
      "SELECT user_id",
      "FROM auth.user_identities",
      "WHERE provider_type = 'cognito' AND user_id = $1",
      "LIMIT 1",
    ].join(" "),
    [userId],
  );

  return result.rows[0] !== undefined;
}
