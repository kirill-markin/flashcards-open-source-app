import type { AuthAttemptBinding, AuthAttemptRequest, AuthProviderSubmission } from "./attemptContract.js";
import { AuthAttemptError, requireAuthHandle } from "./attemptContract.js";
import type { SocialClient } from "./providers.js";

export type NativeSocialClient = Exclude<SocialClient, "web">;
export type NativeSignInBinding = AuthAttemptBinding & Readonly<{ client: NativeSocialClient; purpose: "login" }>;
export type NativeSignInRequest =
  | Readonly<{ action: "provider"; attempt: string; binding: NativeSignInBinding; submission: AuthProviderSubmission }>
  | Readonly<{ action: "mailbox_send"; attempt: string; binding: NativeSignInBinding; email: string }>
  | Readonly<{ action: "mailbox_verify"; attempt: string; binding: NativeSignInBinding; code: string }>
  | Readonly<{ action: "redeem"; completion: string; binding: NativeSignInBinding }>;

type RequestFields = Readonly<Record<string, unknown>>;

export function parseSocialClient(value: unknown): SocialClient {
  if (value !== "web" && value !== "android" && value !== "ios" && value !== "ios-development"
    && value !== "macos" && value !== "macos-development") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return value;
}

export function parseSocialObject(value: unknown): RequestFields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return value as RequestFields;
}

function stringField(fields: RequestFields, key: string, minimum: number, maximum: number): string {
  const value = fields[key];
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return value;
}

function nativeClient(fields: RequestFields): NativeSocialClient {
  const client = parseSocialClient(fields.client);
  if (client === "web" || fields.purpose !== "login") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return client;
}

export function parseNativeAttempt(value: unknown): AuthAttemptRequest & Readonly<{ client: NativeSocialClient; purpose: "login" }> {
  const fields = parseSocialObject(value);
  const client = nativeClient(fields);
  if (fields.provider !== "apple" && fields.provider !== "google") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const codeChallenge = stringField(fields, "codeChallenge", 43, 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return { provider: fields.provider, client, purpose: "login", codeChallenge };
}

export function parseNativeSignIn(value: unknown): NativeSignInRequest {
  const fields = parseSocialObject(value);
  const client = nativeClient(fields);
  const codeVerifier = stringField(fields, "codeVerifier", 43, 128);
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const binding: NativeSignInBinding = { client, purpose: "login", codeVerifier };
  if (fields.action === "redeem") {
    const completion = stringField(fields, "completion", 43, 43);
    requireAuthHandle(completion);
    return { action: "redeem", completion, binding };
  }
  const attempt = stringField(fields, "attempt", 43, 43);
  requireAuthHandle(attempt);
  if (fields.action === "mailbox_send") {
    return { action: "mailbox_send", attempt, binding, email: stringField(fields, "email", 3, 254) };
  }
  if (fields.action === "mailbox_verify") {
    const code = stringField(fields, "code", 6, 8);
    if (!/^[0-9]{6,8}$/.test(code)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    return { action: "mailbox_verify", attempt, binding, code };
  }
  if (fields.action !== "provider" || (fields.provider !== "apple" && fields.provider !== "google")) {
    throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  }
  const identityToken = stringField(fields, "identityToken", 1, 16_384);
  const submission: AuthProviderSubmission = fields.provider === "apple"
    ? { provider: "apple", identityToken, authorizationCode: stringField(fields, "authorizationCode", 1, 4_096) }
    : { provider: "google", identityToken, authorizationCode: null };
  return { action: "provider", attempt, binding, submission };
}
