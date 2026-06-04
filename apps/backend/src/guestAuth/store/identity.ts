import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";

type IdentityMappingRow = Readonly<{
  user_id: string;
}>;

export async function loadIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
): Promise<string | null> {
  const result = await executor.query<IdentityMappingRow>(
    [
      "SELECT user_id",
      "FROM auth.user_identities",
      "WHERE provider_type = 'cognito' AND provider_subject = $1",
      "LIMIT 1",
    ].join(" "),
    [providerSubject],
  );

  return result.rows[0]?.user_id ?? null;
}

export async function hasCognitoIdentityMappingForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<boolean> {
  const result = await executor.query<IdentityMappingRow>(
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

export async function bindIdentityMappingInExecutor(
  executor: DatabaseExecutor,
  providerSubject: string,
  userId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    [
      "INSERT INTO auth.user_identities (provider_type, provider_subject, user_id)",
      "VALUES ('cognito', $1, $2)",
      "ON CONFLICT (provider_type, provider_subject) DO NOTHING",
    ].join(" "),
    [providerSubject, userId],
  );
}

export async function updateUserEmailInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  email: string | null,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "UPDATE org.user_settings SET email = $1 WHERE user_id = $2",
    [email, userId],
  );
}
