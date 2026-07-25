import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface DatabaseCredentialsSecret {
  username: string;
  password: string;
}

const secretsClient = new SecretsManagerClient({});
let resolvedBackendCsrfSecret: string | undefined;
let resolvedBackendChatLiveAuthSecret: string | undefined;

async function loadDatabaseCredentialsSecret(
  secretArn: string,
  abortSignal: AbortSignal | null,
): Promise<DatabaseCredentialsSecret> {
  abortSignal?.throwIfAborted();
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = abortSignal === null
    ? await secretsClient.send(command)
    : await secretsClient.send(command, { abortSignal });
  abortSignal?.throwIfAborted();
  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} does not contain SecretString`);
  }

  const value = JSON.parse(response.SecretString) as Partial<DatabaseCredentialsSecret>;
  if (typeof value.username !== "string" || value.username.trim() === "") {
    throw new Error(`Secret ${secretArn} does not contain a valid username`);
  }

  if (typeof value.password !== "string" || value.password.trim() === "") {
    throw new Error(`Secret ${secretArn} does not contain a valid password`);
  }

  return {
    username: value.username,
    password: value.password,
  };
}

export async function getDatabaseCredentialsSecret(secretArn: string): Promise<DatabaseCredentialsSecret> {
  return loadDatabaseCredentialsSecret(secretArn, null);
}

export async function getDatabaseCredentialsSecretWithAbortSignal(
  secretArn: string,
  abortSignal: AbortSignal,
): Promise<DatabaseCredentialsSecret> {
  return loadDatabaseCredentialsSecret(secretArn, abortSignal);
}

export async function getBackendCsrfSecret(secretArn: string): Promise<string> {
  if (resolvedBackendCsrfSecret !== undefined) {
    return resolvedBackendCsrfSecret;
  }

  // CSRF signing key is immutable for the lifetime of the Lambda process,
  // so caching avoids a Secrets Manager read on every request.
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} does not contain SecretString`);
  }

  const value = response.SecretString.trim();
  if (value === "") {
    throw new Error(`Secret ${secretArn} must not be empty`);
  }

  resolvedBackendCsrfSecret = value;
  return resolvedBackendCsrfSecret;
}

export async function getBackendChatLiveAuthSecret(secretArn: string): Promise<string> {
  if (resolvedBackendChatLiveAuthSecret !== undefined) {
    return resolvedBackendChatLiveAuthSecret;
  }

  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} does not contain SecretString`);
  }

  const value = response.SecretString.trim();
  if (value === "") {
    throw new Error(`Secret ${secretArn} must not be empty`);
  }

  resolvedBackendChatLiveAuthSecret = value;
  return resolvedBackendChatLiveAuthSecret;
}
