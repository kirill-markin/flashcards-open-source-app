import { getDatabaseCredentialsSecret } from "./server/secrets.js";

let resolvedDatabaseUrl: string | undefined;

/**
 * Mirrors the backend database bootstrap so auth routes can persist
 * agent-key state without depending on the backend service process.
 */
export async function getDatabaseUrl(): Promise<string> {
  if (resolvedDatabaseUrl !== undefined) {
    return resolvedDatabaseUrl;
  }

  const secretArn = process.env.DB_SECRET_ARN;
  if (secretArn !== undefined && secretArn !== "") {
    const secret = await getDatabaseCredentialsSecret(secretArn);
    const host = process.env.DB_HOST;
    const dbName = process.env.DB_NAME;
    if (host === undefined || host === "" || dbName === undefined || dbName === "") {
      throw new Error("DB_HOST and DB_NAME are required when DB_SECRET_ARN is set");
    }

    resolvedDatabaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${dbName}`;
    return resolvedDatabaseUrl;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is required when DB_SECRET_ARN is not set");
  }

  resolvedDatabaseUrl = databaseUrl;
  return resolvedDatabaseUrl;
}
