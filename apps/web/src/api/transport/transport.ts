import { parseSessionInfoResponse } from "../../apiContracts/account";
import { markBrowserReauthRequired } from "../../accountDeletion";
import { getAppConfig } from "../../config";
import type { SessionInfo } from "../../types";
import { buildLoginUrl, getPreferredAuthUiLocale } from "../authUrls";
import {
  ApiError,
  ApiNetworkError,
  AuthRedirectError,
  createApiNetworkError,
} from "./errors";
import {
  getJsonErrorMessage,
  isRecoverableSessionCsrfResponse,
  parseContractResponse,
  parseJsonPayload,
  readBlobResponse,
  readJsonResponse,
  type ParsedResponsePayload,
} from "./response";

type SessionCsrfState = "unknown" | "session" | "non-session";
type RefreshBrowserSessionResult = "refreshed" | "reconciled" | "unauthorized";
export type AuthRecoveryMode = "allow" | "skip";
export type NetworkRetryMode = "none" | "transient";
type NavigateToUrl = (url: string) => void;
type PrepareForAuthRedirect = () => void;
type NetworkRequestAttempt<Result> = (attemptCount: number) => Promise<Result>;
export type BlobResponsePayload = Readonly<{
  blob: Blob;
  headers: Headers;
  statusCode: number;
}>;
export type RequestOptions = Readonly<{
  authRecoveryMode: AuthRecoveryMode;
  networkRetryMode: NetworkRetryMode;
  prepareForAuthRedirect: PrepareForAuthRedirect | null;
}>;

const refreshSessionEndpoint = "POST /api/refresh-session";
const refreshSessionMaximumAttemptCount = 3;
const refreshSessionBaseRetryDelayMs = 100;
const refreshSessionMaximumRetryDelayMs = 500;
const refreshSessionReconciliationMaximumAttemptCount = 3;
const refreshSessionReconciliationDelayMs = 200;
export const apiNetworkRetryMaximumAttemptCount = 4;
const apiNetworkRetryBaseDelayMs = 250;
const apiNetworkRetryMaximumDelayMs = 2000;
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
let indexedDbOpenRecoverySignal: AbortSignal | null = null;

export function bindIndexedDbOpenRecoverySignal(signal: AbortSignal): () => void {
  const previousSignal = indexedDbOpenRecoverySignal;
  indexedDbOpenRecoverySignal = signal;
  return (): void => {
    if (indexedDbOpenRecoverySignal === signal) {
      indexedDbOpenRecoverySignal = previousSignal;
    }
  };
}

function readAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.trim() !== "") {
    return new Error(reason);
  }
  return new DOMException("Request was aborted", "AbortError");
}

function throwIfRequestAborted(signal: AbortSignal | null): void {
  if (indexedDbOpenRecoverySignal?.aborted) {
    throw readAbortError(indexedDbOpenRecoverySignal);
  }
  if (signal?.aborted) {
    throw readAbortError(signal);
  }
}

function mergeRequestSignal(lifecycleSignal: AbortSignal | null | undefined): AbortSignal | undefined {
  const recoverySignal = indexedDbOpenRecoverySignal;
  if (recoverySignal === null) {
    return lifecycleSignal ?? undefined;
  }
  if (lifecycleSignal === undefined || lifecycleSignal === null || lifecycleSignal === recoverySignal) {
    return recoverySignal;
  }
  return AbortSignal.any([recoverySignal, lifecycleSignal]);
}

function attachRecoverySignal(init: RequestInit): RequestInit {
  const signal = mergeRequestSignal(init.signal);
  return signal === init.signal ? init : { ...init, signal };
}

