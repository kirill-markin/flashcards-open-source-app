import {
  ApiContractError,
  parseAgentApiKeyConnectionsEnvelopeResponse,
  parseAgentApiKeyRevokeResponse,
  parseChatSessionSnapshotResponse,
  parseChatTranscriptionResponse,
  parseDeleteAccountResponse,
  parseDeleteWorkspaceResponse,
  parseQueryCardsPageResponse,
  parseNewChatSessionResponse,
  parseSessionInfoResponse,
  parseStartChatRunResponse,
  parseStopChatRunResponse,
  parseSyncBootstrapPullResultResponse,
  parseSyncBootstrapPushResultResponse,
  parseSyncPullResultResponse,
  parseSyncPushResultResponse,
  parseSyncReviewHistoryImportResultResponse,
  parseSyncReviewHistoryPullResultResponse,
  parseWorkspaceDeletePreviewResponse,
  parseWorkspaceEnvelopeResponse,
  parseWorkspacesEnvelopeResponse,
} from "./apiContracts";
import { getAppConfig } from "./config";
import { webAppVersion } from "./clientIdentity";
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
  NewChatSessionResponse,
  ReviewEvent,
  SessionInfo,
  StartChatRunRequestBody,
  StartChatRunResponse,
  StopChatRunResponse,
  SyncBootstrapEntry,
  SyncBootstrapPullResult,
  SyncBootstrapPushResult,
  SyncPullResult,
  SyncPushOperation,
  SyncPushResult,
  SyncReviewHistoryImportResult,
  SyncReviewHistoryPullResult,
  WorkspaceDeletePreview,
  WorkspaceSummary,
} from "./types";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string | null;

  constructor(statusCode: number, message: string, code: string | null = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
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
type ChatResumeRequestDiagnostics = Readonly<{
  resumeAttemptId: number;
}>;

const collectionPageLimit = 100;

let sessionCsrfToken: string | null = null;
let sessionCsrfState: SessionCsrfState = "unknown";
let sessionRecoveryPromise: Promise<void> | null = null;
let redirectInFlight = false;
let navigationHandler: NavigateToUrl | null = null;

const allowAuthRecovery: Readonly<{ authRecoveryMode: AuthRecoveryMode }> = {
  authRecoveryMode: "allow",
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
function redirectToLogin(): never {
  const redirectUrl = buildLoginUrl(getCurrentReturnUrl());
  resetSessionState();

  if (redirectInFlight === false) {
    redirectInFlight = true;
    navigateToUrl(redirectUrl);
  }

  throw new AuthRedirectError(redirectUrl);
}

function getJsonErrorMessage(value: unknown, fallbackMessage: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fallbackMessage;
  }

  const objectValue = value as Record<string, unknown>;
  const errorValue = objectValue.error;
  return typeof errorValue === "string" && errorValue !== "" ? errorValue : fallbackMessage;
}

function getJsonErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const objectValue = value as Record<string, unknown>;
  return typeof objectValue.code === "string" && objectValue.code !== "" ? objectValue.code : null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function rawRequestResponse(pathname: string, init: RequestInit): Promise<Response> {
  const config = getAppConfig();
  try {
    return await fetch(`${config.apiBaseUrl}${pathname}`, {
      ...init,
      credentials: "include",
      headers: createHeaders(init),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The API is unavailable or not deployed yet. Try again. (${pathname}; ${message})`,
    );
  }
}

async function parseJsonPayload(response: Response): Promise<unknown> {
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    const fallbackMessage = typeof payload === "string" ? payload : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, getJsonErrorMessage(payload, fallbackMessage), getJsonErrorCode(payload));
  }

  return payload;
}

/**
 * Loads `/me` without attempting another refresh cycle. This function is used
 * only inside auth recovery to ensure a failed refresh cannot recurse forever.
 */
async function loadSessionInfoWithoutRecovery(): Promise<SessionInfo> {
  const response = await rawRequestResponse("/me", { method: "GET" });
  const session = parseSessionInfoResponse(await parseJsonPayload(response), "GET /me");
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
    throw new Error(`The auth service is unavailable. Try again. (/api/refresh-session; ${message})`);
  }

  if (response.ok) {
    return true;
  }

  if (response.status === 401) {
    resetSessionState();
    return false;
  }

  const payload = await readJsonResponse(response);
  const fallbackMessage = typeof payload === "string" ? payload : `Request failed with status ${response.status}`;
  throw new Error(getJsonErrorMessage(payload, fallbackMessage));
}

/**
 * Performs a single shared auth recovery operation for all concurrent browser
 * requests that observe the same expired session token.
 */
async function recoverSession(): Promise<void> {
  const activeRecovery = sessionRecoveryPromise;
  if (activeRecovery !== null) {
    return activeRecovery;
  }

  const recoveryTask = (async (): Promise<void> => {
    const refreshed = await refreshBrowserSession();
    if (refreshed === false) {
      redirectToLogin();
    }

    try {
      await loadSessionInfoWithoutRecovery();
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        redirectToLogin();
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
 * Wraps raw API fetches with a single silent refresh attempt. Every request is
 * retried at most once, and the retry only runs after `/me` has reloaded the
 * current session transport and CSRF token.
 */
async function requestResponse(
  pathname: string,
  init: RequestInit,
  options: Readonly<{ authRecoveryMode: AuthRecoveryMode }>,
): Promise<Response> {
  const response = await rawRequestResponse(pathname, init);
  if (response.status !== 401 || options.authRecoveryMode === "skip") {
    return response;
  }

  await recoverSession();
  return rawRequestResponse(pathname, init);
}

async function requestJson(
  pathname: string,
  init: RequestInit,
  options: Readonly<{ authRecoveryMode: AuthRecoveryMode }>,
): Promise<unknown> {
  const response = await requestResponse(pathname, init, options);
  return parseJsonPayload(response);
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
  const session = parseSessionInfoResponse(await requestJson("/me", { method: "GET" }, allowAuthRecovery), "GET /me");
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

    const payload = parseWorkspacesEnvelopeResponse(
      await requestJson(`/workspaces?${searchParams.toString()}`, { method: "GET" }, allowAuthRecovery),
      "GET /workspaces",
    );
    workspaces.push(...payload.workspaces);
    nextCursor = payload.nextCursor;
  } while (nextCursor !== null);

  return workspaces;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const payload = parseWorkspaceEnvelopeResponse(await requestJson("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  }, allowAuthRecovery), "POST /workspaces");
  return payload.workspace;
}

export async function selectWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  const payload = parseWorkspaceEnvelopeResponse(await requestJson(`/workspaces/${workspaceId}/select`, {
    method: "POST",
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/select`);
  return payload.workspace;
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary> {
  const payload = parseWorkspaceEnvelopeResponse(await requestJson(`/workspaces/${workspaceId}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/rename`);
  return payload.workspace;
}

export async function loadWorkspaceDeletePreview(workspaceId: string): Promise<WorkspaceDeletePreview> {
  return parseWorkspaceDeletePreviewResponse(await requestJson(`/workspaces/${workspaceId}/delete-preview`, {
    method: "GET",
  }, allowAuthRecovery), `GET /workspaces/${workspaceId}/delete-preview`);
}

export async function deleteWorkspace(workspaceId: string, confirmationText: string): Promise<DeleteWorkspaceResponse> {
  return parseDeleteWorkspaceResponse(await requestJson(`/workspaces/${workspaceId}/delete`, {
    method: "POST",
    body: JSON.stringify({ confirmationText }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/delete`);
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

    const payload = parseAgentApiKeyConnectionsEnvelopeResponse(
      await requestJson(`/agent-api-keys?${searchParams.toString()}`, { method: "GET" }, allowAuthRecovery),
      "GET /agent-api-keys",
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
  return parseAgentApiKeyRevokeResponse(
    await requestJson(`/agent-api-keys/${connectionId}/revoke`, { method: "POST" }, allowAuthRecovery),
    `POST /agent-api-keys/${connectionId}/revoke`,
  );
}

export async function deleteMyAccount(confirmationText: string): Promise<Readonly<{ ok: true }>> {
  return parseDeleteAccountResponse(await requestJson("/me/delete", {
    method: "POST",
    body: JSON.stringify({
      confirmationText,
    }),
  }, allowAuthRecovery), "POST /me/delete");
}

export async function pushSyncOperations(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  operations: ReadonlyArray<SyncPushOperation>,
): Promise<SyncPushResult> {
  return parseSyncPushResultResponse(await requestJson(`/workspaces/${workspaceId}/sync/push`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      operations,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/push`);
}

export async function pullSyncChanges(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  afterHotChangeId: number,
  limit: number,
): Promise<SyncPullResult> {
  return parseSyncPullResultResponse(await requestJson(`/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      afterHotChangeId,
      limit,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/pull`);
}

export async function bootstrapPullSyncState(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  cursor: string | null,
  limit: number,
): Promise<SyncBootstrapPullResult> {
  return parseSyncBootstrapPullResultResponse(await requestJson(`/workspaces/${workspaceId}/sync/bootstrap`, {
    method: "POST",
    body: JSON.stringify({
      mode: "pull",
      installationId,
      platform,
      appVersion,
      cursor,
      limit,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/bootstrap`);
}

export async function bootstrapPushSyncState(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  entries: ReadonlyArray<SyncBootstrapEntry>,
): Promise<SyncBootstrapPushResult> {
  return parseSyncBootstrapPushResultResponse(await requestJson(`/workspaces/${workspaceId}/sync/bootstrap`, {
    method: "POST",
    body: JSON.stringify({
      mode: "push",
      installationId,
      platform,
      appVersion,
      entries,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/bootstrap`);
}

export async function pullReviewHistorySync(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  afterReviewSequenceId: number,
  limit: number,
): Promise<SyncReviewHistoryPullResult> {
  return parseSyncReviewHistoryPullResultResponse(await requestJson(`/workspaces/${workspaceId}/sync/review-history/pull`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      afterReviewSequenceId,
      limit,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/review-history/pull`);
}

export async function importReviewHistorySync(
  workspaceId: string,
  installationId: string,
  platform: "web",
  appVersion: string,
  reviewEvents: ReadonlyArray<ReviewEvent>,
): Promise<SyncReviewHistoryImportResult> {
  return parseSyncReviewHistoryImportResultResponse(await requestJson(`/workspaces/${workspaceId}/sync/review-history/import`, {
    method: "POST",
    body: JSON.stringify({
      installationId,
      platform,
      appVersion,
      reviewEvents,
    }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/sync/review-history/import`);
}

export async function queryCards(
  workspaceId: string,
  input: QueryCardsInput,
): Promise<QueryCardsPage> {
  return parseQueryCardsPageResponse(await requestJson(`/workspaces/${workspaceId}/cards/query`, {
    method: "POST",
    body: JSON.stringify(input),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/cards/query`);
}

export async function getChatSnapshot(sessionId?: string): Promise<ChatSessionSnapshot> {
  const pathname = sessionId === undefined
    ? "/chat"
    : `/chat?sessionId=${encodeURIComponent(sessionId)}`;

  return parseChatSessionSnapshotResponse(await requestJson(pathname, {
    method: "GET",
  }, allowAuthRecovery), "GET /chat");
}

export async function getChatSnapshotWithResumeDiagnostics(
  sessionId: string | undefined,
  diagnostics: ChatResumeRequestDiagnostics,
): Promise<ChatSessionSnapshot> {
  const pathname = sessionId === undefined
    ? "/chat"
    : `/chat?sessionId=${encodeURIComponent(sessionId)}`;

  return parseChatSessionSnapshotResponse(await requestJson(pathname, {
    method: "GET",
    headers: {
      "X-Chat-Resume-Attempt-Id": String(diagnostics.resumeAttemptId),
      "X-Client-Platform": "web",
      "X-Client-Version": webAppVersion,
    },
  }, allowAuthRecovery), "GET /chat");
}

export async function startChatRun(body: StartChatRunRequestBody): Promise<StartChatRunResponse> {
  return parseStartChatRunResponse(await requestJson("/chat", {
    method: "POST",
    body: JSON.stringify(body),
  }, allowAuthRecovery), "POST /chat");
}

export async function createNewChatSession(
  sessionId: string | undefined,
): Promise<NewChatSessionResponse> {
  return parseNewChatSessionResponse(await requestJson("/chat/new", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
    }),
  }, allowAuthRecovery), "POST /chat/new");
}

export async function stopChatRun(sessionId: string): Promise<StopChatRunResponse> {
  return parseStopChatRunResponse(await requestJson("/chat/stop", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  }, allowAuthRecovery), "POST /chat/stop");
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
  sessionId?: string,
): Promise<ChatTranscriptionResponse> {
  const mediaType = normalizeAudioMediaType(blob.type === "" ? "audio/webm" : blob.type);
  const file = new File([blob], `chat-dictation.${extensionForAudioMediaType(mediaType)}`, { type: mediaType });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source", source);
  if (sessionId !== undefined) {
    formData.append("sessionId", sessionId);
  }

  return parseChatTranscriptionResponse(await requestJson("/chat/transcriptions", {
    method: "POST",
    body: formData,
  }, allowAuthRecovery), "POST /chat/transcriptions");
}

/**
 * Builds an auth login URL that preserves the exact in-app location the user
 * should return to after silent refresh or interactive sign-in completes.
 */
export function buildLoginUrl(returnUrl: string): string {
  const config = getAppConfig();
  return `${config.authBaseUrl}/login?redirect_uri=${encodeURIComponent(returnUrl)}`;
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
