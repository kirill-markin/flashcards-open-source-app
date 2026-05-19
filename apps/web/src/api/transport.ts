import { parseSessionInfoResponse } from "../apiContracts/account";
import { markAuthResetRequired, runPendingAuthResetCleanup } from "../accountDeletion";
import { getAppConfig } from "../config";
import type { SessionInfo } from "../types";
import { buildLoginUrl, getPreferredAuthUiLocale } from "./authUrls";
import { ApiError, AuthRedirectError } from "./errors";
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
type NavigateToUrl = (url: string) => void;
type PrepareForAuthRedirect = () => void;
export type RequestOptions = Readonly<{
  authRecoveryMode: AuthRecoveryMode;
  prepareForAuthRedirect: PrepareForAuthRedirect | null;
}>;

const refreshSessionEndpoint = "POST /api/refresh-session";

let sessionCsrfToken: string | null = null;
let sessionCsrfState: SessionCsrfState = "unknown";
let sessionRecoveryPromise: Promise<void> | null = null;
let sessionCsrfRecoveryPromise: Promise<void> | null = null;
let sessionTransportReadyPromise: Promise<void> | null = null;
let redirectInFlight = false;
let authRedirectPreparationPromise: Promise<void> | null = null;
let navigationHandler: NavigateToUrl | null = null;

/**
 * Browser-local app state is discarded only once the client has already
 * concluded that silent session recovery failed and an interactive login is
 * required. Successful refresh paths never call this hook.
 */
function prepareForAuthRedirect(): void {
  markAuthResetRequired();
  if (authRedirectPreparationPromise !== null) {
    return;
  }

  authRedirectPreparationPromise = runPendingAuthResetCleanup()
    .then((): void => undefined)
    .finally(() => {
      authRedirectPreparationPromise = null;
    });
}

export const allowAuthRecovery: RequestOptions = {
  authRecoveryMode: "allow",
  prepareForAuthRedirect,
};

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
  sessionCsrfRecoveryPromise = null;
  sessionTransportReadyPromise = null;
  redirectInFlight = false;
  authRedirectPreparationPromise = null;
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

async function performFetch(pathname: string, init: RequestInit): Promise<Response> {
  const config = getAppConfig();
  const headers = createHeaders(init);

  try {
    return await fetch(`${config.apiBaseUrl}${pathname}`, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The API is unavailable or not deployed yet. Try again. (${pathname}; ${message})`,
    );
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
async function loadSessionInfoWithoutRecovery(): Promise<SessionInfo> {
  const response = await performFetch("/me", { method: "GET" });
  const session = parseContractResponse(
    await parseJsonPayload(response, "GET /me"),
    "GET /me",
    parseSessionInfoResponse,
  );
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  redirectInFlight = false;
  return session;
}

/**
 * Calls the auth service refresh endpoint with shared cookies and returns
 * `false` only when the refresh token is no longer valid.
 */
async function refreshBrowserSession(): Promise<boolean> {
  const config = getAppConfig();
  let response: Response;

  try {
    response = await fetch(`${config.authBaseUrl}/api/refresh-session`, {
      method: "POST",
      credentials: "include",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError({
      statusCode: 0,
      message: `The auth service is unavailable. Try again. (/api/refresh-session; ${message})`,
      code: null,
      requestId: null,
      endpoint: refreshSessionEndpoint,
      responseBodyKind: "empty",
    });
  }

  if (response.ok) {
    return true;
  }

  if (response.status === 401) {
    resetSessionState();
    return false;
  }

  const payload = await readJsonResponse(response);
  const fallbackMessage = typeof payload.value === "string" ? payload.value : `Request failed with status ${response.status}`;
  throw new ApiError({
    statusCode: response.status,
    message: getJsonErrorMessage(payload.value, fallbackMessage),
    code: payload.code,
    requestId: payload.requestId,
    endpoint: refreshSessionEndpoint,
    responseBodyKind: payload.bodyKind,
  });
}

/**
 * Performs a single shared auth recovery operation for all concurrent browser
 * requests that observe the same expired session token.
 */
async function recoverSession(prepareForAuthRedirectCallback: PrepareForAuthRedirect | null): Promise<void> {
  const activeRecovery = sessionRecoveryPromise;
  if (activeRecovery !== null) {
    return activeRecovery;
  }

  const recoveryTask = (async (): Promise<void> => {
    const refreshed = await refreshBrowserSession();
    if (refreshed === false) {
      await redirectToLogin(prepareForAuthRedirectCallback);
    }

    try {
      await loadSessionInfoWithoutRecovery();
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        await redirectToLogin(prepareForAuthRedirectCallback);
      }

      throw error;
    }
  })();

  sessionRecoveryPromise = recoveryTask.finally(() => {
    sessionRecoveryPromise = null;
  });

  return sessionRecoveryPromise;
}

/**
 * Reloads the current session-bound CSRF token after another same-site app has
 * rotated the shared session cookie.
 */
async function recoverSessionCsrf(): Promise<void> {
  const activeRecovery = sessionCsrfRecoveryPromise;
  if (activeRecovery !== null) {
    return activeRecovery;
  }

  const recoveryTask = (async (): Promise<void> => {
    await loadSessionInfoWithRecovery();
  })();

  sessionCsrfRecoveryPromise = recoveryTask.finally(() => {
    sessionCsrfRecoveryPromise = null;
  });

  return sessionCsrfRecoveryPromise;
}

async function ensureSessionTransportReadyForUnsafeRequest(): Promise<void> {
  if (sessionCsrfState !== "unknown") {
    return;
  }

  if (sessionRecoveryPromise !== null) {
    await sessionRecoveryPromise;
    return;
  }

  const activeBootstrap = sessionTransportReadyPromise;
  if (activeBootstrap !== null) {
    await activeBootstrap;
    return;
  }

  const readinessTask = (async (): Promise<void> => {
    await loadSessionInfoWithRecovery();
  })();

  const trackedReadinessTask = readinessTask.finally(() => {
    if (sessionTransportReadyPromise === trackedReadinessTask) {
      sessionTransportReadyPromise = null;
    }
  });
  sessionTransportReadyPromise = trackedReadinessTask;
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
    await ensureSessionTransportReadyForUnsafeRequest();
  }

  let response: Response = await performFetch(pathname, init);
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
      await recoverSession(options.prepareForAuthRedirect);
      response = await performFetch(pathname, init);
      continue;
    }

    if (
      didRecoverSessionCsrf === false
      && isUnsafeMethod(getMethod(init))
      && await isRecoverableSessionCsrfResponse(response)
    ) {
      didRecoverSessionCsrf = true;
      await recoverSessionCsrf();
      response = await performFetch(pathname, init);
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
  return loadSessionInfoWithRecovery();
}

/**
 * Revalidates the current browser session without resetting the surrounding
 * UI state. Callers should use this on tab resume before background sync.
 */
export async function revalidateSession(): Promise<SessionInfo> {
  return loadSessionInfoWithRecovery();
}

/**
 * Loads `/me` through the normal request pipeline so the API layer can recover
 * from one expired session token without forcing a full page reload.
 */
async function loadSessionInfoWithRecovery(): Promise<SessionInfo> {
  const session = parseContractResponse(await requestJson("/me", {
    method: "GET",
  }, allowAuthRecovery), "GET /me", parseSessionInfoResponse);
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  redirectInFlight = false;
  return session;
}
