import {
  getDatabaseCredentialsSecret,
  getDatabaseCredentialsSecretWithAbortSignal,
} from "../aws/secrets";

let resolvedDatabaseUrl: string | undefined;

function validateDatabaseUrlResolution(
  abortSignal: AbortSignal | null,
  deadlineAtMs: number | null,
): void {
  abortSignal?.throwIfAborted();
  if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) {
    throw new Error("Database URL resolution exceeded its absolute deadline.");
  }
}

async function resolveDatabaseUrl(
  abortSignal: AbortSignal | null,
  deadlineAtMs: number | null,
): Promise<string> {
  validateDatabaseUrlResolution(abortSignal, deadlineAtMs);
  if (resolvedDatabaseUrl) {
    return resolvedDatabaseUrl;
  }

  const secretArn = process.env.DB_SECRET_ARN;
  if (secretArn) {
    const secret = abortSignal === null
      ? await getDatabaseCredentialsSecret(secretArn)
      : await getDatabaseCredentialsSecretWithAbortSignal(secretArn, abortSignal);
    validateDatabaseUrlResolution(abortSignal, deadlineAtMs);
    const host = process.env.DB_HOST;
    const dbName = process.env.DB_NAME;
    if (!host || !dbName) {
      throw new Error("DB_HOST and DB_NAME are required when DB_SECRET_ARN is set");
    }

    const databaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${dbName}`;
    validateDatabaseUrlResolution(abortSignal, deadlineAtMs);
    resolvedDatabaseUrl = databaseUrl;
    return resolvedDatabaseUrl;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when DB_SECRET_ARN is not set");
  }

  validateDatabaseUrlResolution(abortSignal, deadlineAtMs);
  resolvedDatabaseUrl = process.env.DATABASE_URL;
  return resolvedDatabaseUrl;
}

export async function getDatabaseUrl(): Promise<string> {
  return resolveDatabaseUrl(null, null);
}

export async function getDatabaseUrlWithAbortSignal(
  abortSignal: AbortSignal,
  deadlineAtMs: number,
): Promise<string> {
  return resolveDatabaseUrl(abortSignal, deadlineAtMs);
}
