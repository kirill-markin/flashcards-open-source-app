import { parseSessionInfoResponse } from "../apiContracts/account";
import { markBrowserReauthRequired } from "../accountDeletion";
import { getAppConfig } from "../config";
import type { SessionInfo } from "../types";
import { buildLoginUrl, getPreferredAuthUiLocale } from "./authUrls";
import { ApiError, ApiNetworkError, AuthRedirectError } from "./errors";
import {
  getJsonErrorMessage,
  isRecoverableSessionCsrfResponse,
  parseContractResponse,
  parseJsonPayload,
  readJsonResponse,
  type ParsedResponsePayload,
} from "./response";

type SessionCsrfState = "unknown" | "session" | "non-session";
export type AuthRecoveryMode = "allow" | "skip";
export type NetworkRetryMode = "none" | "transient";
type NavigateToUrl = (url: string) => void;
type PrepareForAuthRedirect = () => void;
export type RequestOptions = Readonly<{
  authRecoveryMode: AuthRecoveryMode;
  networkRetryMode: NetworkRetryMode;
  prepareForAuthRedirect: PrepareForAuthRedirect | null;
}>;

const refreshSessionEndpoint = "POST /api/refresh-session";
const refreshSessionMaximumAttemptCount = 3;
const refreshSessionBaseRetryDelayMs = 100;
const refreshSessionMaximumRetryDelayMs = 500;
const apiNetworkRetryMaximumAttemptCount = 3;
const apiNetworkRetryBaseDelayMs = 100;
const apiNetworkRetryMaximumDelayMs = 500;
const uuidPathSegmentPattern = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/giu;
const transientRefreshSessionStatusCodes: ReadonlySet<number> = new Set([
  408,
  429,
  500,
  502,
  503,
  504,
]);

let sessionCsrfToken: string | null = null;
let sessionCsrfState: SessionCsrfState = "unknown";
let sessionRecoveryPromise: Promise<void> | null = null;
let sessionRecoveryNetworkRetryMode: NetworkRetryMode | null = null;
let sessionCsrfRecoveryPromise: Promise<void> | null = null;
let sessionCsrfRecoveryNetworkRetryMode: NetworkRetryMode | null = null;
let sessionTransportReadyPromise: Promise<void> | null = null;
let sessionTransportReadyNetworkRetryMode: NetworkRetryMode | null = null;
let redirectInFlight = false;
let navigationHandler: NavigateToUrl | null = null;

/**
 * A terminal browser-auth failure locks warm start until `/me` confirms which
 * account owns the browser. Local IndexedDB data is intentionally preserved.
 */
function prepareForAuthRedirect(): void {
  markBrowserReauthRequired();
}

export const allowAuthRecovery: RequestOptions = {
  authRecoveryMode: "allow",
  networkRetryMode: "none",
  prepareForAuthRedirect,
};

export const allowAuthRecoveryWithTransientNetworkRetry: RequestOptions = {
  authRecoveryMode: "allow",
  networkRetryMode: "transient",
  prepareForAuthRedirect,
};

function createSkipAuthRecoveryOptions(networkRetryMode: NetworkRetryMode): RequestOptions {
  return {
    authRecoveryMode: "skip",
    networkRetryMode,
    prepareForAuthRedirect: null,
  };
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
  navigationHandler = handler;
}

/**
 * Resets the module-scoped auth client state so each test starts with a clean
 * CSRF cache, no active refresh work, and no pending redirect guard.
 */
export function resetApiClientStateForTests(): void {
  sessionCsrfToken = null;
  sessionCsrfState = "unknown";
  sessionRecoveryPromise = null;
  sessionRecoveryNetworkRetryMode = null;
  sessionCsrfRecoveryPromise = null;
  sessionCsrfRecoveryNetworkRetryMode = null;
  sessionTransportReadyPromise = null;
  sessionTransportReadyNetworkRetryMode = null;
  redirectInFlight = false;
  navigationHandler = null;
}

export function getCachedSessionCsrfToken(): string | null {
  return sessionCsrfState === "session" ? sessionCsrfToken : null;
}

export function primeSessionCsrfToken(csrfToken: string): void {
  sessionCsrfToken = csrfToken;
  sessionCsrfState = "session";
}

function setSessionCsrfToken(csrfToken: string | null, authTransport: string): void {
  sessionCsrfToken = csrfToken;
  sessionCsrfState = authTransport === "session" ? "session" : "non-session";
}

/**
 * Clears the in-memory session transport state so no future mutating request
 * can reuse a stale CSRF token after auth recovery fails.
 */
