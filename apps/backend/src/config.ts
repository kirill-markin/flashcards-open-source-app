import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let resolvedDatabaseUrl: string | undefined;

export async function getDatabaseUrl(): Promise<string> {
  if (resolvedDatabaseUrl) {
    return resolvedDatabaseUrl;
  }

  const secretArn = process.env.DB_SECRET_ARN;
  if (secretArn) {
    const client = new SecretsManagerClient({});
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!response.SecretString) {
      throw new Error("DB secret does not contain SecretString");
    }

    const secret = JSON.parse(response.SecretString) as { username: string; password: string };
    const host = process.env.DB_HOST;
    const dbName = process.env.DB_NAME;
    if (!host || !dbName) {
      throw new Error("DB_HOST and DB_NAME are required when DB_SECRET_ARN is set");
    }

    resolvedDatabaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${dbName}`;
    return resolvedDatabaseUrl;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when DB_SECRET_ARN is not set");
  }

  resolvedDatabaseUrl = process.env.DATABASE_URL;
  return resolvedDatabaseUrl;
}
