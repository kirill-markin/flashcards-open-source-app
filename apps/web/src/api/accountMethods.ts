import { getPreferredAuthUiLocale } from "./authUrls";
import { getAppConfig } from "../config";
import type { AnalyticsAuthCodeRequestOutcome, AnalyticsAuthCodeVerificationOutcome } from "../analytics/events";

export type AccountProvider = "google" | "apple";
export type ProviderTarget = Readonly<{ provider: AccountProvider; providerSubject: string; generation: string }>;
export type ProviderMethod = ProviderTarget & Readonly<{ status: "active" | "disabled"; revocationPending: boolean }>;
export type AccountMethods = Readonly<{ methods: ReadonlyArray<ProviderMethod>; verifiedRecoveryEmails: ReadonlyArray<string>; csrfToken: string }>;
export type MethodProof = Readonly<{ completion: string; csrfToken: string }>;
export type MethodOperation = Readonly<{ kind: "link"; provider: AccountProvider }>
  | Readonly<{ kind: "unlink" | "reenable"; provider: AccountProvider; target: ProviderTarget }>;
export class AccountMethodError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AccountMethodError"; }
}
function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  return value as Readonly<Record<string, unknown>>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  return value;
}
export function accountMethodHandle(value: unknown): string {
  const handle = text(value, 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  return handle;
}
export function parseProviderTarget(value: unknown): ProviderTarget {
  const fields = object(value);
  if (fields.provider !== "google" && fields.provider !== "apple") throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  return { provider: fields.provider, providerSubject: text(fields.providerSubject, 255), generation: text(fields.generation, 64) };
}
export function parseMethodOperation(value: unknown): MethodOperation {
  const fields = object(value);
  if (fields.provider !== "google" && fields.provider !== "apple") throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  if (fields.kind === "link") return { kind: "link", provider: fields.provider };
  if (fields.kind !== "unlink" && fields.kind !== "reenable") throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  const target = parseProviderTarget(fields.target);
  if (target.provider !== fields.provider) throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  return { kind: fields.kind, provider: fields.provider, target };
}
async function request(path: string, fields: Readonly<Record<string, unknown>> | null, signal: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetch(getAppConfig().authBaseUrl + path, { credentials: "include", cache: "no-store", signal,
    ...(fields === null ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }) });
  const result = object(await response.json());
  if (!response.ok) throw new AccountMethodError(typeof result.code === "string" && /^[A-Z_]{1,64}$/.test(result.code)
    ? result.code : "AUTH_ATTEMPT_RESTART_REQUIRED");
  return result;
}
export async function getAccountMethods(signal: AbortSignal): Promise<AccountMethods> {
  const result = await request("/api/account/login-methods?client=web", null, signal);
  if (!Array.isArray(result.methods) || !Array.isArray(result.verifiedRecoveryEmails) || result.emailRecovery !== "read_only") {
    throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  }
  const methods = result.methods.map((value: unknown): ProviderMethod => {
    const method = object(value);
    if ((method.status !== "active" && method.status !== "disabled") || typeof method.revocationPending !== "boolean") {
      throw new AccountMethodError("AUTH_COMPLETION_INVALID");
    }
    return { ...parseProviderTarget(method), status: method.status, revocationPending: method.revocationPending };
  });
  return { methods: [...methods].sort((left, right) => left.provider === right.provider ? 0 : left.provider === "google" ? -1 : 1), verifiedRecoveryEmails: result.verifiedRecoveryEmails.map((value: unknown) => text(value, 254)),
    csrfToken: accountMethodHandle(result.csrfToken) };
}
export async function getBrowserProviders(signal: AbortSignal): Promise<ReadonlyArray<AccountProvider>> {
  const result = await request("/api/auth-methods?client=web", null, signal);
  const methods = object(result.methods);
  return (["google", "apple"] as const).filter((provider) => {
    const method = object(methods[provider]);
    if (typeof method.available !== "boolean") throw new AccountMethodError("AUTH_COMPLETION_INVALID");
    if (method.available && method.transport !== "browser") throw new AccountMethodError("AUTH_COMPLETION_INVALID");
    return method.available;
  });
}
function expiry(value: unknown): number {
  const expiresAt = Date.parse(text(value, 64));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new AccountMethodError("AUTH_ATTEMPT_RESTART_REQUIRED");
  return expiresAt;
}
export async function beginProviderMethod(provider: AccountProvider, csrfToken: string, operation: MethodOperation | null,
  proof: MethodProof | null, redirectUri: string, signal: AbortSignal): Promise<Readonly<{ authorizationUrl: string; expiresAt: number }>> {
  const result = await request("/api/account/provider-methods/link", { action: "begin", client: "web", csrfToken, provider, redirectUri, locale: getPreferredAuthUiLocale(),
    ...(operation === null ? { purpose: "reauth" } : { purpose: "link", intent: operation.kind, proof,
      ...(operation.kind === "reenable" ? { target: operation.target } : {}) }) }, signal);
  const url = new URL(text(result.authorizationUrl, 8192));
  if (url.protocol !== "https:" || url.username !== "" || url.password !== ""
    || (provider === "google" ? url.hostname !== "accounts.google.com" : url.hostname !== "appleid.apple.com")) {
    throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  }
  return { authorizationUrl: url.toString(), expiresAt: expiry(result.expiresAt) };
}
async function requestEmailMethod(fields: Readonly<Record<string, unknown>>, signal: AbortSignal,
  observe: (outcome: AnalyticsAuthCodeRequestOutcome) => void): Promise<Readonly<Record<string, unknown>>> {
  const emailRequest = new Request(getAppConfig().authBaseUrl + "/api/account/reauth/email", {
    method: "POST", credentials: "include", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
  });
  let response: Response;
  try {
    response = await fetch(emailRequest);
  } catch (failure) {
    if (!signal.aborted && failure instanceof Error && failure.name !== "AbortError") {
      if (failure.name === "TimeoutError") observe("timeout");
      else if (failure instanceof TypeError && navigator.onLine === false) observe("offline");
    }
    throw failure;
  }
  // Record the service response before parsing or proof handling can fail.
  if (response.ok) observe("accepted");
  else if (response.status === 429) observe("rate_limited");
  const result = object(await response.json());
  if (!response.ok) {
    const code = typeof result.code === "string" && /^[A-Z_]{1,64}$/.test(result.code) ? result.code : "AUTH_ATTEMPT_RESTART_REQUIRED";
    if (response.status !== 429) {
      if (code === "AUTH_RATE_LIMITED") observe("rate_limited");
      else if (!["AUTH_ATTEMPT_RESTART_REQUIRED", "PRINCIPAL_SIGNOUT_PENDING", "SERVICE_UNAVAILABLE", "SESSION_REQUIRED", "SESSION_REVOKED", "ACCOUNT_DELETED"].includes(code)) {
        if (response.status === 408 || response.status === 504) observe("timeout");
        else if (response.status >= 500) observe("server_error");
      }
    }
    throw new AccountMethodError(code);
  }
  return result;
}
export async function beginEmailMethod(csrfToken: string, signal: AbortSignal,
  observe: (outcome: AnalyticsAuthCodeRequestOutcome) => void): Promise<Readonly<{ attempt: string; expiresAt: number }>> {
  const result = await requestEmailMethod({ action: "begin", client: "web", csrfToken }, signal, observe);
  return { attempt: accountMethodHandle(result.attempt), expiresAt: expiry(result.expiresAt) };
}
export async function completeEmailMethod(csrfToken: string, attempt: string, code: string, signal: AbortSignal,
  observe: (outcome: AnalyticsAuthCodeVerificationOutcome) => void): Promise<Readonly<{ proof: MethodProof; expiresAt: number }>> {
  const result = await requestEmailMethod({ action: "complete", client: "web", csrfToken, attempt, code }, signal,
    (outcome) => observe(outcome === "accepted" ? "verified" : outcome));
  return { proof: { csrfToken, completion: accountMethodHandle(result.completion) }, expiresAt: expiry(result.expiresAt) };
}
export async function unlinkProviderMethod(csrfToken: string, target: ProviderTarget, proof: MethodProof, signal: AbortSignal): Promise<void> {
  const result = await request("/api/account/provider-methods/unlink", { client: "web", csrfToken, target, proof }, signal);
  if (result.ok !== true) throw new AccountMethodError("AUTH_COMPLETION_INVALID");
}

export async function verifyAccountMethodOwner(userId: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(getAppConfig().apiBaseUrl + "/me", { credentials: "include", cache: "no-store", signal });
  if (!response.ok || object(await response.json()).userId !== userId) throw new AccountMethodError("SESSION_REQUIRED");
}
