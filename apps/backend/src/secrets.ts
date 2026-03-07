import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface DatabaseCredentialsSecret {
  username: string;
  password: string;
}

const secretsClient = new SecretsManagerClient({});
let resolvedBackendCsrfSecret: string | undefined;

export async function getDatabaseCredentialsSecret(secretArn: string): Promise<DatabaseCredentialsSecret> {
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
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
