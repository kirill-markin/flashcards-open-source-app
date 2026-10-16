import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { validateSessionToken } from "../../server/browserSession.js";
import { sign, verify } from "../../server/crypto.js";
import { AuthAttemptError, type AuthAttemptRequest, type AuthAttemptBinding, type AuthReauthenticationBinding } from "../../server/social/attemptContract.js";
import type { AccountMethodProof } from "../../server/social/accountMethods.js";
import { browserAuthOrigin } from "../../server/social/browserState.js";
import { parseAccountNativeAttempt, parseAccountNativeBinding, parseAccountPurpose, parseCompletionHandle, parseSocialObject } from "../../server/social/publicContract.js";

const contextPrefix = "__Host-account_methods_";
type BrowserContext = Readonly<{ token: string; secret: string; origin: string; authOrigin: string; expiresAt: number }>;
export type AccountTransport = Readonly<{ sessionToken: string; browser: BrowserContext | null }>;

export class AccountTransportError extends Error {
  constructor(readonly code: "SESSION_REQUIRED" | "SERVICE_UNAVAILABLE") {
    super(code === "SESSION_REQUIRED" ? "Sign in again before managing sign-in methods." : "Session verification is temporarily unavailable.");
  }
}

export async function requireAccountSession(c: Context<AuthAppEnv>, client: "web" | "native"): Promise<string> {
  const authorization = c.req.header("authorization");
  const sessionToken = client === "web" ? getCookie(c, "session") : authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (sessionToken === undefined || sessionToken.length > 16_384
    || (client === "web" && authorization !== undefined)) throw new AccountTransportError("SESSION_REQUIRED");
  const validation = await validateSessionToken(sessionToken);
  if (validation.status !== "valid") throw new AccountTransportError(validation.status === "invalid" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE");
  return sessionToken;
}

function requestBrowserOrigin(c: Context<AuthAppEnv>): string {
  const origin = c.req.header("origin");
  const authOrigin = browserAuthOrigin(c);
  const allowed = (process.env.ALLOWED_REDIRECT_URIS ?? "").split(",").map((entry) => entry.trim());
  if (origin === undefined || !(origin === authOrigin || allowed.includes(origin))) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return origin;
}

export function createAccountBrowserContext(c: Context<AuthAppEnv>): string {
  const context: BrowserContext = { token: randomBytes(32).toString("base64url"), secret: randomBytes(32).toString("base64url"),
    origin: requestBrowserOrigin(c), authOrigin: browserAuthOrigin(c), expiresAt: Date.now() + 600_000 };
  setCookie(c, contextPrefix + context.token, sign(JSON.stringify(context)),
    { path: "/", secure: true, httpOnly: true, sameSite: "Strict", maxAge: 600 });
  return context.token;
}

function readAccountBrowserContext(c: Context<AuthAppEnv>, token: unknown): BrowserContext {
  const handle = parseCompletionHandle(token);
  const cookie = getCookie(c, contextPrefix + handle);
  if (cookie === undefined || cookie.length > 2000) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  let context: BrowserContext;
  try { context = JSON.parse(verify(cookie)) as BrowserContext; }
  catch { throw new AuthAttemptError("AUTH_ATTEMPT_INVALID"); }
  if (context.token !== handle || context.authOrigin !== browserAuthOrigin(c) || context.origin !== requestBrowserOrigin(c)
    || !Number.isSafeInteger(context.expiresAt) || context.expiresAt <= Date.now()) throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  parseCompletionHandle(context.secret);
  return context;
}

export async function accountTransport(c: Context<AuthAppEnv>, fields: Readonly<Record<string, unknown>>): Promise<AccountTransport> {
  const browser = fields.client === "web" ? readAccountBrowserContext(c, fields.csrfToken) : null;
  return { sessionToken: await requireAccountSession(c, browser === null ? "native" : "web"), browser };
}

export function accountAttempt(fields: Readonly<Record<string, unknown>>, transport: AccountTransport): AuthAttemptRequest {
  if (transport.browser === null) return parseAccountNativeAttempt(fields);
  const purpose = parseAccountPurpose(fields.purpose);
  if ((fields.provider !== "apple" && fields.provider !== "google") || fields.codeChallenge !== undefined) {
    throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  }
  return { provider: fields.provider, client: "web", purpose, codeChallenge: null };
}

export function accountBinding(fields: Readonly<Record<string, unknown>>, transport: AccountTransport, purpose: "reauth" | "link"): AuthAttemptBinding {
  if (transport.browser === null) return parseAccountNativeBinding(fields, purpose);
  return { client: "web", purpose, origin: transport.browser.authOrigin, browserSecret: transport.browser.secret };
}

export function accountProof(c: Context<AuthAppEnv>, fields: Readonly<Record<string, unknown>>, transport: AccountTransport): AccountMethodProof {
  const proof = parseSocialObject(fields.proof);
  const binding = transport.browser === null
    ? parseAccountNativeBinding(proof, "reauth")
    : (() => {
      const original = readAccountBrowserContext(c, proof.csrfToken);
      return { client: "web" as const, purpose: "reauth" as const, origin: original.authOrigin, browserSecret: original.secret };
    })();
  return { completion: parseCompletionHandle(proof.completion), binding: binding as AuthReauthenticationBinding };
}

/** The original browser binding must outlive fresh proofs for committed-result replay. */
export function preserveAccountConnectionContext(c: Context<AuthAppEnv>, original: Omit<BrowserContext, "expiresAt">): void {
  const context: BrowserContext = { ...original, expiresAt: Date.now() + 86_400_000 };
  setCookie(c, contextPrefix + context.token, sign(JSON.stringify(context)),
    { path: "/", secure: true, httpOnly: true, sameSite: "Strict", maxAge: 86_400 });
}

export function preserveAccountLoginContext(c: Context<AuthAppEnv>, token: string, secret: string, redirectUri: string): void {
  parseCompletionHandle(token);
  parseCompletionHandle(secret);
  preserveAccountConnectionContext(c, { token, secret, origin: new URL(redirectUri).origin, authOrigin: browserAuthOrigin(c) });
}
