import {
  parseAgentApiKeyConnectionsEnvelopeResponse,
  parseAgentApiKeyRevokeResponse,
  parseDeleteAccountResponse,
  parseDeleteWorkspaceResponse,
  parseResetWorkspaceProgressResponse,
  parseSessionInfoResponse,
  parseWorkspaceDeletePreviewResponse,
  parseWorkspaceEnvelopeResponse,
  parseWorkspaceResetProgressPreviewResponse,
  parseWorkspacesEnvelopeResponse,
} from "./apiContracts/account";
import {
  parseChatSessionSnapshotResponse,
  parseChatTranscriptionResponse,
  parseNewChatSessionResponse,
  parseStartChatRunResponse,
  parseStopChatRunResponse,
} from "./apiContracts/chat";
import {
  ApiContractError,
  enrichApiContractError,
} from "./apiContracts/core";
import {
  parseQueryCardsPageResponse,
} from "./apiContracts/cards";
import {
  parseProgressReviewScheduleResponse,
  parseProgressSummaryResponse,
  parseProgressSeriesResponse,
} from "./apiContracts/progress";
import {
  parseSyncBootstrapPullResultResponse,
  parseSyncBootstrapPushResultResponse,
  parseSyncPullResultResponse,
  parseSyncPushResultResponse,
  parseSyncReviewHistoryImportResultResponse,
  parseSyncReviewHistoryPullResultResponse,
} from "./apiContracts/sync";
import { markAuthResetRequired, runPendingAuthResetCleanup } from "./accountDeletion";
import { getAppConfig } from "./config";
import { webAppVersion } from "./clientIdentity";
import { getDefaultLocale, resolveSupportedLocale } from "./i18n/locales";
import { readStoredLocalePreference, resolveLocaleState } from "./i18n/runtime";
import type { Locale } from "./i18n/types";
import type {
  AgentApiKeyConnection,
  AgentApiKeyConnectionsResponse,
  AgentApiKeyRevokeResponse,
  ChatSessionSnapshot,
  ChatTranscriptionResponse,
  ChatTranscriptionSource,
  DeleteWorkspaceResponse,
  QueryCardsInput,
  QueryCardsPage,
  NewChatSessionRequestBody,
  NewChatSessionResponse,
  ProgressReviewSchedule,
  ProgressReviewScheduleInput,
  ProgressSummaryPayload,
  ProgressSeries,
  ProgressSummaryInput,
  ProgressSeriesInput,
  ReviewEvent,
  SessionInfo,
  StartChatRunRequestBody,
  StartChatRunResponse,
  StopChatRunRequestBody,
  StopChatRunResponse,
  SyncBootstrapEntry,
  SyncBootstrapPullResult,
  SyncBootstrapPushResult,
  SyncPullResult,
  SyncPushOperation,
  SyncPushResult,
  SyncReviewHistoryImportResult,
  SyncReviewHistoryPullResult,
  ResetWorkspaceProgressResponse,
  WorkspaceResetProgressPreview,
  WorkspaceDeletePreview,
  WorkspaceSummary,
} from "./types";

export type ApiResponseBodyKind = "empty" | "json" | "text" | "invalid_json";

type ApiErrorParams = Readonly<{
  statusCode: number;
  message: string;
  code: string | null;
  requestId: string | null;
  endpoint: string;
  responseBodyKind: ApiResponseBodyKind;
}>;

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly endpoint: string;
  readonly responseBodyKind: ApiResponseBodyKind;

  constructor(params: ApiErrorParams) {
    super(params.message);
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.requestId = params.requestId;
    this.endpoint = params.endpoint;
    this.responseBodyKind = params.responseBodyKind;
  }
}

export class AuthRedirectError extends Error {
  readonly redirectUrl: string;

  constructor(redirectUrl: string) {
    super("Browser session expired. Redirecting to sign in.");
    this.redirectUrl = redirectUrl;
  }
}

export { ApiContractError };

