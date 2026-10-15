import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { DatabaseExecutor } from "../../db.js";
import { getDatabaseErrorSqlState } from "../databaseErrors.js";
import { SocialProofError } from "./providers.js";

export type EncryptedAppleCredential = Readonly<{ providerSubject: string; clientId: string; ciphertext: string }>;

export class AppleRevocationPendingError extends Error {
  readonly code = "APPLE_REVOCATION_PENDING";
  constructor() {
    super("Apple revocation is still pending. Wait for cleanup to finish, then start a fresh Apple sign-in.");
    this.name = "AppleRevocationPendingError";
  }
}

export async function assertAppleRevocationClearInExecutor(executor: DatabaseExecutor, providerSubject: string): Promise<void> {
  const result = await executor.query<Readonly<{ pending: boolean }>>(
    "SELECT auth.apple_revocation_pending($1) AS pending", [providerSubject],
  );
  if (result.rows[0] === undefined) throw new Error("Apple revocation status lookup returned no result");
  if (result.rows[0].pending) throw new AppleRevocationPendingError();
}

function credentialKey(): Buffer {
  const hex = process.env.SESSION_ENCRYPTION_KEY;
  if (hex === undefined || !/^[0-9a-f]{64}$/i.test(hex)) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  return Buffer.from(hkdfSync("sha256", Buffer.from(hex, "hex"), "nibomo-auth", "apple-revocation-credential-v1", 32));
}

function credentialAad(providerSubject: string, clientId: string): Buffer {
  return Buffer.from(JSON.stringify(["apple-revocation-credential-v1", providerSubject, clientId]));
}

export function encryptAppleCredential(providerSubject: string, clientId: string, refreshToken: string): EncryptedAppleCredential {
  if (refreshToken.length < 1 || refreshToken.length > 8_192) throw new SocialProofError("PROVIDER_PROOF_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  cipher.setAAD(credentialAad(providerSubject, clientId));
  const encrypted = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  return { providerSubject, clientId, ciphertext: ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".") };
}

export function decryptAppleCredential(credential: EncryptedAppleCredential): string {
  const key = credentialKey();
  try {
    const parts = credential.ciphertext.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || !parts.slice(1).every((part) => /^[A-Za-z0-9_-]+$/.test(part))
      || credential.ciphertext.length > 12_000) throw new Error("Invalid credential envelope");
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid credential envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(credentialAad(credential.providerSubject, credential.clientId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SocialProofError("PROVIDER_CREDENTIAL_INVALID");
  }
}

/** Bind identity first in the same transaction; never persist a client-supplied ciphertext. */
export async function storeAppleCredentialInExecutor(
  executor: DatabaseExecutor, cognitoSubject: string, credential: EncryptedAppleCredential,
): Promise<void> {
  try {
    await executor.query("SELECT auth.store_apple_credential($1, $2, $3, $4)", [
      cognitoSubject, credential.providerSubject, credential.clientId, credential.ciphertext,
    ]);
  } catch (error) {
    if (getDatabaseErrorSqlState(error) === "55006") throw new AppleRevocationPendingError();
    throw error;
  }
}

export async function loadAppleCredentialsInExecutor(
  executor: DatabaseExecutor, cognitoSubject: string,
): Promise<ReadonlyArray<EncryptedAppleCredential>> {
  const result = await executor.query<Readonly<{ provider_subject: string; client_id: string; ciphertext: string }>>(
    "SELECT provider_subject, client_id, ciphertext FROM auth.load_apple_credentials($1)", [cognitoSubject],
  );
  return result.rows.map((row) => ({ providerSubject: row.provider_subject, clientId: row.client_id, ciphertext: row.ciphertext }));
}

/** Owner-only primitive; runtime completion uses the fenced lifecycle job instead. */
export async function deleteRevokedAppleCredentialInExecutor(
  executor: DatabaseExecutor, credential: EncryptedAppleCredential,
): Promise<boolean> {
  const result = await executor.query<Readonly<{ deleted: boolean }>>(
    "SELECT auth.delete_apple_credential($1, $2, $3) AS deleted",
    [credential.providerSubject, credential.clientId, credential.ciphertext],
  );
  if (result.rows[0] === undefined) throw new Error("Apple credential deletion returned no result");
  return result.rows[0].deleted;
}
