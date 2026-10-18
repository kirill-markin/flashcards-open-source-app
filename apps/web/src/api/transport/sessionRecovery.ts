import { readBrowserGuestOwnershipGeneration, readBrowserGuestState, requireBrowserGuestSyncReady, subscribeToBrowserGuestChanges } from "../../appData/session/guest/browserGuestStorage";
import { combineAbortSignals } from "../../abortSignals";
import { markBrowserReauthRequired } from "../../accountDeletion";
import { track } from "../../analytics/client";
import { getAppConfig } from "../../config";
import type { SessionInfo } from "../../types";
import { buildLoginUrl, getPreferredAuthUiLocale } from "../authUrls";
import { ApiError, ApiNetworkError, AuthRedirectError } from "./errors";
import {
  getJsonErrorMessage,
  isRecoverableSessionCsrfResponse,
  readJsonResponse,
} from "./response";
import { readAbortError, waitForTransportDelay } from "./transportSignals";

type SessionCsrfState = "unknown" | "session" | "guest" | "non-session";
export class BrowserGuestSessionInvalidatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserGuestSessionInvalidatedError";
  }
}

type RefreshBrowserSessionResult = "refreshed" | "reconciled" | "unauthorized";
export type AuthRecoveryMode = "allow" | "skip";
export type NetworkRetryMode = "none" | "transient";
type NavigateToUrl = (url: string) => void;
type PrepareForAuthRedirect = () => void;
type LoadSessionInfo = (
  options: RequestOptions,
  signal: AbortSignal | null,
) => Promise<SessionInfo>;
type PerformAuthenticatedRequest = () => Promise<Response>;
type RequestSignalBinding = Readonly<{
  signal: AbortSignal | undefined;
  dispose: () => void;
}>;
export type RequestInitBinding = Readonly<{
  requestInit: RequestInit;
  dispose: () => void;
}>;
export type RequestOptions = Readonly<{
  authRecoveryMode: AuthRecoveryMode;
  networkRetryMode: NetworkRetryMode;
  prepareForAuthRedirect: PrepareForAuthRedirect | null;
  expectedUserId: string | null;
}>;
export type SessionRecovery = Readonly<{
  attachRecoverySignal: (init: RequestInit) => RequestInitBinding;
  bindIndexedDbOpenRecoverySignal: (signal: AbortSignal) => () => void;
  createSessionHeaders: (headers: Headers, method: string) => Headers;
  getCachedSessionCsrfToken: () => string | null;
  getOptionalSession: () => Promise<SessionInfo | null>;
  loadVerifiedBrowserGuestSession: (userId: string, workspaceId: string) => Promise<SessionInfo>;
  isBrowserGuestSessionVerified: (userId: string, workspaceId: string) => boolean;
  subscribeToBrowserGuestVerification: (listener: () => void) => () => void;
  getSession: () => Promise<SessionInfo>;
  primeSessionCsrfToken: (csrfToken: string) => void;
  primeGuestSession: (userId: string, csrfToken: string) => void;
  pauseBrowserGuestSession: () => void;
  resumeVerifiedBrowserSession: (session: SessionInfo) => void;
  readBrowserGuestVerificationGeneration: (userId: string) => number | null;
  requestResponse: (
    method: string,
    endpoint: string,
    requestSignal: AbortSignal | null,
    options: RequestOptions,
    attemptCount: number,
    performRequest: PerformAuthenticatedRequest,
  ) => Promise<Response>;
  resetApiClientStateForTests: () => void;
  revalidateSession: () => Promise<SessionInfo>;
  recoverRegisteredCredentialForProbe: () => Promise<void>;
  setNavigationHandlerForTests: (handler: NavigateToUrl | null) => void;
  throwIfRequestAborted: (signal: AbortSignal | null) => void;
}>;

const refreshSessionEndpoint = "POST /api/refresh-session";
const refreshSessionMaximumAttemptCount = 3;
const refreshSessionBaseRetryDelayMs = 100;
const refreshSessionMaximumRetryDelayMs = 500;
const refreshSessionReconciliationMaximumAttemptCount = 3;
const refreshSessionReconciliationDelayMs = 200;
const transientRefreshSessionStatusCodes: ReadonlySet<number> = new Set([
  408,
  429,
  500,
  502,
  503,
  504,
]);

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
  expectedUserId: null,
};