function resetSessionState(): void {
  sessionCsrfToken = null;
  sessionCsrfState = "unknown";
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
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

function createHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);

  if (init.body !== undefined && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (isUnsafeMethod(getMethod(init))) {
    if (sessionCsrfState === "unknown") {
      throw new Error("Session must be loaded before sending mutating requests");
    }

    if (sessionCsrfState === "session") {
      const csrfToken = sessionCsrfToken;
      if (csrfToken === null || csrfToken === "") {
        throw new Error("CSRF token is not loaded for this browser session");
      }

      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  return headers;
}

function readOriginalErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") {
    return error.name;
  }

  return typeof error;
}

function readOriginalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  const errorMessage = String(error);
  return errorMessage.trim() === "" ? "Unknown fetch failure" : errorMessage;
}

function createApiNetworkError(
  pathname: string,
  init: RequestInit,
  error: unknown,
  attemptCount: number,
): ApiNetworkError {
  return new ApiNetworkError({
    endpoint: buildSanitizedRequestEndpoint(pathname, init),
    originalErrorName: readOriginalErrorName(error),
    originalErrorMessage: readOriginalErrorMessage(error),
    attemptCount,
  });
}

function hasRemainingNetworkRetryAttempt(attemptCount: number): boolean {
  return attemptCount < apiNetworkRetryMaximumAttemptCount;
}

function canReuseNetworkRetryPromise(
  activeNetworkRetryMode: NetworkRetryMode | null,
  requestedNetworkRetryMode: NetworkRetryMode,
): boolean {
  return requestedNetworkRetryMode === "none" || activeNetworkRetryMode === "transient";
}

function createApiNetworkRetryDelayMs(attemptCount: number): number {
  const exponentialDelayMs = apiNetworkRetryBaseDelayMs * (2 ** (attemptCount - 1));
  const cappedDelayMs = Math.min(exponentialDelayMs, apiNetworkRetryMaximumDelayMs);
  return Math.floor(Math.random() * cappedDelayMs);
}

