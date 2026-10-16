import type { ConnectionSuggestion } from "./accountConnectionContract.js";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { AuthAttemptError, requireAuthHandle } from "./attemptContract.js";
import { authHandleHash } from "./attemptStore.js";
import type { EnrolledProviderPrincipal } from "./principalEnrollment.js";
import { SocialProofError } from "./providers.js";
import { parseSocialObject } from "./publicContract.js";
import type { IdentityProvider } from "./identityStore.js";

export type ProviderSignInHint = Readonly<{
  connectionSuggestion?: ConnectionSuggestion;
  method: IdentityProvider;
  recoveryEmail: string;
  providerEmail: string | null;
  emailRelationship: EnrolledProviderPrincipal["emailRelationship"];
}>;
export type EmailSignInHint = Readonly<{ method: "email"; email: string }>;

function hintKey(): Buffer {
  const hex = process.env.SESSION_ENCRYPTION_KEY;
  if (hex === undefined || !/^[0-9a-f]{64}$/i.test(hex)) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  return Buffer.from(hkdfSync("sha256", Buffer.from(hex, "hex"), "nibomo-auth", "social-completion-result-v1", 32));
}

export function createProviderSignInHint(provider: IdentityProvider, enrolled: EnrolledProviderPrincipal): ProviderSignInHint {
  return { method: provider, recoveryEmail: enrolled.method.recoveryEmail,
    providerEmail: enrolled.providerEmail, emailRelationship: enrolled.emailRelationship };
}

export function encryptSignInHint(completion: string, hint: ProviderSignInHint): string {
  requireAuthHandle(completion);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", hintKey(), iv);
  cipher.setAAD(Buffer.from(authHandleHash(completion)));
  const body = Buffer.concat([cipher.update(JSON.stringify(hint), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function parseHint(value: unknown): ProviderSignInHint {
  const hint = parseSocialObject(value);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if ((hint.method !== "apple" && hint.method !== "google")
    || typeof hint.recoveryEmail !== "string" || hint.recoveryEmail.length > 254 || !emailPattern.test(hint.recoveryEmail)
    || (hint.providerEmail !== null && (typeof hint.providerEmail !== "string" || hint.providerEmail.length > 254 || !emailPattern.test(hint.providerEmail)))) {
    throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  }
  const relationship = hint.providerEmail === null ? "missing"
    : hint.providerEmail === hint.recoveryEmail ? "matches_recovery" : "different_from_recovery";
  if (hint.emailRelationship !== relationship) throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  let connectionSuggestion: ConnectionSuggestion | undefined;
  if (hint.connectionSuggestion !== undefined) {
    const suggestion = parseSocialObject(hint.connectionSuggestion);
    if (typeof suggestion.suggestion !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(suggestion.suggestion)
      || typeof suggestion.expiresAt !== "string" || !Number.isFinite(Date.parse(suggestion.expiresAt))) {
      throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
    }
    connectionSuggestion = { suggestion: suggestion.suggestion, expiresAt: suggestion.expiresAt };
  }
  return { ...(connectionSuggestion === undefined ? {} : { connectionSuggestion }),
    method: hint.method, recoveryEmail: hint.recoveryEmail, providerEmail: hint.providerEmail, emailRelationship: relationship };
}

export function decryptSignInHint(completion: string, ciphertext: string): ProviderSignInHint {
  requireAuthHandle(completion);
  const key = hintKey();
  try {
    const [version, iv, tag, body, extra] = ciphertext.split(".");
    if (version !== "v1" || extra !== undefined || iv?.length !== 16 || tag?.length !== 22
      || body === undefined || ciphertext.length > 2048) throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(authHandleHash(completion)));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const value: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8"));
    return parseHint(value);
  } catch {
    throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  }
}
