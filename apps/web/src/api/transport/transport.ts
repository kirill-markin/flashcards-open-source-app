import { parseSessionInfoResponse } from "../../apiContracts/account";
import { getAppConfig } from "../../config";
import type { SessionInfo } from "../../types";
import {
  ApiNetworkError,
  AuthRedirectError,
  createApiNetworkError,
} from "./errors";
import {
  parseContractResponse,
  parseJsonPayload,
  readBlobResponse,
  type ParsedResponsePayload,
} from "./response";
import {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  createSessionRecovery,
  skipAuthRecoveryWithTransientNetworkRetry,
  skipAuthRecoveryWithoutNetworkRetry,
  type AuthRecoveryMode,
  type NetworkRetryMode,
  type RequestOptions,
} from "./sessionRecovery";
import { waitForTransportDelay } from "./transportSignals";

type NavigateToUrl = (url: string) => void;
type NetworkRequestAttempt<Result> = (attemptCount: number) => Promise<Result>;
export type BlobResponsePayload = Readonly<{
  blob: Blob;
  headers: Headers;
  statusCode: number;
}>;

export {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  skipAuthRecoveryWithTransientNetworkRetry,
  skipAuthRecoveryWithoutNetworkRetry,
};
export type {
  AuthRecoveryMode,
  NetworkRetryMode,
  RequestOptions,
};

export const apiNetworkRetryMaximumAttemptCount = 4;
const apiNetworkRetryBaseDelayMs = 250;
const apiNetworkRetryMaximumDelayMs = 2000;
const uuidPathSegmentPattern = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/giu;

const sessionRecovery = createSessionRecovery(loadSessionInfo);

export function bindIndexedDbOpenRecoverySignal(signal: AbortSignal): () => void {
  return sessionRecovery.bindIndexedDbOpenRecoverySignal(signal);
}

/**
 * Returns `true` when the web API client has already started the auth redirect
 * flow and callers should avoid showing stale in-app error messages.
 */
export function isAuthRedirectError(error: unknown): error is AuthRedirectError {
  return error instanceof AuthRedirectError;
}

/**
 * Installs a navigation delegate for unit tests so auth redirects can be
 * asserted without relying on browser navigation support.
 */
export function setNavigationHandlerForTests(handler: NavigateToUrl | null): void {
  sessionRecovery.setNavigationHandlerForTests(handler);
}

/**
 * Resets the module-scoped auth client state so each test starts with a clean
 * CSRF cache, no active refresh work, and no pending redirect guard.
 */
export function resetApiClientStateForTests(): void {
  sessionRecovery.resetApiClientStateForTests();
}

export function getCachedSessionCsrfToken(): string | null {
  return sessionRecovery.getCachedSessionCsrfToken();
}

export function primeSessionCsrfToken(csrfToken: string): void {
  sessionRecovery.primeSessionCsrfToken(csrfToken);
}

function getMethod(init: RequestInit): string {
  return typeof init.method === "string" && init.method !== "" ? init.method.toUpperCase() : "GET";
}

function buildRequestEndpoint(pathname: string, init: RequestInit): string {
  const pathOnly = pathname.split("?", 1)[0] ?? pathname;
  return `${getMethod(init)} ${pathOnly}`;
}

function sanitizeRequestPath(pathname: string): string {
  const pathOnly = pathname.split("?", 1)[0] ?? pathname;
  return pathOnly.replace(uuidPathSegmentPattern, "/{uuid}");
}

function buildSanitizedRequestEndpoint(pathname: string, init: RequestInit): string {
  return `${getMethod(init)} ${sanitizeRequestPath(pathname)}`;
}

function createBaseHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);

  if (init.body !== undefined && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

function createHeaders(init: RequestInit): Headers {
  return sessionRecovery.createSessionHeaders(createBaseHeaders(init), getMethod(init));
}

function createFetchApiNetworkError(
  pathname: string,
  init: RequestInit,
  error: unknown,
  attemptCount: number,
): ApiNetworkError {
  return createApiNetworkError({
    statusCode: 0,
    requestId: null,
    responseBodyKind: "empty",
    endpoint: buildSanitizedRequestEndpoint(pathname, init),
    error,
    attemptCount,
    source: "fetch",
  });
}

function hasRemainingNetworkRetryAttempt(attemptCount: number): boolean {
  return attemptCount < apiNetworkRetryMaximumAttemptCount;
}

export function createApiNetworkRetryDelayMs(attemptCount: number): number {
  const exponentialDelayMs = apiNetworkRetryBaseDelayMs * (2 ** (attemptCount - 1));
  const cappedDelayMs = Math.min(exponentialDelayMs, apiNetworkRetryMaximumDelayMs);
  return Math.floor(Math.random() * cappedDelayMs);
}

function waitForApiNetworkRetry(
  attemptCount: number,
  signal: AbortSignal | null,
): Promise<void> {
  return waitForTransportDelay(createApiNetworkRetryDelayMs(attemptCount), signal);
}

function warnApiTransportRetry(error: ApiNetworkError): void {
  console.warn("API transport retry", {
    endpoint: error.endpoint,
    attemptCount: error.attemptCount,
    maximumAttemptCount: apiNetworkRetryMaximumAttemptCount,
    nextAttemptCount: error.attemptCount + 1,
    source: error.source,
    statusCode: error.statusCode,
    requestId: error.requestId,
    originalErrorName: error.originalErrorName,
    originalErrorMessage: error.originalErrorMessage,
  });
}

async function performFetch(
  pathname: string,
  init: RequestInit,
  credentials: RequestCredentials,
  attemptCount: number,
): Promise<Response> {
  const config = getAppConfig();
  const headers = createHeaders(init);

  try {
    return await fetch(`${config.apiBaseUrl}${pathname}`, {
      ...init,
      credentials,
      headers,
    });
  } catch (error) {
    sessionRecovery.throwIfRequestAborted(init.signal ?? null);
    throw createFetchApiNetworkError(pathname, init, error, attemptCount);
  }
}

async function performGuestFetch(
  pathname: string,
  init: RequestInit,
  guestToken: string | null,
  attemptCount: number,
): Promise<Response> {
  const config = getAppConfig();
  const headers = createBaseHeaders(init);
  if (guestToken !== null) {
    headers.set("Authorization", `Guest ${guestToken}`);
  }

  try {
    // "omit" keeps the guest token the only credential on the request. A session cookie riding along
    // would be ignored by the backend, which reads the Authorization header first, but leaving the
    // request with exactly one credential is what makes the identity it is attributed to obvious.
    return await fetch(`${config.apiBaseUrl}${pathname}`, {
      ...init,
      credentials: "omit",
      headers,
    });
  } catch (error) {
    sessionRecovery.throwIfRequestAborted(init.signal ?? null);
    throw createFetchApiNetworkError(pathname, init, error, attemptCount);
  }
}

async function performWithNetworkRetry<Result>(
  endpoint: string,
  init: RequestInit,
  options: RequestOptions,
  performAttempt: NetworkRequestAttempt<Result>,
): Promise<Result> {
  let attemptCount = 1;

  while (true) {
    sessionRecovery.throwIfRequestAborted(init.signal ?? null);
    try {
      const result = await performAttempt(attemptCount);
      sessionRecovery.throwIfRequestAborted(init.signal ?? null);
      return result;
    } catch (error) {
      sessionRecovery.throwIfRequestAborted(init.signal ?? null);
      if (
        error instanceof ApiNetworkError === false
        || error.endpoint !== endpoint
        || error.attemptCount !== attemptCount
        || init.signal?.aborted === true
        || options.networkRetryMode === "none"
        || hasRemainingNetworkRetryAttempt(attemptCount) === false
      ) {
        throw error;
      }

      warnApiTransportRetry(error);
      await waitForApiNetworkRetry(attemptCount, init.signal ?? null);
      attemptCount += 1;
    }
  }
}

async function requestResponse(
  pathname: string,
  init: RequestInit,
  options: RequestOptions,
  attemptCount: number,
): Promise<Response> {
  const requestSignal = init.signal ?? null;
  return sessionRecovery.requestResponse(
    getMethod(init),
    buildSanitizedRequestEndpoint(pathname, init),
    requestSignal,
    options,
    attemptCount,
    (): Promise<Response> => performFetch(pathname, init, "include", attemptCount),
  );
}

export async function requestJson(
  pathname: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<ParsedResponsePayload> {
  const { requestInit, dispose: disposeRequestSignal } = sessionRecovery.attachRecoverySignal(init);
  try {
    const endpoint = buildSanitizedRequestEndpoint(pathname, requestInit);
    return await performWithNetworkRetry(endpoint, requestInit, options, async (attemptCount: number) => {
      const response = await requestResponse(pathname, requestInit, options, attemptCount);
      return parseJsonPayload(
        response,
        buildRequestEndpoint(pathname, requestInit),
        {
          attemptCount,
          endpoint,
        },
      );
    });
  } finally {
    disposeRequestSignal();
  }
}

/**
 * Loads public JSON without sending browser credentials. Public API routes use
 * credential-free CORS and intentionally do not participate in auth recovery.
 */
export async function requestPublicJson(pathname: string): Promise<ParsedResponsePayload> {
  const { requestInit, dispose: disposeRequestSignal } = sessionRecovery.attachRecoverySignal({ method: "GET" });
  try {
    const options = skipAuthRecoveryWithTransientNetworkRetry;
    const endpoint = buildSanitizedRequestEndpoint(pathname, requestInit);
    return await performWithNetworkRetry(endpoint, requestInit, options, async (attemptCount: number) => {
      const response = await performFetch(pathname, requestInit, "omit", attemptCount);
      return parseJsonPayload(
        response,
        buildRequestEndpoint(pathname, requestInit),
        {
          attemptCount,
          endpoint,
        },
      );
    });
  } finally {
    disposeRequestSignal();
  }
}

/**
 * Sends one request authenticated by a guest token instead of the shared browser session.
 *
 * The guest token is the whole credential, so the session cookie is deliberately not attached and
 * the session CSRF token — which the backend derives from that cookie — does not apply. This mirrors
 * `apps/backend/src/auth/requestSecurity.ts`, where `enforceSessionCsrfProtection` runs only for the
 * session transport: a header the browser has to be told to send is not an ambient credential a
 * cross-site page could ride on. It is the same shared pipeline as every other call — same base URL,
 * same network retry, same error parsing — rather than a second token mechanism beside it.
 *
 * `guestToken` is null only when creating the guest session itself, which carries no credential yet.
 */
export async function requestGuestJson(
  pathname: string,
  init: RequestInit,
  guestToken: string | null,
  options: RequestOptions,
): Promise<ParsedResponsePayload> {
  const { requestInit, dispose: disposeRequestSignal } = sessionRecovery.attachRecoverySignal(init);
  try {
    const endpoint = buildSanitizedRequestEndpoint(pathname, requestInit);
    return await performWithNetworkRetry(endpoint, requestInit, options, async (attemptCount: number) => {
      const response = await performGuestFetch(pathname, requestInit, guestToken, attemptCount);
      return parseJsonPayload(
        response,
        buildRequestEndpoint(pathname, requestInit),
        {
          attemptCount,
          endpoint,
        },
      );
    });
  } finally {
    disposeRequestSignal();
  }
}

export async function requestBlob(
  pathname: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<BlobResponsePayload> {
  const { requestInit, dispose: disposeRequestSignal } = sessionRecovery.attachRecoverySignal(init);
  try {
    const endpoint = buildRequestEndpoint(pathname, requestInit);
    const sanitizedEndpoint = buildSanitizedRequestEndpoint(pathname, requestInit);
    return await performWithNetworkRetry(sanitizedEndpoint, requestInit, options, async (attemptCount: number) => {
      const response = await requestResponse(pathname, requestInit, options, attemptCount);
      if (!response.ok) {
        await parseJsonPayload(response, endpoint, {
          attemptCount,
          endpoint: sanitizedEndpoint,
        });
        throw new Error(`Non-OK blob response for ${endpoint} did not raise an API error`);
      }

      return {
        blob: await readBlobResponse(response, {
          attemptCount,
          endpoint: sanitizedEndpoint,
        }),
        headers: response.headers,
        statusCode: response.status,
      };
    });
  } finally {
    disposeRequestSignal();
  }
}

/**
 * Loads the authenticated browser session from `/me` and refreshes the cached
 * CSRF token when the backend authenticates the request via shared cookies.
 */
export async function getSession(): Promise<SessionInfo> {
  return sessionRecovery.getSession();
}

export async function getOptionalSession(): Promise<SessionInfo | null> {
  return sessionRecovery.getOptionalSession();
}

/**
 * Revalidates the current browser session without resetting the surrounding
 * UI state. Callers should use this on tab resume before background sync.
 */
export async function revalidateSession(): Promise<SessionInfo> {
  return sessionRecovery.revalidateSession();
}

/**
 * Loads `/me` through the normal request pipeline so the API layer can recover
 * from one expired session token without forcing a full page reload.
 */
async function loadSessionInfo(
  options: RequestOptions,
  signal: AbortSignal | null,
): Promise<SessionInfo> {
  return parseContractResponse(await requestJson("/me", {
    method: "GET",
    ...(signal === null ? {} : { signal }),
  }, options), "GET /me", parseSessionInfoResponse);
}
