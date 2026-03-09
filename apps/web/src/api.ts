import { getAppConfig } from "./config";
import { getStableDeviceId, webAppVersion } from "./clientIdentity";
import type {
  ChatDiagnosticsPayload,
  ChatMessage,
  SessionInfo,
  SyncPullResult,
  SyncPushOperation,
  SyncPushResult,
  WorkspaceSummary,
} from "./types";

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
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

export type ChatRequestBody = Readonly<{
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  timezone: string;
  deviceId: string;
  appVersion: string;
}>;

let sessionCsrfToken: string | null = null;
let sessionCsrfState: SessionCsrfState = "unknown";

function setSessionCsrfToken(csrfToken: string | null, authTransport: string): void {
  sessionCsrfToken = csrfToken;
  sessionCsrfState = authTransport === "session" ? "session" : "non-session";
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function getMethod(init: RequestInit): string {
  return typeof init.method === "string" && init.method !== "" ? init.method.toUpperCase() : "GET";
}

function createHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
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

async function requestResponse(pathname: string, init: RequestInit): Promise<Response> {
  const config = getAppConfig();
  return fetch(`${config.apiBaseUrl}${pathname}`, {
    ...init,
    credentials: "include",
    headers: createHeaders(init),
  });
}

async function requestJson(pathname: string, init: RequestInit): Promise<unknown> {
  const response = await requestResponse(pathname, init);
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    const fallbackMessage = typeof payload === "string" ? payload : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, getJsonErrorMessage(payload, fallbackMessage));
  }

  return payload;
}

function expectObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("API response must be a JSON object");
  }

  return value as JsonObject;
}

export async function getSession(): Promise<SessionInfo> {
  const payload = expectObject(await requestJson("/me", { method: "GET" }));
  const session = payload as unknown as SessionInfo;
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  return session;
}

export async function listWorkspaces(): Promise<ReadonlyArray<WorkspaceSummary>> {
  const payload = expectObject(await requestJson("/workspaces", { method: "GET" })) as unknown as WorkspacesEnvelope;
  return payload.workspaces;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const payload = expectObject(await requestJson("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  })) as unknown as WorkspaceEnvelope;
  return payload.workspace;
}

export async function selectWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  const payload = expectObject(await requestJson(`/workspaces/${workspaceId}/select`, {
    method: "POST",
  })) as unknown as WorkspaceEnvelope;
  return payload.workspace;
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
  }));

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
  }));

  return payload as unknown as SyncPullResult;
}

export async function streamChat(body: ChatRequestBody, signal: AbortSignal): Promise<Response> {
  return requestResponse("/chat", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
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

export async function sendChatDiagnostics(body: ChatDiagnosticsPayload): Promise<void> {
  const response = await requestResponse("/chat/diagnostics", {
    method: "POST",
    body: JSON.stringify(body),
    keepalive: true,
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`);
  }
}

export function buildLoginUrl(): string {
  const config = getAppConfig();
  const redirectUri = `${config.appBaseUrl}/`;
  return `${config.authBaseUrl}/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export function buildLogoutUrl(): string {
  const config = getAppConfig();
  const redirectUri = `${config.appBaseUrl}/`;
  return `${config.authBaseUrl}/logout?redirect_uri=${encodeURIComponent(redirectUri)}`;
}
