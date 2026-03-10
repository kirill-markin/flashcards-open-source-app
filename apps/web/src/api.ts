import { getAppConfig } from "./config";
import { getStableDeviceId, webAppVersion } from "./clientIdentity";
import type {
  ChatDiagnosticsPayload,
  ChatMessage,
  LocalChatDiagnosticsPayload,
  LocalChatMessage,
  LocalChatRequestBody,
  QueryCardsInput,
  QueryCardsPage,
  SessionInfo,
  SyncPullResult,
  SyncPushOperation,
  SyncPushResult,
  AgentApiKeyConnectionsResponse,
  AgentApiKeyRevokeResponse,
  WorkspaceSummary,
} from "./types";

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class AuthRedirectError extends Error {
  readonly redirectUrl: string;

  constructor(redirectUrl: string) {
    super("Browser session expired. Redirecting to sign in.");
    this.redirectUrl = redirectUrl;
  }
}

type WorkspaceEnvelope = Readonly<{
  workspace: WorkspaceSummary;
}>;

type WorkspacesEnvelope = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
}>;

type JsonObject = Record<string, unknown>;
type SessionCsrfState = "unknown" | "session" | "non-session";
type AuthRecoveryMode = "allow" | "skip";
type NavigateToUrl = (url: string) => void;

export type ChatRequestBody = Readonly<{
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  timezone: string;
  deviceId: string;
  appVersion: string;
}>;

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

  if (init.body !== undefined && !headers.has("Content-Type")) {
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
    throw new ApiError(response.status, getJsonErrorMessage(payload, fallbackMessage));
  }

  return payload;
}

/**
 * Loads `/me` without attempting another refresh cycle. This function is used
 * only inside auth recovery to ensure a failed refresh cannot recurse forever.
 */
async function loadSessionInfoWithoutRecovery(): Promise<SessionInfo> {
  const response = await rawRequestResponse("/me", { method: "GET" });
  const payload = expectObject(await parseJsonPayload(response));
  const session = payload as unknown as SessionInfo;
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

function expectObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("API response must be a JSON object");
  }

  return value as JsonObject;
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
  const payload = expectObject(await requestJson("/me", { method: "GET" }, allowAuthRecovery));
  const session = payload as unknown as SessionInfo;
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  redirectInFlight = false;
  return session;
}

export async function listWorkspaces(): Promise<ReadonlyArray<WorkspaceSummary>> {
  const payload = expectObject(await requestJson("/workspaces", { method: "GET" }, allowAuthRecovery)) as unknown as WorkspacesEnvelope;
  return payload.workspaces;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const payload = expectObject(await requestJson("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  }, allowAuthRecovery)) as unknown as WorkspaceEnvelope;
  return payload.workspace;
}

export async function selectWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  const payload = expectObject(await requestJson(`/workspaces/${workspaceId}/select`, {
    method: "POST",
  }, allowAuthRecovery)) as unknown as WorkspaceEnvelope;
  return payload.workspace;
}

export async function listAgentApiKeys(): Promise<AgentApiKeyConnectionsResponse> {
  return expectObject(await requestJson("/agent-api-keys", { method: "GET" }, allowAuthRecovery)) as unknown as AgentApiKeyConnectionsResponse;
}

export async function revokeAgentApiKey(connectionId: string): Promise<AgentApiKeyRevokeResponse> {
  return expectObject(await requestJson(`/agent-api-keys/${connectionId}/revoke`, { method: "POST" }, allowAuthRecovery)) as unknown as AgentApiKeyRevokeResponse;
}

export async function pushSyncOperations(
  workspaceId: string,
  deviceId: string,
  platform: "web",
  appVersion: string,
  operations: ReadonlyArray<SyncPushOperation>,
): Promise<SyncPushResult> {
  const payload = expectObject(await requestJson(`/workspaces/${workspaceId}/sync/push`, {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      platform,
      appVersion,
      operations,
    }),
  }, allowAuthRecovery));

  return payload as unknown as SyncPushResult;
}

export async function pullSyncChanges(
  workspaceId: string,
  deviceId: string,
  platform: "web",
  appVersion: string,
  afterChangeId: number,
  limit: number,
): Promise<SyncPullResult> {
  const payload = expectObject(await requestJson(`/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      platform,
      appVersion,
      afterChangeId,
      limit,
    }),
  }, allowAuthRecovery));

  return payload as unknown as SyncPullResult;
}

export async function queryCards(
  workspaceId: string,
  input: QueryCardsInput,
): Promise<QueryCardsPage> {
  const payload = expectObject(await requestJson(`/workspaces/${workspaceId}/cards/query`, {
    method: "POST",
    body: JSON.stringify(input),
  }, allowAuthRecovery));

  return payload as unknown as QueryCardsPage;
}

export async function streamChat(body: ChatRequestBody, signal: AbortSignal): Promise<Response> {
  return requestResponse("/chat", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  }, allowAuthRecovery);
}

export async function streamLocalChat(body: LocalChatRequestBody, signal: AbortSignal): Promise<Response> {
  return requestResponse("/chat/local-turn", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  }, allowAuthRecovery);
}

export function createChatRequestBody(
  messages: ReadonlyArray<ChatMessage>,
  model: string,
  timezone: string,
): ChatRequestBody {
  return {
    messages,
    model,
    timezone,
    deviceId: getStableDeviceId(),
    appVersion: webAppVersion,
  };
}

export function createLocalChatRequestBody(
  messages: ReadonlyArray<LocalChatMessage>,
  model: string,
  timezone: string,
): LocalChatRequestBody {
  return {
    messages,
    model,
    timezone,
    devicePlatform: "web",
  };
}

export async function sendChatDiagnostics(body: ChatDiagnosticsPayload): Promise<void> {
  const response = await requestResponse("/chat/diagnostics", {
    method: "POST",
    body: JSON.stringify(body),
    keepalive: true,
  }, allowAuthRecovery);

  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`);
  }
}

export async function sendLocalChatDiagnostics(body: LocalChatDiagnosticsPayload): Promise<void> {
  const response = await requestResponse("/chat/local-turn/diagnostics", {
    method: "POST",
    body: JSON.stringify(body),
    keepalive: true,
  }, allowAuthRecovery);

  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`);
  }
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
