import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

type DatabaseCredentialsSecret = Readonly<{
  username: string;
  password: string;
}>;

const secretsClient = new SecretsManagerClient({});

/**
 * Resolves a plaintext secret string from Secrets Manager.
 */
export async function getPlaintextSecret(secretArn: string): Promise<string> {
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (response.SecretString === undefined || response.SecretString === "") {
    throw new Error(`Secret ${secretArn} does not contain SecretString`);
  }

  return response.SecretString;
}

/**
 * Resolves the shared database username/password pair from Secrets Manager
 * when the auth service runs in AWS.
 */
export async function getDatabaseCredentialsSecret(secretArn: string): Promise<DatabaseCredentialsSecret> {
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (response.SecretString === undefined || response.SecretString === "") {
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
