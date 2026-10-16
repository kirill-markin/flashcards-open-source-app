import type { AuthAttemptBinding, AuthAttemptRequest, AuthProviderSubmission } from "./attemptContract.js";
import { AuthAttemptError, requireAuthHandle } from "./attemptContract.js";
import type { AccountProviderMethod, AccountProviderMethodTarget } from "./accountMethods.js";
import type { SocialClient } from "./providers.js";

export type NativeSocialClient = Exclude<SocialClient, "web">;
export type NativeSignInBinding = AuthAttemptBinding & Readonly<{ client: NativeSocialClient; purpose: "login" }>;
export type SignInContinuationRequest =
  | Readonly<{ action: "mailbox_send"; attempt: string; binding: AuthAttemptBinding & Readonly<{ purpose: "login" }>; email: string }>
  | Readonly<{ action: "mailbox_verify"; attempt: string; binding: AuthAttemptBinding & Readonly<{ purpose: "login" }>; code: string }>
  | Readonly<{ action: "redeem"; completion: string; binding: AuthAttemptBinding & Readonly<{ purpose: "login" }> }>;
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

export type AccountProviderContinuation =
  | Readonly<{ action: "provider"; attempt: string; binding: AuthAttemptBinding; submission: AuthProviderSubmission }>
  | Readonly<{ action: "mailbox_send"; attempt: string; binding: AuthAttemptBinding; email: string }>
  | Readonly<{ action: "mailbox_verify"; attempt: string; binding: AuthAttemptBinding; code: string }>;

export function parseAccountPurpose(value: unknown): "reauth" | "link" {
  if (value !== "reauth" && value !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return value;
}

export function parseAccountNativeAttempt(value: unknown): AuthAttemptRequest {
  const fields = parseSocialObject(value);
  const purpose = parseAccountPurpose(fields.purpose);
  return { ...parseNativeAttempt({ ...fields, purpose: "login" }), purpose };
}

export function parseAccountNativeBinding(value: unknown, purpose: "reauth" | "link"): AuthAttemptBinding {
  const fields = parseSocialObject(value);
  const client = parseSocialClient(fields.client);
  if (client === "web") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const codeVerifier = stringField(fields, "codeVerifier", 43, 128);
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return { client, purpose, codeVerifier };
}

export function parseAccountProviderContinuation(value: unknown): AccountProviderContinuation {
  const fields = parseSocialObject(value);
  const purpose = parseAccountPurpose(fields.purpose);
  const parsed = parseNativeSignIn({ ...fields, purpose: "login" });
  if (parsed.action === "redeem") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return { ...parsed, binding: { ...parsed.binding, purpose } };
}

export function parseProviderTarget(value: unknown): AccountProviderMethodTarget {
  const fields = parseSocialObject(value);
  if (fields.provider !== "apple" && fields.provider !== "google") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const generation = stringField(fields, "generation", 1, 64);
  if (!Number.isFinite(Date.parse(generation))) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return { provider: fields.provider, providerSubject: stringField(fields, "providerSubject", 1, 255), generation };
}

export function parseCompletionHandle(value: unknown): string {
  if (typeof value !== "string") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  requireAuthHandle(value);
  return value;
}

export type AccountProofInput =
  | Readonly<{ completion: string; client: NativeSocialClient; codeVerifier: string }>
  | Readonly<{ completion: string; csrfToken: string }>;
export type AccountProviderAttemptInput =
  | Readonly<{ action: "begin"; client: NativeSocialClient; codeChallenge: string; provider: "apple" | "google" }> & (
    Readonly<{ purpose: "reauth" }>
    | Readonly<{ purpose: "link"; intent: "link"; proof: AccountProofInput }>
    | Readonly<{ purpose: "link"; intent: "reenable"; target: AccountProviderMethodTarget; proof: AccountProofInput }>)
  | Readonly<{ action: "begin"; client: "web"; csrfToken: string; redirectUri: string; provider: "apple" | "google" }> & (
    Readonly<{ purpose: "reauth" }>
    | Readonly<{ purpose: "link"; intent: "link"; proof: AccountProofInput }>
    | Readonly<{ purpose: "link"; intent: "reenable"; target: AccountProviderMethodTarget; proof: AccountProofInput }>);
export type AccountProviderAttemptResult =
  | Readonly<import("./attemptContract.js").AuthAttemptResponse & { browserStart: string | null }>
  | Readonly<{ authorizationUrl: string; expiresAt: string }>;
export type AccountLoginMethodsResult = Readonly<{
  methods: ReadonlyArray<AccountProviderMethod>;
  verifiedRecoveryEmails: ReadonlyArray<string>;
  reauthenticationEmail: string | null;
  emailRecovery: "read_only";
  csrfToken: string | null;
}>;
export type AccountUnlinkInput = Readonly<{
  client: SocialClient; csrfToken?: string; target: AccountProviderMethodTarget; proof: AccountProofInput;
}>;
export type AccountCurrentEmailInput =
  | Readonly<{ action: "begin"; client: NativeSocialClient; codeChallenge: string }>
  | Readonly<{ action: "complete"; client: NativeSocialClient; codeVerifier: string; attempt: string; code: string }>
  | Readonly<{ action: "begin"; client: "web"; csrfToken: string }>
  | Readonly<{ action: "complete"; client: "web"; csrfToken: string; attempt: string; code: string }>;

export type AccountCurrentEmailResult = import("./attemptContract.js").EmailAuthAttemptResponse
  | import("./attemptContract.js").AuthCompletionResponse;

// The original proof binding belongs to the initiating reauth request; a new link has its own PKCE/browser binding.
export type AccountNativeCompletionInput =
  | Readonly<{ client: NativeSocialClient; purpose: "link" | "reauth"; codeVerifier: string }> & (
    Readonly<{ action: "provider" | "reenable_provider"; attempt: string }> & (
      Readonly<{ provider: "apple"; identityToken: string; authorizationCode: string }>
      | Readonly<{ provider: "google"; identityToken: string }>)
    | Readonly<{ action: "mailbox_send"; attempt: string; email: string }>
    | Readonly<{ action: "mailbox_verify"; attempt: string; code: string }>)
  | Readonly<{ client: NativeSocialClient; purpose: "link"; codeVerifier: string; action: "redeem"; completion: string }>
  | Readonly<{ client: "android"; purpose: "link"; codeVerifier: string; action: "resume_reenable"; attempt: string }>;

export type AccountProviderLinkCompleteInput = Readonly<{
  action: "complete"; client: NativeSocialClient; purpose: "link"; codeVerifier: string; completion: string;
}>;
