import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../database";
import { unsafeQuery, unsafeTransactionWithDeadline } from "../database/unsafe";

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

export async function bindCognitoIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
  userId: string,
): Promise<CognitoIdentityMapping> {
  const existing = await loadCognitoIdentityMappingInExecutor(executor, providerSubject);
  if (existing !== null && existing.userId !== userId) {
    throw new CognitoIdentityMappingConflictError(providerSubject, userId, existing.userId);
  }
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "SELECT auth.bind_cognito_account($1, $2)",
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

export async function hasCognitoIdentityMappingForUser(
  userId: string, databaseDeadlineAtMs: number,
): Promise<boolean> {
  return unsafeTransactionWithDeadline(databaseDeadlineAtMs,
    async (executor) => hasCognitoIdentityMappingForUserInExecutor(executor, userId),
  );
}

/** Acquire sorted account locks after all subject locks, before any row lifecycle locks. */
export async function lockAccountLifecyclesInExecutor(
  executor: DatabaseExecutor,
  userIds: ReadonlyArray<string>,
): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) {
    await executor.query("SELECT auth.lock_account_lifecycle($1)", [userId]);
  }
}

/** First identity operation in the transaction. Caller freshly proves both identities; email matching is never proof. */
export async function linkProvedCognitoPrincipalInExecutor(
  executor: DatabaseExecutor,
  currentSubject: string,
  newSubject: string,
): Promise<CognitoIdentityMapping> {
  const result = await executor.query<Readonly<{ user_id: string }>>(
    "SELECT auth.link_proved_cognito_principal($1, $2) AS user_id", [currentSubject, newSubject],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Identity linking returned no product account.");
  return { providerSubject: newSubject, userId: row.user_id };
}
