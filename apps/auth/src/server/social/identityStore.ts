import type { DatabaseExecutor } from "../../db.js";

export type IdentityProvider = "apple" | "google";

/** These server-only writes consume proofs verified by the caller; they never provision product rows. */
export async function registerCognitoPrincipalInExecutor(
  executor: DatabaseExecutor,
  subject: string,
  username: string,
): Promise<void> {
  await executor.query("SELECT auth.register_cognito_principal($1, $2)", [subject, username]);
}

export async function bindProvedProviderIdentityInExecutor(
  executor: DatabaseExecutor,
  provider: IdentityProvider,
  providerSubject: string,
  cognitoSubject: string,
): Promise<void> {
  await executor.query("SELECT auth.bind_provider_identity($1, $2, $3)", [provider, providerSubject, cognitoSubject]);
}

export async function recordProvedLoginEmailInExecutor(
  executor: DatabaseExecutor,
  cognitoSubject: string,
  normalizedEmail: string,
  verifiedAt: Date,
): Promise<void> {
  await executor.query("SELECT auth.record_verified_login_email($1, $2, $3)", [cognitoSubject, normalizedEmail, verifiedAt]);
}

export async function loadProviderCognitoSubjectInExecutor(
  executor: DatabaseExecutor,
  provider: IdentityProvider,
  providerSubject: string,
): Promise<string | null> {
  const result = await executor.query<Readonly<{ cognito_subject: string }>>(
    "SELECT cognito_subject FROM auth.provider_identities WHERE provider_type = $1 AND provider_subject = $2",
    [provider, providerSubject],
  );
  return result.rows[0]?.cognito_subject ?? null;
}

/** First identity operation in the transaction; requires fresh current-account and new-identity proofs. */
export async function linkProvedCognitoPrincipalInExecutor(
  executor: DatabaseExecutor,
  currentSubject: string,
  newSubject: string,
): Promise<string> {
  const result = await executor.query<Readonly<{ user_id: string }>>(
    "SELECT auth.link_proved_cognito_principal($1, $2) AS user_id", [currentSubject, newSubject],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Identity linking returned no product account.");
  return row.user_id;
}

export async function loadCognitoPrincipalInExecutor(
  executor: DatabaseExecutor,
  cognitoSubject: string,
): Promise<Readonly<{ cognitoSubject: string; cognitoUsername: string }> | null> {
  const result = await executor.query<Readonly<{ cognito_subject: string; cognito_username: string }>>(
    "SELECT cognito_subject, cognito_username FROM auth.cognito_principals WHERE cognito_subject = $1",
    [cognitoSubject],
  );
  const row = result.rows[0];
  return row === undefined ? null : {
    cognitoSubject: row.cognito_subject,
    cognitoUsername: row.cognito_username,
  };
}

/** First operation before reconnect, method or attempt locks; a changed binding requires restart. */
export async function lockProviderEmailEnrollmentInExecutor(
  executor: DatabaseExecutor, provider: IdentityProvider, providerSubject: string, emailSubject: string | null,
): Promise<string | null> {
  const result = await executor.query<Readonly<{ bound_subject: string | null }>>(
    "SELECT auth.lock_provider_email_enrollment($1,$2,$3) AS bound_subject", [provider, providerSubject, emailSubject],
  );
  if (result.rows[0] === undefined) throw new Error("Provider email enrollment lock returned no result");
  return result.rows[0].bound_subject;
}