type SessionCsrfState = "unknown" | "session" | "non-session";
type AuthRecoveryMode = "allow" | "skip";
type NavigateToUrl = (url: string) => void;
type PrepareForAuthRedirect = () => void;
type RequestOptions = Readonly<{
  authRecoveryMode: AuthRecoveryMode;
  prepareForAuthRedirect: PrepareForAuthRedirect | null;
}>;
type ChatResumeRequestDiagnostics = Readonly<{
  resumeAttemptId: number;
}>;
type ParsedResponsePayload = Readonly<{
  value: unknown;
  bodyKind: ApiResponseBodyKind;
  requestId: string | null;
  statusCode: number;
  code: string | null;
}>;
type JsonObject = Readonly<{
  readonly [key: string]: unknown;
}>;
type ContractResponseParser<ParsedValue> = (value: unknown, endpoint: string) => ParsedValue;
export type AuthUiLocale = Locale;

const collectionPageLimit = 100;
const staleSessionCsrfTokenErrorCode = "SESSION_CSRF_TOKEN_INVALID";
const staleSessionCsrfTokenErrorMessage = "Invalid X-CSRF-Token header";
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

const allowAuthRecovery: RequestOptions = {
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

function normalizeAuthUiLocale(localeHint: string): AuthUiLocale | null {
  return resolveSupportedLocale(localeHint);
}

export function getPreferredAuthUiLocale(): AuthUiLocale {
  const resolvedLocale = normalizeAuthUiLocale(resolveLocaleState(readStoredLocalePreference()).locale);
  return resolvedLocale ?? getDefaultLocale();
}

/**
 * Starts the browser auth redirect flow exactly once per auth failure burst.
 * The current route is preserved so the user returns to the same screen after
 * refresh or interactive sign-in completes on the auth origin.
 */
async function redirectToLogin(prepareForAuthRedirect: PrepareForAuthRedirect | null): Promise<never> {
  const redirectUrl = buildLoginUrl(getCurrentReturnUrl(), getPreferredAuthUiLocale());
  resetSessionState();

  if (prepareForAuthRedirect !== null) {
    prepareForAuthRedirect();
  }

  if (redirectInFlight === false) {
    redirectInFlight = true;
    navigateToUrl(redirectUrl);
  }

  throw new AuthRedirectError(redirectUrl);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return true;
}

function getJsonErrorMessage(value: unknown, fallbackMessage: string): string {
  if (isJsonObject(value) === false) {
    return fallbackMessage;
  }

  const objectValue = value;
  const errorValue = objectValue.error;
  return typeof errorValue === "string" && errorValue !== "" ? errorValue : fallbackMessage;
}

function getJsonErrorCode(value: unknown): string | null {
  if (isJsonObject(value) === false) {
    return null;
  }

  const objectValue = value;
  return typeof objectValue.code === "string" && objectValue.code !== "" ? objectValue.code : null;
}

function isRecoverableSessionCsrfPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value === staleSessionCsrfTokenErrorMessage;
  }

  const objectValue = value as Record<string, unknown>;
  return objectValue.code === staleSessionCsrfTokenErrorCode
    || objectValue.error === staleSessionCsrfTokenErrorMessage;
}

function getJsonRequestId(value: unknown): string | null {
  if (isJsonObject(value) === false) {
    return null;
  }

  const requestId = value.requestId;
  return typeof requestId === "string" && requestId.trim() !== "" ? requestId : null;
}

function getHeaderRequestId(response: Response): string | null {
  const requestId = response.headers.get("X-Request-Id")
    ?? response.headers.get("X-Amzn-RequestId")
    ?? response.headers.get("X-Amz-Apigw-Id");
  return requestId === null || requestId.trim() === "" ? null : requestId;
}

function resolveResponseBodyKind(response: Response): ApiResponseBodyKind {
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.toLowerCase().includes("json") ? "invalid_json" : "text";
}