function waitForSharedTransportTask<ResultType>(
  task: Promise<ResultType>,
  signal: AbortSignal | null,
): Promise<ResultType> {
  if (indexedDbOpenRecoverySignal?.aborted) {
    return Promise.reject(readAbortError(indexedDbOpenRecoverySignal));
  }
  if (signal === null) {
    return task;
  }
  if (signal.aborted) {
    try {
      throwIfRequestAborted(signal);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return new Promise<ResultType>((resolve, reject) => {
    const handleAbort = (): void => {
      signal.removeEventListener("abort", handleAbort);
      try {
        throwIfRequestAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    task.then(
      (result: ResultType): void => {
        signal.removeEventListener("abort", handleAbort);
        resolve(result);
      },
      (error: unknown): void => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function selectSharedAuthTaskSignal(requestSignal: AbortSignal | null): AbortSignal | null {
  return indexedDbOpenRecoverySignal ?? requestSignal;
}

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

export const skipAuthRecoveryWithTransientNetworkRetry: RequestOptions = createSkipAuthRecoveryOptions("transient");

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

function canReuseNetworkRetryPromise(
  activeNetworkRetryMode: NetworkRetryMode | null,
  requestedNetworkRetryMode: NetworkRetryMode,
): boolean {
  return requestedNetworkRetryMode === "none" || activeNetworkRetryMode === "transient";
}

export function createApiNetworkRetryDelayMs(attemptCount: number): number {
  const exponentialDelayMs = apiNetworkRetryBaseDelayMs * (2 ** (attemptCount - 1));
  const cappedDelayMs = Math.min(exponentialDelayMs, apiNetworkRetryMaximumDelayMs);
  return Math.floor(Math.random() * cappedDelayMs);
}

function waitForTransportDelay(
  delayMs: number,
  signal: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timerId: number | null = null;
    const abortHandler = (): void => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      signal?.removeEventListener("abort", abortHandler);
      reject(signal === null ? new DOMException("Request was aborted", "AbortError") : readAbortError(signal));
    };
    if (signal?.aborted === true) {
      abortHandler();
      return;
    }

    timerId = window.setTimeout((): void => {
      signal?.removeEventListener("abort", abortHandler);
      timerId = null;
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
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
    throwIfRequestAborted(init.signal ?? null);
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
    throwIfRequestAborted(init.signal ?? null);
    try {
      const result = await performAttempt(attemptCount);
      throwIfRequestAborted(init.signal ?? null);
      return result;
    } catch (error) {
      throwIfRequestAborted(init.signal ?? null);
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
async function loadSessionInfoWithoutRecovery(
  networkRetryMode: NetworkRetryMode,
  signal: AbortSignal | null,
): Promise<SessionInfo> {
  const session = parseContractResponse(
    await requestJson("/me", {
      method: "GET",
      ...(signal === null ? {} : { signal }),
    }, createSkipAuthRecoveryOptions(networkRetryMode)),
    "GET /me",
    parseSessionInfoResponse,
  );
  throwIfRequestAborted(signal);
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
    retryAfterMs: null,
    endpoint: refreshSessionEndpoint,
    responseBodyKind: "empty",
  });
}

async function createRefreshSessionResponseError(
  response: Response,
  signal: AbortSignal | null,
): Promise<ApiError> {
  const payload = await readJsonResponse(response);
  throwIfRequestAborted(signal);
  const fallbackMessage = typeof payload.value === "string" ? payload.value : `Request failed with status ${response.status}`;
  return new ApiError({
    statusCode: response.status,
    message: getJsonErrorMessage(payload.value, fallbackMessage),
    code: payload.code,
    requestId: payload.requestId,
    retryAfterMs: payload.retryAfterMs,
    endpoint: refreshSessionEndpoint,
    responseBodyKind: payload.bodyKind,
  });
}

function createRefreshSessionRetryDelay(attemptIndex: number): number {
  const exponentialDelayMs = refreshSessionBaseRetryDelayMs * (2 ** attemptIndex);
  const cappedDelayMs = Math.min(exponentialDelayMs, refreshSessionMaximumRetryDelayMs);
  return Math.floor(Math.random() * cappedDelayMs);
}

function waitForRefreshSessionRetry(attemptIndex: number, signal: AbortSignal | null): Promise<void> {
  return waitForTransportDelay(createRefreshSessionRetryDelay(attemptIndex), signal);
}

function waitForRefreshSessionReconciliation(signal: AbortSignal | null): Promise<void> {
  return waitForTransportDelay(refreshSessionReconciliationDelayMs, signal);
}

async function reconcileRefreshSession(
  networkRetryMode: NetworkRetryMode,
  refreshNetworkError: ApiError,
  signal: AbortSignal | null,
): Promise<void> {
  for (
    let attemptCount = 1;
    attemptCount <= refreshSessionReconciliationMaximumAttemptCount;
    attemptCount += 1
  ) {
    await waitForRefreshSessionReconciliation(signal);

    try {
      await loadSessionInfoWithoutRecovery(networkRetryMode, signal);
      throwIfRequestAborted(signal);
      return;
    } catch (error) {
      if (error instanceof ApiError === false || error.statusCode !== 401) {
        throw error;
      }

      if (attemptCount === refreshSessionReconciliationMaximumAttemptCount) {
        throw refreshNetworkError;
      }
    }
  }

  throw new Error("Refresh session reconciliation loop exited without a result");
}

/**
 * Calls the auth service refresh endpoint with shared cookies and distinguishes
 * a normal refresh from a session verified after ambiguous network failures.
 */
async function refreshBrowserSession(
  networkRetryMode: NetworkRetryMode,
  signal: AbortSignal | null,
): Promise<RefreshBrowserSessionResult> {
  const config = getAppConfig();
  let lastNetworkError: ApiError | null = null;
  let networkRejectionCount = 0;

  for (let attemptIndex = 0; attemptIndex < refreshSessionMaximumAttemptCount; attemptIndex += 1) {
    throwIfRequestAborted(signal);
    let response: Response;

    try {
      response = await fetch(`${config.authBaseUrl}/api/refresh-session`, {
        method: "POST",
        credentials: "include",
        ...(signal === null ? {} : { signal }),
      });
    } catch (error) {
      throwIfRequestAborted(signal);
      lastNetworkError = createRefreshSessionNetworkError(error);
      networkRejectionCount += 1;
      if (hasRemainingRefreshAttempt(attemptIndex)) {
        await waitForRefreshSessionRetry(attemptIndex, signal);
        continue;
      }

      if (networkRejectionCount === refreshSessionMaximumAttemptCount) {
        await reconcileRefreshSession(networkRetryMode, lastNetworkError, signal);
        return "reconciled";
      }

      throw lastNetworkError;
    }

    throwIfRequestAborted(signal);
    if (response.ok) {
      return "refreshed";
    }

    if (response.status === 401) {
      resetSessionState();
      return "unauthorized";
    }

    if (isTransientRefreshSessionStatus(response.status) && hasRemainingRefreshAttempt(attemptIndex)) {
      await waitForRefreshSessionRetry(attemptIndex, signal);
      continue;
    }

    throw await createRefreshSessionResponseError(response, signal);
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

function startSessionRecovery(
  options: RequestOptions,
  requestSignal: AbortSignal | null,
): Promise<void> {
  const authTaskSignal = selectSharedAuthTaskSignal(requestSignal);
  const recoveryTask = (async (): Promise<void> => {
    const refreshResult = await refreshBrowserSession(options.networkRetryMode, authTaskSignal);
    throwIfRequestAborted(authTaskSignal);
    if (refreshResult === "unauthorized") {
      await redirectToLogin(options.prepareForAuthRedirect);
    }

    if (refreshResult === "reconciled") {
      return;
    }

    try {
      await loadSessionInfoWithoutRecovery(options.networkRetryMode, authTaskSignal);
      throwIfRequestAborted(authTaskSignal);
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

  return trackedRecoveryTask;
}

async function recoverSession(
  options: RequestOptions,
  requestSignal: AbortSignal | null,
): Promise<void> {
  while (true) {
    const activeRecovery = sessionRecoveryPromise;
    if (
      activeRecovery !== null
      && canReuseNetworkRetryPromise(sessionRecoveryNetworkRetryMode, options.networkRetryMode)
    ) {
      return waitForSharedTransportTask(activeRecovery, requestSignal);
    }

    if (activeRecovery !== null) {
      try {
        await waitForSharedTransportTask(activeRecovery, requestSignal);
        return;
      } catch (error) {
        if (shouldRetryAfterWeakerSessionRecovery(error, options) === false) {
          throw error;
        }

        continue;
      }
    }

    return waitForSharedTransportTask(startSessionRecovery(options, requestSignal), requestSignal);
  }
}

/**
 * Reloads the current session-bound CSRF token after another same-site app has
 * rotated the shared session cookie.
 */
async function recoverSessionCsrf(
  options: RequestOptions,
  requestSignal: AbortSignal | null,
): Promise<void> {
  const activeRecovery = sessionCsrfRecoveryPromise;
  if (
    activeRecovery !== null
    && canReuseNetworkRetryPromise(sessionCsrfRecoveryNetworkRetryMode, options.networkRetryMode)
  ) {
    return waitForSharedTransportTask(activeRecovery, requestSignal);
  }

  const authTaskSignal = selectSharedAuthTaskSignal(requestSignal);
  const recoveryTask = (async (): Promise<void> => {
    await loadSessionInfoWithRecovery(options, authTaskSignal);
    throwIfRequestAborted(authTaskSignal);
  })();

  const trackedRecoveryTask = recoveryTask.finally(() => {
    if (sessionCsrfRecoveryPromise === trackedRecoveryTask) {
      sessionCsrfRecoveryPromise = null;
      sessionCsrfRecoveryNetworkRetryMode = null;
    }
  });
  sessionCsrfRecoveryPromise = trackedRecoveryTask;
  sessionCsrfRecoveryNetworkRetryMode = options.networkRetryMode;

  return waitForSharedTransportTask(trackedRecoveryTask, requestSignal);
}

async function ensureSessionTransportReadyForUnsafeRequest(
  options: RequestOptions,
  requestSignal: AbortSignal | null,
): Promise<void> {
  if (sessionCsrfState !== "unknown") {
    return;
  }

  if (sessionRecoveryPromise !== null) {
    await recoverSession(options, requestSignal);
    return;
  }

  const activeBootstrap = sessionTransportReadyPromise;
  if (
    activeBootstrap !== null
    && canReuseNetworkRetryPromise(sessionTransportReadyNetworkRetryMode, options.networkRetryMode)
  ) {
    await waitForSharedTransportTask(activeBootstrap, requestSignal);
    return;
  }

  const authTaskSignal = selectSharedAuthTaskSignal(requestSignal);
  const readinessTask = (async (): Promise<void> => {
    await loadSessionInfoWithRecovery(options, authTaskSignal);
    throwIfRequestAborted(authTaskSignal);
  })();

  const trackedReadinessTask = readinessTask.finally(() => {
    if (sessionTransportReadyPromise === trackedReadinessTask) {
      sessionTransportReadyPromise = null;
      sessionTransportReadyNetworkRetryMode = null;
    }
  });
  sessionTransportReadyPromise = trackedReadinessTask;
  sessionTransportReadyNetworkRetryMode = options.networkRetryMode;
  await waitForSharedTransportTask(trackedReadinessTask, requestSignal);
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
  attemptCount: number,
): Promise<Response> {
  const requestSignal = init.signal ?? null;
  throwIfRequestAborted(requestSignal);
  if (isUnsafeMethod(getMethod(init))) {
    await ensureSessionTransportReadyForUnsafeRequest(options, requestSignal);
    throwIfRequestAborted(requestSignal);
  }

  const endpoint = buildSanitizedRequestEndpoint(pathname, init);
  let response: Response = await performFetch(pathname, init, "include", attemptCount);
  throwIfRequestAborted(requestSignal);
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
      await recoverSession(options, requestSignal);
      throwIfRequestAborted(requestSignal);
      response = await performFetch(pathname, init, "include", attemptCount);
      throwIfRequestAborted(requestSignal);
      continue;
    }

    const isRecoverableSessionCsrf = didRecoverSessionCsrf === false && isUnsafeMethod(getMethod(init))
      ? await isRecoverableSessionCsrfResponse(response, {
        attemptCount,
        endpoint,
      })
      : false;
    throwIfRequestAborted(requestSignal);
    if (isRecoverableSessionCsrf) {
      didRecoverSessionCsrf = true;
      await recoverSessionCsrf(options, requestSignal);
      throwIfRequestAborted(requestSignal);
      response = await performFetch(pathname, init, "include", attemptCount);
      throwIfRequestAborted(requestSignal);
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
  const requestInit = attachRecoverySignal(init);
  const endpoint = buildSanitizedRequestEndpoint(pathname, requestInit);
  return performWithNetworkRetry(endpoint, requestInit, options, async (attemptCount: number) => {
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
}

/**
 * Loads public JSON without sending browser credentials. Public API routes use
 * credential-free CORS and intentionally do not participate in auth recovery.
 */
export async function requestPublicJson(pathname: string): Promise<ParsedResponsePayload> {
  const init = attachRecoverySignal({ method: "GET" });
  const options = skipAuthRecoveryWithTransientNetworkRetry;
  const endpoint = buildSanitizedRequestEndpoint(pathname, init);
  return performWithNetworkRetry(endpoint, init, options, async (attemptCount: number) => {
    const response = await performFetch(pathname, init, "omit", attemptCount);
    return parseJsonPayload(
      response,
      buildRequestEndpoint(pathname, init),
      {
        attemptCount,
        endpoint,
      },
    );
  });
}

export async function requestBlob(
  pathname: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<BlobResponsePayload> {
  const requestInit = attachRecoverySignal(init);
  const endpoint = buildRequestEndpoint(pathname, requestInit);
  const sanitizedEndpoint = buildSanitizedRequestEndpoint(pathname, requestInit);
  return performWithNetworkRetry(sanitizedEndpoint, requestInit, options, async (attemptCount: number) => {
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
}

/**
 * Loads the authenticated browser session from `/me` and refreshes the cached
 * CSRF token when the backend authenticates the request via shared cookies.
 */
export async function getSession(): Promise<SessionInfo> {
  return loadSessionInfoWithRecovery(allowAuthRecoveryWithTransientNetworkRetry, null);
}

export async function getOptionalSession(): Promise<SessionInfo | null> {
  try {
    return await loadSessionInfoWithoutRecovery("transient", null);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) {
      return null;
    }

    throw error;
  }
}

/**
 * Revalidates the current browser session without resetting the surrounding
 * UI state. Callers should use this on tab resume before background sync.
 */
export async function revalidateSession(): Promise<SessionInfo> {
  return loadSessionInfoWithRecovery(allowAuthRecoveryWithTransientNetworkRetry, null);
}

/**
 * Loads `/me` through the normal request pipeline so the API layer can recover
 * from one expired session token without forcing a full page reload.
 */
async function loadSessionInfoWithRecovery(
  options: RequestOptions,
  signal: AbortSignal | null,
): Promise<SessionInfo> {
  const session = parseContractResponse(await requestJson("/me", {
    method: "GET",
    ...(signal === null ? {} : { signal }),
  }, options), "GET /me", parseSessionInfoResponse);
  throwIfRequestAborted(signal);
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  redirectInFlight = false;
  return session;
}