export const allowAuthRecoveryWithTransientNetworkRetry: RequestOptions = {
  authRecoveryMode: "allow",
  networkRetryMode: "transient",
  prepareForAuthRedirect,
  expectedUserId: null,
};

export const skipAuthRecoveryWithTransientNetworkRetry: RequestOptions = createSkipAuthRecoveryOptions("transient");
// Only explicit owner verification may read /me while ordinary protected work is paused.
const browserSessionVerificationOptions: RequestOptions = createSkipAuthRecoveryOptions("transient");

function createSkipAuthRecoveryOptions(networkRetryMode: NetworkRetryMode): RequestOptions {
  return {
    authRecoveryMode: "skip",
    networkRetryMode,
    prepareForAuthRedirect: null,
    expectedUserId: null,
  };
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function canReuseNetworkRetryPromise(
  activeNetworkRetryMode: NetworkRetryMode | null,
  requestedNetworkRetryMode: NetworkRetryMode,
): boolean {
  return requestedNetworkRetryMode === "none" || activeNetworkRetryMode === "transient";
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

export function createSessionRecovery(loadSessionInfo: LoadSessionInfo): SessionRecovery {
  let identityController = new AbortController();
  let browserGuestSessionPaused = false;
  let browserGuestVerificationGeneration = 0;
  let sessionCsrfToken: string | null = null;
  let sessionUserId: string | null = null;
  let verifiedBrowserGuestOwner: Readonly<{ userId: string; workspaceId: string | null }> | null = null;
  const browserGuestVerificationListeners = new Set<() => void>();
  let sessionCsrfState: SessionCsrfState = "unknown";
  let sessionRecoveryPromise: Promise<void> | null = null;
  let sessionRecoveryNetworkRetryMode: NetworkRetryMode | null = null;
  let sessionCsrfRecoveryPromise: Promise<void> | null = null;
  let sessionCsrfRecoveryNetworkRetryMode: NetworkRetryMode | null = null;
  let sessionTransportReadyPromise: Promise<void> | null = null;
  let sessionTransportReadyNetworkRetryMode: NetworkRetryMode | null = null;
  let redirectInFlight = false;
  /**
   * Whether `/me` has answered this tab with a browser session. `redirectToLogin` is reached
   * whenever `/me` and the refresh both answer 401, which is equally the cold load of a browser
   * that holds no session and the load that follows a deliberate sign-out, so the `signed_out` it
   * reports is gated on this rather than on reaching the redirect. A session that had already
   * expired when the tab opened is an accepted under-count.
   */
  let hasLoadedBrowserSession = false;
  let navigationHandler: NavigateToUrl | null = null;
  let indexedDbOpenRecoverySignal: AbortSignal | null = null;

  function readGuestBoundary(): string {
    const saved = readBrowserGuestState();
    const owner = saved?.status === "owned" ? `${saved.owner.userId}:${saved.owner.workspaceId}:${saved.owner.pending?.phase ?? "active"}` : saved?.status ?? "absent";
    return `${owner}:${readBrowserGuestOwnershipGeneration() ?? ""}`;
  }

  function publishBrowserGuestVerification(): void {
    for (const listener of browserGuestVerificationListeners) listener();
  }

  let guestBoundary = "";
  if (typeof window !== "undefined") subscribeToBrowserGuestChanges(() => {
    const next = readGuestBoundary();
    if (guestBoundary === next) return;
    guestBoundary = next;
    browserGuestVerificationGeneration += 1;
    identityController.abort(new BrowserGuestSessionInvalidatedError("Browser guest identity boundary changed; reload session before writing."));
    identityController = new AbortController();
    resetSessionState();
    publishBrowserGuestVerification();
  });

  function bindIndexedDbOpenRecoverySignal(signal: AbortSignal): () => void {
    const previousSignal = indexedDbOpenRecoverySignal;
    indexedDbOpenRecoverySignal = signal;
    return (): void => {
      if (indexedDbOpenRecoverySignal === signal) {
        indexedDbOpenRecoverySignal = previousSignal;
      }
    };
  }

  function throwIfRequestAborted(signal: AbortSignal | null): void {
    if (indexedDbOpenRecoverySignal?.aborted) {
      throw readAbortError(indexedDbOpenRecoverySignal);
    }
    if (signal?.aborted) {
      throw readAbortError(signal);
    }
  }

  function mergeRequestSignal(lifecycleSignal: AbortSignal | null | undefined): RequestSignalBinding {
    return combineAbortSignals([identityController.signal, ...(indexedDbOpenRecoverySignal === null ? [] : [indexedDbOpenRecoverySignal]), ...(lifecycleSignal == null ? [] : [lifecycleSignal])]);
  }

  function attachRecoverySignal(init: RequestInit): RequestInitBinding {
    const { signal, dispose } = mergeRequestSignal(init.signal);
    return {
      requestInit: signal === init.signal ? init : { ...init, signal },
      dispose,
    };
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

  function setSessionCsrfToken(session: SessionInfo): void {
    sessionCsrfToken = session.csrfToken;
    sessionUserId = session.userId;
    sessionCsrfState = session.authTransport === "session" ? "session"
      : session.browserGuestCapabilities?.isGuest === true ? "guest" : "non-session";
    if (sessionCsrfState === "session") {
      hasLoadedBrowserSession = true;
    }
  }

  /**
   * Clears the in-memory session transport state so no future mutating request
   * can reuse a stale CSRF token after auth recovery fails.
   */
  function resetSessionState(): void {
    sessionCsrfToken = null;
    sessionUserId = null;
    verifiedBrowserGuestOwner = null;
    sessionCsrfState = "unknown";
  }

  function requireBrowserGuestSessionNotPaused(): void {
    if (browserGuestSessionPaused) throw new BrowserGuestSessionInvalidatedError("Browser guest session is unverified; remote work is paused until owner verification succeeds.");
  }

  function createSessionHeaders(headers: Headers, method: string): Headers {
    if (isUnsafeMethod(method)) {
      requireBrowserGuestSessionNotPaused();
      if (sessionCsrfState === "unknown") {
        throw new Error("Session must be loaded before sending mutating requests");
      }

      if (sessionCsrfState === "session" || sessionCsrfState === "guest") {
        const csrfToken = sessionCsrfToken;
        if (csrfToken === null || csrfToken === "") {
          throw new Error("CSRF token is not loaded for this browser session");
        }

        headers.set("X-CSRF-Token", csrfToken);
      }
    }

    return headers;
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
      if (hasLoadedBrowserSession) {
        // A session this tab held can no longer be used, so it has been dropped and the person is
        // being sent back to sign in. Reported inside the burst guard, so one auth failure is one
        // fact however many requests hit it, and before the navigation so the queue persists it.
        //
        // No drain in front of it, and none is needed: nothing pressed this, and this browser's
        // queue survives the boundary on its own — it is stored per browser under the shared
        // visitor id, which does not rotate here, so a later load delivers the row.
        track({ name: "signed_out", reason: "credential_expired" });
      }

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
    const session = await loadSessionInfo(createSkipAuthRecoveryOptions(networkRetryMode), signal);
    throwIfRequestAborted(signal);
    setSessionCsrfToken(session);
    redirectInFlight = false;
    return session;
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

  async function recoverRegisteredCredentialForProbe(): Promise<void> {
    for (let attempt = 0; attempt < refreshSessionMaximumAttemptCount; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${getAppConfig().authBaseUrl}/api/refresh-session`, { method: "POST", credentials: "include" });
      } catch (error) {
        if (!hasRemainingRefreshAttempt(attempt)) throw createRefreshSessionNetworkError(error);
        console.warn("Registered credential probe refresh retry", { attemptCount: attempt + 1 });
        await waitForRefreshSessionRetry(attempt, null);
        continue;
      }
      if (response.ok) return;
      if (response.status === 401) await redirectToLogin(prepareForAuthRedirect);
      if (isTransientRefreshSessionStatus(response.status) && hasRemainingRefreshAttempt(attempt)) {
        console.warn("Registered credential probe refresh retry", { attemptCount: attempt + 1, statusCode: response.status });
        await waitForRefreshSessionRetry(attempt, null);
        continue;
      }
      throw await createRefreshSessionResponseError(response, null);
    }
    throw new Error("Registered credential probe refresh ended without a response");
  }

  function shouldRetryAfterWeakerSessionRecovery(error: unknown, options: RequestOptions): boolean {
    return options.networkRetryMode === "transient" && error instanceof ApiNetworkError;
  }

  function startSessionRecovery(
    options: RequestOptions,
    requestSignal: AbortSignal | null,
  ): Promise<void> {
    if (sessionCsrfState === "guest" || readBrowserGuestState() !== null) {
      throw new Error("The browser guest credential expired or changed. Local data has been preserved; restore the original cookie before syncing.");
    }
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
   * Loads the authenticated browser session from `/me` and refreshes the cached
   * CSRF token when the backend authenticates the request via shared cookies.
   */
  async function loadSessionInfoWithRecovery(
    options: RequestOptions,
    signal: AbortSignal | null,
  ): Promise<SessionInfo> {
    const saved = readBrowserGuestState();
    if (saved?.status === "owned" && saved.owner.pending !== null
      && (saved.owner.pending.phase === "draining" || saved.owner.pending.phase === "awaiting_auth")) {
      throw new Error("Prepare the pending guest conversion before loading the registered account.");
    }
    const session = await loadSessionInfo({ ...options, expectedUserId: null }, signal);
    throwIfRequestAborted(signal);
    setSessionCsrfToken(session);
    redirectInFlight = false;
    return session;
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
    requireBrowserGuestSessionNotPaused();
    if (sessionCsrfState !== "unknown" && (options.expectedUserId === null || sessionUserId !== null)) {
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
    method: string,
    endpoint: string,
    requestSignal: AbortSignal | null,
    options: RequestOptions,
    attemptCount: number,
    performRequest: PerformAuthenticatedRequest,
  ): Promise<Response> {
    throwIfRequestAborted(requestSignal);
    if (isUnsafeMethod(method)) {
      if (sessionCsrfState === "guest" && sessionUserId !== null) requireBrowserGuestSyncReady(sessionUserId);
      await ensureSessionTransportReadyForUnsafeRequest(options, requestSignal);
      throwIfRequestAborted(requestSignal);
    }

    function performAccountBoundRequest(): Promise<Response> {
      if (options !== browserSessionVerificationOptions || endpoint !== "GET /me") requireBrowserGuestSessionNotPaused();
      if (options.expectedUserId !== null && options.expectedUserId !== sessionUserId) {
        throw new ApiError({
          statusCode: 0,
          message: `The signed-in account changed. Reload before saving preferences. (${endpoint})`,
          code: "SESSION_ACCOUNT_CHANGED",
          requestId: null,
          retryAfterMs: null,
          endpoint,
          responseBodyKind: "empty",
        });
      }
      return performRequest();
    }

    let response: Response = await performAccountBoundRequest();
    throwIfRequestAborted(requestSignal);
    if (options.authRecoveryMode === "skip") {
      return response;
    }

    let didRecoverSession: boolean = false;
    let didRecoverSessionCsrf: boolean = false;
    while (true) {
      if (response.status === 401) {
        if (sessionCsrfState === "guest" || readBrowserGuestState() !== null) return response;
        if (didRecoverSession) {
          await redirectToLogin(options.prepareForAuthRedirect);
        }

        didRecoverSession = true;
        await recoverSession(options, requestSignal);
        throwIfRequestAborted(requestSignal);
        response = await performAccountBoundRequest();
        throwIfRequestAborted(requestSignal);
        continue;
      }

      const isRecoverableSessionCsrf = didRecoverSessionCsrf === false && isUnsafeMethod(method)
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
        response = await performAccountBoundRequest();
        throwIfRequestAborted(requestSignal);
        continue;
      }

      return response;
    }
  }

  function resetApiClientStateForTests(): void {
    browserGuestSessionPaused = false;
    browserGuestVerificationGeneration = 0;
    sessionCsrfToken = null;
    sessionUserId = null;
    verifiedBrowserGuestOwner = null;
    sessionCsrfState = "unknown";
    sessionRecoveryPromise = null;
    sessionRecoveryNetworkRetryMode = null;
    sessionCsrfRecoveryPromise = null;
    sessionCsrfRecoveryNetworkRetryMode = null;
    sessionTransportReadyPromise = null;
    sessionTransportReadyNetworkRetryMode = null;
    redirectInFlight = false;
    hasLoadedBrowserSession = false;
    navigationHandler = null;
  }

  return {
    attachRecoverySignal,
    isBrowserGuestSessionVerified: (userId: string, workspaceId: string): boolean => browserGuestSessionPaused === false
      && sessionCsrfState === "guest" && sessionUserId === userId
      && verifiedBrowserGuestOwner?.userId === userId && verifiedBrowserGuestOwner.workspaceId === workspaceId,
    subscribeToBrowserGuestVerification: (listener: () => void): (() => void) => {
      browserGuestVerificationListeners.add(listener);
      return () => { browserGuestVerificationListeners.delete(listener); };
    },
    loadVerifiedBrowserGuestSession: async (userId: string, workspaceId: string): Promise<SessionInfo> => {
      const signal = identityController.signal;
      const session = await loadSessionInfo(browserSessionVerificationOptions, signal);
      throwIfRequestAborted(signal);
      if (session.browserGuestCapabilities?.isGuest !== true || session.userId !== userId
        || session.selectedWorkspaceId !== workspaceId) {
        throw new Error("Browser guest account does not match the verified cookie workspace. Local data has been preserved.");
      }
      return session;
    },
    bindIndexedDbOpenRecoverySignal,
    createSessionHeaders,
    getCachedSessionCsrfToken: (): string | null => sessionCsrfState === "session" || sessionCsrfState === "guest" ? sessionCsrfToken : null,
    getOptionalSession: async (): Promise<SessionInfo | null> => {
      try {
        const signal = identityController.signal;
        const session = await loadSessionInfo(browserSessionVerificationOptions, signal);
        throwIfRequestAborted(signal);
        setSessionCsrfToken(session);
        redirectInFlight = false;
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 401) {
          return null;
        }

        throw error;
      }
    },
    getSession: (): Promise<SessionInfo> => loadSessionInfoWithRecovery(
      allowAuthRecoveryWithTransientNetworkRetry,
      null,
    ),
    pauseBrowserGuestSession: (): void => {
      browserGuestSessionPaused = true;
      browserGuestVerificationGeneration += 1;
      identityController.abort(new BrowserGuestSessionInvalidatedError("Browser guest session is unverified; remote work is paused."));
      identityController = new AbortController();
      resetSessionState();
      publishBrowserGuestVerification();
    },
    resumeVerifiedBrowserSession: (session: SessionInfo): void => {
      const isSameOwner = browserGuestSessionPaused === false && sessionCsrfState === "guest"
        && session.browserGuestCapabilities?.isGuest === true && sessionUserId === session.userId
        && verifiedBrowserGuestOwner?.userId === session.userId
        && verifiedBrowserGuestOwner.workspaceId === session.selectedWorkspaceId;
      setSessionCsrfToken(session);
      browserGuestSessionPaused = false;
      verifiedBrowserGuestOwner = session.browserGuestCapabilities?.isGuest === true
        ? { userId: session.userId, workspaceId: session.selectedWorkspaceId } : null;
      guestBoundary = readGuestBoundary();
      redirectInFlight = false;
      if (isSameOwner === false) browserGuestVerificationGeneration += 1;
      publishBrowserGuestVerification();
    },
    readBrowserGuestVerificationGeneration: (userId: string): number | null => browserGuestSessionPaused === false
      && sessionCsrfState === "guest" && sessionUserId === userId
      && verifiedBrowserGuestOwner?.userId === userId ? browserGuestVerificationGeneration : null,
    primeGuestSession: (userId: string, csrfToken: string): void => {
      sessionUserId = userId;
      const saved = readBrowserGuestState();
      verifiedBrowserGuestOwner = saved?.status === "owned" && saved.owner.userId === userId
        ? { userId, workspaceId: saved.owner.workspaceId } : null;
      sessionCsrfToken = csrfToken;
      sessionCsrfState = "guest";
    },
    primeSessionCsrfToken: (csrfToken: string): void => {
      sessionCsrfToken = csrfToken;
      sessionUserId = null;
      sessionCsrfState = "session";
    },
    requestResponse,
    recoverRegisteredCredentialForProbe,
    resetApiClientStateForTests,
    revalidateSession: (): Promise<SessionInfo> => loadSessionInfoWithRecovery(
      allowAuthRecoveryWithTransientNetworkRetry,
      null,
    ),
    setNavigationHandlerForTests: (handler: NavigateToUrl | null): void => {
      navigationHandler = handler;
    },
    throwIfRequestAborted,
  };
}