async function readJsonResponse(response: Response): Promise<ParsedResponsePayload> {
  const text = await response.text();
  const headerRequestId = getHeaderRequestId(response);
  if (text === "") {
    return {
      value: null,
      bodyKind: "empty",
      requestId: headerRequestId,
      statusCode: response.status,
      code: null,
    };
  }

  try {
    const value = JSON.parse(text) as unknown;
    return {
      value,
      bodyKind: "json",
      requestId: headerRequestId ?? getJsonRequestId(value),
      statusCode: response.status,
      code: getJsonErrorCode(value),
    };
  } catch {
    return {
      value: text,
      bodyKind: resolveResponseBodyKind(response),
      requestId: headerRequestId,
      statusCode: response.status,
      code: null,
    };
  }
}

async function parseJsonPayload(response: Response, endpoint: string): Promise<ParsedResponsePayload> {
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    const fallbackMessage = typeof payload.value === "string" ? payload.value : `Request failed with status ${response.status}`;
    throw new ApiError({
      statusCode: response.status,
      message: getJsonErrorMessage(payload.value, fallbackMessage),
      code: payload.code,
      requestId: payload.requestId,
      endpoint,
      responseBodyKind: payload.bodyKind,
    });
  }

  return payload;
}

async function isRecoverableSessionCsrfResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }

  return isRecoverableSessionCsrfPayload((await readJsonResponse(response.clone())).value);
}