function waitForApiNetworkRetry(attemptCount: number): Promise<void> {
  const delayMs = createApiNetworkRetryDelayMs(attemptCount);
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function warnApiTransportRetry(error: ApiNetworkError): void {
  console.warn("API transport retry", {
    endpoint: error.endpoint,
    attemptCount: error.attemptCount,
    maximumAttemptCount: apiNetworkRetryMaximumAttemptCount,
    nextAttemptCount: error.attemptCount + 1,
    originalErrorName: error.originalErrorName,
    originalErrorMessage: error.originalErrorMessage,
  });
}

async function performFetch(pathname: string, init: RequestInit, attemptCount: number): Promise<Response> {
  const config = getAppConfig();
  const headers = createHeaders(init);

  try {
    return await fetch(`${config.apiBaseUrl}${pathname}`, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch (error) {
    throw createApiNetworkError(pathname, init, error, attemptCount);
  }
}

async function performFetchWithNetworkRetry(
  pathname: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<Response> {
  let attemptCount = 1;

  while (true) {
    try {
      return await performFetch(pathname, init, attemptCount);
    } catch (error) {
      if (
        error instanceof ApiNetworkError === false
        || options.networkRetryMode === "none"
        || hasRemainingNetworkRetryAttempt(attemptCount) === false
      ) {
        throw error;
      }

      warnApiTransportRetry(error);
      await waitForApiNetworkRetry(attemptCount);
      attemptCount += 1;
    }
  }
}

function navigateToUrl(url: string): void {
  if (navigationHandler !== null) {
    navigationHandler(url);
    return;
  }

  window.location.href = url;
}

function getCurrentReturnUrl(): string {
  return window.location.href;
}

/**
 * Starts the browser auth redirect flow exactly once per auth failure burst.
 * The current route is preserved so the user returns to the same screen after
 * refresh or interactive sign-in completes on the auth origin.
 */
async function redirectToLogin(prepareForAuthRedirectCallback: PrepareForAuthRedirect | null): Promise<never> {
  const redirectUrl = buildLoginUrl(getCurrentReturnUrl(), getPreferredAuthUiLocale());
  resetSessionState();

  if (prepareForAuthRedirectCallback !== null) {
    prepareForAuthRedirectCallback();
  }

  if (redirectInFlight === false) {
    redirectInFlight = true;
    navigateToUrl(redirectUrl);
  }

  throw new AuthRedirectError(redirectUrl);
}

/**
 * Loads `/me` without attempting another refresh cycle. This function is used
 * only inside auth recovery to ensure a failed refresh cannot recurse forever.
 */
async function loadSessionInfoWithoutRecovery(networkRetryMode: NetworkRetryMode): Promise<SessionInfo> {
  const session = parseContractResponse(
    await requestJson("/me", { method: "GET" }, createSkipAuthRecoveryOptions(networkRetryMode)),
    "GET /me",
    parseSessionInfoResponse,
  );
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  redirectInFlight = false;
  return session;
}

function isTransientRefreshSessionStatus(statusCode: number): boolean {
  return transientRefreshSessionStatusCodes.has(statusCode);
}

function hasRemainingRefreshAttempt(attemptIndex: number): boolean {
  return attemptIndex < refreshSessionMaximumAttemptCount - 1;
}

function createRefreshSessionNetworkError(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError({
    statusCode: 0,
    message: `The auth service is unavailable. Try again. (/api/refresh-session; ${message})`,
    code: null,
    requestId: null,
    endpoint: refreshSessionEndpoint,
    responseBodyKind: "empty",
  });
}

async function createRefreshSessionResponseError(response: Response): Promise<ApiError> {
  const payload = await readJsonResponse(response);
  const fallbackMessage = typeof payload.value === "string" ? payload.value : `Request failed with status ${response.status}`;
  return new ApiError({
    statusCode: response.status,
    message: getJsonErrorMessage(payload.value, fallbackMessage),
    code: payload.code,
    requestId: payload.requestId,
    endpoint: refreshSessionEndpoint,
    responseBodyKind: payload.bodyKind,
  });
}

function createRefreshSessionRetryDelay(attemptIndex: number): number {
  const exponentialDelayMs = refreshSessionBaseRetryDelayMs * (2 ** attemptIndex);
  const cappedDelayMs = Math.min(exponentialDelayMs, refreshSessionMaximumRetryDelayMs);
  return Math.floor(Math.random() * cappedDelayMs);
}

function waitForRefreshSessionRetry(attemptIndex: number): Promise<void> {
  const delayMs = createRefreshSessionRetryDelay(attemptIndex);
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

/**
 * Calls the auth service refresh endpoint with shared cookies and returns
 * `false` only when the refresh token is no longer valid.
 */
async function refreshBrowserSession(): Promise<boolean> {
  const config = getAppConfig();
  let lastNetworkError: ApiError | null = null;

  for (let attemptIndex = 0; attemptIndex < refreshSessionMaximumAttemptCount; attemptIndex += 1) {
    let response: Response;

    try {
      response = await fetch(`${config.authBaseUrl}/api/refresh-session`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      lastNetworkError = createRefreshSessionNetworkError(error);
      if (hasRemainingRefreshAttempt(attemptIndex)) {
        await waitForRefreshSessionRetry(attemptIndex);
        continue;
      }

      throw lastNetworkError;
    }

    if (response.ok) {
      return true;
    }

    if (response.status === 401) {
      resetSessionState();
      return false;
    }

    if (isTransientRefreshSessionStatus(response.status) && hasRemainingRefreshAttempt(attemptIndex)) {
      await waitForRefreshSessionRetry(attemptIndex);
      continue;
    }

    throw await createRefreshSessionResponseError(response);
  }

  if (lastNetworkError !== null) {
    throw lastNetworkError;
  }

  throw new Error("Refresh session retry loop exited without a result");
}

/**
 * Performs a single shared auth recovery operation for all concurrent browser
 * requests that observe the same expired session token.
 */
function shouldRetryAfterWeakerSessionRecovery(error: unknown, options: RequestOptions): boolean {
  return options.networkRetryMode === "transient" && error instanceof ApiNetworkError;
}

function startSessionRecovery(options: RequestOptions): Promise<void> {
  const recoveryTask = (async (): Promise<void> => {
    const refreshed = await refreshBrowserSession();
    if (refreshed === false) {
      await redirectToLogin(options.prepareForAuthRedirect);
    }

    try {
      await loadSessionInfoWithoutRecovery(options.networkRetryMode);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        await redirectToLogin(options.prepareForAuthRedirect);
      }

      throw error;
    }
  })();

  const trackedRecoveryTask = recoveryTask.finally(() => {
    if (sessionRecoveryPromise === trackedRecoveryTask) {
      sessionRecoveryPromise = null;
      sessionRecoveryNetworkRetryMode = null;
    }
  });
  sessionRecoveryPromise = trackedRecoveryTask;
  sessionRecoveryNetworkRetryMode = options.networkRetryMode;

  return sessionRecoveryPromise;
}

async function recoverSession(options: RequestOptions): Promise<void> {
  while (true) {
    const activeRecovery = sessionRecoveryPromise;
    if (
      activeRecovery !== null
      && canReuseNetworkRetryPromise(sessionRecoveryNetworkRetryMode, options.networkRetryMode)
    ) {
      return activeRecovery;
    }

    if (activeRecovery !== null) {
      try {
        await activeRecovery;
        return;
      } catch (error) {
        if (shouldRetryAfterWeakerSessionRecovery(error, options) === false) {
          throw error;
        }

        continue;
      }
    }

    return startSessionRecovery(options);
  }
}

/**
 * Reloads the current session-bound CSRF token after another same-site app has
 * rotated the shared session cookie.
 */
async function recoverSessionCsrf(options: RequestOptions): Promise<void> {
  const activeRecovery = sessionCsrfRecoveryPromise;
  if (
    activeRecovery !== null
    && canReuseNetworkRetryPromise(sessionCsrfRecoveryNetworkRetryMode, options.networkRetryMode)
  ) {
    return activeRecovery;
  }

  const recoveryTask = (async (): Promise<void> => {
    await loadSessionInfoWithRecovery(options);
  })();

  const trackedRecoveryTask = recoveryTask.finally(() => {
    if (sessionCsrfRecoveryPromise === trackedRecoveryTask) {
      sessionCsrfRecoveryPromise = null;
      sessionCsrfRecoveryNetworkRetryMode = null;
    }
  });
  sessionCsrfRecoveryPromise = trackedRecoveryTask;
  sessionCsrfRecoveryNetworkRetryMode = options.networkRetryMode;

  return sessionCsrfRecoveryPromise;
}

async function ensureSessionTransportReadyForUnsafeRequest(options: RequestOptions): Promise<void> {
  if (sessionCsrfState !== "unknown") {
    return;
  }

  if (sessionRecoveryPromise !== null) {
    await recoverSession(options);
    return;
  }

  const activeBootstrap = sessionTransportReadyPromise;
  if (
    activeBootstrap !== null
    && canReuseNetworkRetryPromise(sessionTransportReadyNetworkRetryMode, options.networkRetryMode)
  ) {
    await activeBootstrap;
    return;
  }

  const readinessTask = (async (): Promise<void> => {
    await loadSessionInfoWithRecovery(options);
  })();

  const trackedReadinessTask = readinessTask.finally(() => {
    if (sessionTransportReadyPromise === trackedReadinessTask) {
      sessionTransportReadyPromise = null;
      sessionTransportReadyNetworkRetryMode = null;
    }
  });
  sessionTransportReadyPromise = trackedReadinessTask;
  sessionTransportReadyNetworkRetryMode = options.networkRetryMode;
  await trackedReadinessTask;
}

/**
 * Wraps raw API fetches with a single silent refresh attempt. Every request is
 * allowed one auth recovery and one stale-CSRF recovery, with each retry only
 * running after `/me` has reloaded the current session transport and CSRF token.
 */
async function requestResponse(
  pathname: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<Response> {
  if (isUnsafeMethod(getMethod(init))) {
    await ensureSessionTransportReadyForUnsafeRequest(options);
  }

  let response: Response = await performFetchWithNetworkRetry(pathname, init, options);
  if (options.authRecoveryMode === "skip") {
    return response;
  }

  let didRecoverSession: boolean = false;
  let didRecoverSessionCsrf: boolean = false;
  while (true) {
    if (response.status === 401) {
      if (didRecoverSession) {
        await redirectToLogin(options.prepareForAuthRedirect);
      }

      didRecoverSession = true;
      await recoverSession(options);
      response = await performFetchWithNetworkRetry(pathname, init, options);
      continue;
    }

    if (
      didRecoverSessionCsrf === false
      && isUnsafeMethod(getMethod(init))
      && await isRecoverableSessionCsrfResponse(response)
    ) {
      didRecoverSessionCsrf = true;
      await recoverSessionCsrf(options);
      response = await performFetchWithNetworkRetry(pathname, init, options);
      continue;
    }

    return response;
  }
}

export async function requestJson(
  pathname: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<ParsedResponsePayload> {
  const response = await requestResponse(pathname, init, options);
  return parseJsonPayload(response, buildRequestEndpoint(pathname, init));
}

/**
 * Loads the authenticated browser session from `/me` and refreshes the cached
 * CSRF token when the backend authenticates the request via shared cookies.
 */
export async function getSession(): Promise<SessionInfo> {
  return loadSessionInfoWithRecovery(allowAuthRecovery);
}

/**
 * Revalidates the current browser session without resetting the surrounding
 * UI state. Callers should use this on tab resume before background sync.
 */
export async function revalidateSession(): Promise<SessionInfo> {
  return loadSessionInfoWithRecovery(allowAuthRecovery);
}

/**
 * Loads `/me` through the normal request pipeline so the API layer can recover
 * from one expired session token without forcing a full page reload.
 */
async function loadSessionInfoWithRecovery(options: RequestOptions): Promise<SessionInfo> {
  const session = parseContractResponse(await requestJson("/me", {
    method: "GET",
  }, options), "GET /me", parseSessionInfoResponse);
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  redirectInFlight = false;
  return session;
}