function parseContractResponse<ParsedValue>(
  payload: ParsedResponsePayload,
  endpoint: string,
  parsePayload: ContractResponseParser<ParsedValue>,
): ParsedValue {
  try {
    return parsePayload(payload.value, endpoint);
  } catch (error) {
    if (error instanceof ApiContractError) {
      throw enrichApiContractError(error, {
        requestId: payload.requestId,
        statusCode: payload.statusCode,
        code: payload.code,
        responseBodyKind: payload.bodyKind,
      });
    }

    throw error;
  }
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
async function recoverSession(prepareForAuthRedirect: PrepareForAuthRedirect | null): Promise<void> {
  const activeRecovery = sessionRecoveryPromise;
  if (activeRecovery !== null) {
    return activeRecovery;
  }

  const recoveryTask = (async (): Promise<void> => {
    const refreshed = await refreshBrowserSession();
    if (refreshed === false) {
      await redirectToLogin(prepareForAuthRedirect);
    }

    try {
      await loadSessionInfoWithoutRecovery();
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        await redirectToLogin(prepareForAuthRedirect);
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

async function requestJson(
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

export async function listWorkspaces(): Promise<ReadonlyArray<WorkspaceSummary>> {
  const workspaces: Array<WorkspaceSummary> = [];
  let nextCursor: string | null = null;

  do {
    const searchParams = new URLSearchParams({
      limit: String(collectionPageLimit),
    });
    if (nextCursor !== null) {
      searchParams.set("cursor", nextCursor);
    }

    const payload = parseContractResponse(
      await requestJson(`/workspaces?${searchParams.toString()}`, { method: "GET" }, allowAuthRecovery),
      "GET /workspaces",
      parseWorkspacesEnvelopeResponse,
    );
    workspaces.push(...payload.workspaces);
    nextCursor = payload.nextCursor;
  } while (nextCursor !== null);

  return workspaces;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const payload = parseContractResponse(await requestJson("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  }, allowAuthRecovery), "POST /workspaces", parseWorkspaceEnvelopeResponse);
  return payload.workspace;
}

export async function selectWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  const payload = parseContractResponse(await requestJson(`/workspaces/${workspaceId}/select`, {
    method: "POST",
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/select`, parseWorkspaceEnvelopeResponse);
  return payload.workspace;
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary> {
  const payload = parseContractResponse(await requestJson(`/workspaces/${workspaceId}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/rename`, parseWorkspaceEnvelopeResponse);
  return payload.workspace;
}

export async function loadWorkspaceDeletePreview(workspaceId: string): Promise<WorkspaceDeletePreview> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/delete-preview`, {
    method: "GET",
  }, allowAuthRecovery), `GET /workspaces/${workspaceId}/delete-preview`, parseWorkspaceDeletePreviewResponse);
}

export async function deleteWorkspace(workspaceId: string, confirmationText: string): Promise<DeleteWorkspaceResponse> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/delete`, {
    method: "POST",
    body: JSON.stringify({ confirmationText }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/delete`, parseDeleteWorkspaceResponse);
}

export async function loadWorkspaceResetProgressPreview(
  workspaceId: string,
): Promise<WorkspaceResetProgressPreview> {
  return parseContractResponse(
    await requestJson(`/workspaces/${workspaceId}/reset-progress-preview`, {
      method: "GET",
    }, allowAuthRecovery),
    `GET /workspaces/${workspaceId}/reset-progress-preview`,
    parseWorkspaceResetProgressPreviewResponse,
  );
}

export async function resetWorkspaceProgress(
  workspaceId: string,
  confirmationText: string,
): Promise<ResetWorkspaceProgressResponse> {
  return parseContractResponse(
    await requestJson(`/workspaces/${workspaceId}/reset-progress`, {
      method: "POST",
      body: JSON.stringify({ confirmationText }),
    }, allowAuthRecovery),
    `POST /workspaces/${workspaceId}/reset-progress`,
    parseResetWorkspaceProgressResponse,
  );
}

export async function listAgentApiKeys(): Promise<AgentApiKeyConnectionsResponse> {
  const connections: Array<AgentApiKeyConnection> = [];
  let instructions = "";
  let nextCursor: string | null = null;

  do {
    const searchParams = new URLSearchParams({
      limit: String(collectionPageLimit),
    });
    if (nextCursor !== null) {
      searchParams.set("cursor", nextCursor);
    }

    const payload = parseContractResponse(
      await requestJson(`/agent-api-keys?${searchParams.toString()}`, { method: "GET" }, allowAuthRecovery),
      "GET /agent-api-keys",
      parseAgentApiKeyConnectionsEnvelopeResponse,
    );
    connections.push(...payload.connections);
    instructions = payload.instructions;
    nextCursor = payload.nextCursor;
  } while (nextCursor !== null);

  return {
    connections,
    instructions,
  };
}

export async function revokeAgentApiKey(connectionId: string): Promise<AgentApiKeyRevokeResponse> {
  return parseContractResponse(
    await requestJson(`/agent-api-keys/${connectionId}/revoke`, { method: "POST" }, allowAuthRecovery),
    `POST /agent-api-keys/${connectionId}/revoke`,
    parseAgentApiKeyRevokeResponse,
  );
}

export async function deleteMyAccount(confirmationText: string): Promise<Readonly<{ ok: true }>> {
  return parseContractResponse(await requestJson("/me/delete", {
    method: "POST",
    body: JSON.stringify({
      confirmationText,
    }),
  }, allowAuthRecovery), "POST /me/delete", parseDeleteAccountResponse);
}

export async function loadProgressSummary(input: ProgressSummaryInput): Promise<ProgressSummaryPayload> {
  const searchParams = new URLSearchParams({
    timeZone: input.timeZone,
  });

  return parseContractResponse(
    await requestJson(`/me/progress/summary?${searchParams.toString()}`, {
      method: "GET",
    }, allowAuthRecovery),
    "GET /me/progress/summary",
    parseProgressSummaryResponse,
  );
}

export async function loadProgressSeries(input: ProgressSeriesInput): Promise<ProgressSeries> {
  const searchParams = new URLSearchParams({
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
  });

  return parseContractResponse(
    await requestJson(`/me/progress/series?${searchParams.toString()}`, {
      method: "GET",
    }, allowAuthRecovery),
    "GET /me/progress/series",
    parseProgressSeriesResponse,
  );
}

export async function loadProgressReviewSchedule(
  input: ProgressReviewScheduleInput,
): Promise<ProgressReviewSchedule> {
  const searchParams = new URLSearchParams({
    timeZone: input.timeZone,
  });
  const endpoint = "GET /me/progress/review-schedule";
  return parseContractResponse(
    await requestJson(`/me/progress/review-schedule?${searchParams.toString()}`, {
      method: "GET",
    }, allowAuthRecovery),
    endpoint,
    (value: unknown, parseEndpoint: string): ProgressReviewSchedule => {
      const schedule = parseProgressReviewScheduleResponse(value, parseEndpoint);
      if (schedule.timeZone !== input.timeZone) {
        throw new ApiContractError(parseEndpoint, "timeZone", JSON.stringify(input.timeZone));
      }

      return schedule;
    },
  );
}

export async function pushSyncOperations(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  operations: ReadonlyArray<SyncPushOperation>,
): Promise<SyncPushResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/push`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      operations,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/push`, parseSyncPushResultResponse);
}

export async function pullSyncChanges(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  afterHotChangeId: number,
  limit: number,
): Promise<SyncPullResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      afterHotChangeId,
      limit,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/pull`, parseSyncPullResultResponse);
}

export async function bootstrapPullSyncState(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  cursor: string | null,
  limit: number,
): Promise<SyncBootstrapPullResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/bootstrap`, {
    method: "POST",
    body: JSON.stringify({
      mode: "pull",
      installationId,
      platform,
      appVersion,
      cursor,
      limit,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/bootstrap`, parseSyncBootstrapPullResultResponse);
}

export async function bootstrapPushSyncState(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  entries: ReadonlyArray<SyncBootstrapEntry>,
): Promise<SyncBootstrapPushResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/bootstrap`, {
    method: "POST",
    body: JSON.stringify({
      mode: "push",
      installationId,
      platform,
      appVersion,
      entries,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/bootstrap`, parseSyncBootstrapPushResultResponse);
}

export async function pullReviewHistorySync(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  afterReviewSequenceId: number,
  limit: number,
): Promise<SyncReviewHistoryPullResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/review-history/pull`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      afterReviewSequenceId,
      limit,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/review-history/pull`, parseSyncReviewHistoryPullResultResponse);
}

export async function importReviewHistorySync(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  reviewEvents: ReadonlyArray<ReviewEvent>,
): Promise<SyncReviewHistoryImportResult> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/sync/review-history/import`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      reviewEvents,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/review-history/import`, parseSyncReviewHistoryImportResultResponse);
}

export async function queryCards(
  workspaceId: string,
  input: QueryCardsInput,
): Promise<QueryCardsPage> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/cards/query`, {
    method: "POST",
    body: JSON.stringify(input),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/cards/query`, parseQueryCardsPageResponse);
}

function buildChatSnapshotPath(sessionId: string, workspaceId: string): string {
  const searchParams = new URLSearchParams({
    sessionId,
    workspaceId,
  });
  return `/chat?${searchParams.toString()}`;
}

export async function getChatSnapshot(sessionId: string, workspaceId: string): Promise<ChatSessionSnapshot> {
  return parseContractResponse(await requestJson(buildChatSnapshotPath(sessionId, workspaceId), {
    method: "GET",
  }, allowAuthRecovery), "GET /chat", parseChatSessionSnapshotResponse);
}

export async function getChatSnapshotWithResumeDiagnostics(
  sessionId: string,
  workspaceId: string,
  diagnostics: ChatResumeRequestDiagnostics,
): Promise<ChatSessionSnapshot> {
  return parseContractResponse(await requestJson(buildChatSnapshotPath(sessionId, workspaceId), {
    method: "GET",
    headers: {
      "X-Chat-Resume-Attempt-Id": String(diagnostics.resumeAttemptId),
      "X-Client-Platform": "web",
      "X-Client-Version": webAppVersion,
    },
  }, allowAuthRecovery), "GET /chat", parseChatSessionSnapshotResponse);
}

export async function startChatRun(body: StartChatRunRequestBody): Promise<StartChatRunResponse> {
  return parseContractResponse(await requestJson("/chat", {
    method: "POST",
    body: JSON.stringify(body),
  }, allowAuthRecovery), "POST /chat", parseStartChatRunResponse);
}

export async function createNewChatSession(
  sessionId: string,
  workspaceId: string,
  uiLocale: Locale,
): Promise<NewChatSessionResponse> {
  const requestBody: NewChatSessionRequestBody = {
    sessionId,
    workspaceId,
    uiLocale,
  };

  return parseContractResponse(await requestJson("/chat/new", {
    method: "POST",
    body: JSON.stringify(requestBody),
  }, allowAuthRecovery), "POST /chat/new", parseNewChatSessionResponse);
}

export async function stopChatRun(
  sessionId: string,
  workspaceId: string,
  runId: string | null,
): Promise<StopChatRunResponse> {
  const requestBody: StopChatRunRequestBody = runId === null
    ? {
      sessionId,
      workspaceId,
    }
    : {
      sessionId,
      workspaceId,
      runId,
    };

  return parseContractResponse(await requestJson("/chat/stop", {
    method: "POST",
    body: JSON.stringify(requestBody),
  }, allowAuthRecovery), "POST /chat/stop", parseStopChatRunResponse);
}

function extensionForAudioMediaType(mediaType: string): string {
  if (mediaType === "audio/wav" || mediaType === "audio/wave" || mediaType === "audio/x-wav") {
    return "wav";
  }

  if (mediaType === "audio/mp4" || mediaType === "audio/m4a" || mediaType === "audio/x-m4a") {
    return "m4a";
  }

  return "webm";
}

function normalizeAudioMediaType(mediaType: string): string {
  const normalizedMediaType = mediaType.trim().toLowerCase();
  const [baseMediaType] = normalizedMediaType.split(";", 1);

  if (baseMediaType === "audio/wav" || baseMediaType === "audio/wave" || baseMediaType === "audio/x-wav") {
    return "audio/wav";
  }

  if (baseMediaType === "audio/mp4" || baseMediaType === "audio/m4a" || baseMediaType === "audio/x-m4a") {
    return "audio/mp4";
  }

  return "audio/webm";
}

export async function transcribeChatAudio(
  blob: Blob,
  source: ChatTranscriptionSource,
  sessionId: string,
  workspaceId: string,
): Promise<ChatTranscriptionResponse> {
  const mediaType = normalizeAudioMediaType(blob.type === "" ? "audio/webm" : blob.type);
  const file = new File([blob], `chat-dictation.${extensionForAudioMediaType(mediaType)}`, { type: mediaType });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source", source);
  formData.append("sessionId", sessionId);
  formData.append("workspaceId", workspaceId);

  return parseContractResponse(await requestJson("/chat/transcriptions", {
    method: "POST",
    body: formData,
  }, allowAuthRecovery), "POST /chat/transcriptions", parseChatTranscriptionResponse);
}

/**
 * Builds an auth login URL that preserves the exact in-app location the user
 * should return to after silent refresh or interactive sign-in completes.
 */
export function buildLoginUrl(returnUrl: string, localeHint: string): string {
  const config = getAppConfig();
  const loginUrl = new URL(`${config.authBaseUrl}/login`);
  loginUrl.searchParams.set("redirect_uri", returnUrl);

  const sanitizedLocaleHint = normalizeAuthUiLocale(localeHint);
  if (sanitizedLocaleHint !== null) {
    loginUrl.searchParams.set("locale", sanitizedLocaleHint);
  }

  return loginUrl.toString();
}

export function buildLogoutUrl(): string {
  const config = getAppConfig();
  const redirectUri = `${config.appBaseUrl}/`;
  return `${config.authBaseUrl}/logout?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export function buildLogoutLocalUrl(): string {
  const config = getAppConfig();
  const redirectUri = `${config.appBaseUrl}/`;
  return `${config.authBaseUrl}/logout-local?redirect_uri=${encodeURIComponent(redirectUri)}`;
}
