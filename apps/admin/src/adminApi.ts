import type { AdminAppConfig } from "./config";

type AdminAuthTransport = "session" | "none";

export type AdminSession = Readonly<{
  email: string;
  isAdmin: true;
  authTransport: AdminAuthTransport;
  csrfToken: string | null;
}>;

export type AdminQueryScalar = string | number | boolean | null;

export interface AdminQueryObject {
  readonly [key: string]: AdminQueryValue;
}

export interface AdminQueryArray extends ReadonlyArray<AdminQueryValue> {}

export type AdminQueryValue = AdminQueryScalar | AdminQueryArray | AdminQueryObject;

export type AdminQueryRow = Readonly<Record<string, AdminQueryValue>>;

export type AdminQueryResultSet = Readonly<{
  statementIndex: number;
  columns: ReadonlyArray<string>;
  rowCount: number;
  rows: ReadonlyArray<AdminQueryRow>;
}>;

export type AdminQueryResponse = Readonly<{
  executedAtUtc: string;
  resultSets: ReadonlyArray<AdminQueryResultSet>;
}>;

export const reviewEventPlatforms = ["web", "android", "ios"] as const;

export type ReviewEventPlatform = (typeof reviewEventPlatforms)[number];

export type ReviewEventsByDateUser = Readonly<{
  userId: string;
  email: string;
  totalReviewEvents: number;
}>;

export type ReviewEventsByDateTotal = Readonly<{
  date: string;
  totalReviewEvents: number;
}>;

export type ReviewEventsByDateUniqueUserCohort = Readonly<{
  date: string;
  newReviewingUsers: number;
  returningReviewingUsers: number;
}>;

export type ReviewEventsByDatePlatformActiveUserTotal = Readonly<{
  date: string;
  platform: ReviewEventPlatform;
  activeUserCount: number;
}>;

export type ReviewEventsByDatePlatformReviewEventTotal = Readonly<{
  date: string;
  platform: ReviewEventPlatform;
  reviewEventCount: number;
}>;

export type ReviewEventsByDateRow = Readonly<{
  date: string;
  userId: string;
  email: string;
  platform: ReviewEventPlatform;
  reviewEventCount: number;
  firstReviewDate: string;
}>;

export type ReviewEventsByDateReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  totalReviewEvents: number;
  users: ReadonlyArray<ReviewEventsByDateUser>;
  dateTotals: ReadonlyArray<ReviewEventsByDateTotal>;
  dailyUniqueUserCohorts: ReadonlyArray<ReviewEventsByDateUniqueUserCohort>;
  platformActiveUserTotals: ReadonlyArray<ReviewEventsByDatePlatformActiveUserTotal>;
  platformReviewEventTotals: ReadonlyArray<ReviewEventsByDatePlatformReviewEventTotal>;
  rows: ReadonlyArray<ReviewEventsByDateRow>;
}>;

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type AdminSessionState = Readonly<{
  authTransport: AdminAuthTransport;
  csrfToken: string | null;
}>;

const staleSessionCsrfTokenErrorCode = "SESSION_CSRF_TOKEN_INVALID";
const staleSessionCsrfTokenErrorMessage = "Invalid X-CSRF-Token header";

let adminSessionState: AdminSessionState | undefined;
let adminSessionRecoveryPromise: Promise<AdminSession> | undefined;
let adminSessionCsrfRecoveryPromise: Promise<void> | undefined;

async function parseApiError(response: Response): Promise<never> {
  let message = `Request failed with status ${response.status}`;
  let code: string | null = null;

  try {
    const payload = await response.json() as Partial<{ error: string; code: string | null }>;
    if (typeof payload.error === "string" && payload.error.trim() !== "") {
      message = payload.error;
    }

    code = typeof payload.code === "string" && payload.code.trim() !== ""
      ? payload.code
      : null;
  } catch {
    // Keep the status-derived message when the response body is not JSON.
  }

  throw new AdminApiError(response.status, message, code);
}

function isRecoverableAdminCsrfPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value === staleSessionCsrfTokenErrorMessage;
  }

  const objectValue = value as Record<string, unknown>;
  return objectValue.code === staleSessionCsrfTokenErrorCode
    || objectValue.error === staleSessionCsrfTokenErrorMessage;
}

async function readAdminJsonResponse(response: Response): Promise<unknown> {
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

async function isRecoverableAdminCsrfResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }

  return isRecoverableAdminCsrfPayload(await readAdminJsonResponse(response.clone()));
}

function resetAdminSessionState(): void {
  adminSessionState = undefined;
}

function setAdminSessionState(session: AdminSession): void {
  adminSessionState = {
    authTransport: session.authTransport,
    csrfToken: session.csrfToken,
  };
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
    if (adminSessionState === undefined) {
      throw new Error("Admin session must be loaded before sending mutating requests.");
    }

    if (adminSessionState.authTransport === "session") {
      const csrfToken = adminSessionState.csrfToken;
      if (csrfToken === null || csrfToken === "") {
        throw new Error("CSRF token is not loaded for this admin session.");
      }

      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  return headers;
}

async function performAdminFetch(
  config: AdminAppConfig,
  pathname: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(`${config.apiBaseUrl}${pathname}`, {
      ...init,
      credentials: "include",
      headers: createHeaders(init),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The admin API is unavailable. Try again. (${pathname}; ${message})`);
  }
}

async function parseAdminSessionResponse(response: Response): Promise<AdminSession> {
  if (!response.ok) {
    return parseApiError(response);
  }

  const session = await response.json() as AdminSession;
  setAdminSessionState(session);
  return session;
}

async function refreshBrowserSession(config: AdminAppConfig): Promise<boolean> {
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
    resetAdminSessionState();
    return false;
  }

  return parseApiError(response);
}

async function loadAdminSessionWithoutRecovery(config: AdminAppConfig): Promise<AdminSession> {
  const response = await performAdminFetch(config, "/admin/session", {
    method: "GET",
  });

  return parseAdminSessionResponse(response);
}

async function recoverAdminSession(config: AdminAppConfig): Promise<AdminSession> {
  const activeRecoveryPromise = adminSessionRecoveryPromise;
  if (activeRecoveryPromise !== undefined) {
    return activeRecoveryPromise;
  }

  const recoveryPromise = (async (): Promise<AdminSession> => {
    const refreshed = await refreshBrowserSession(config);
    if (refreshed === false) {
      throw new AdminApiError(401, "Authentication failed. Sign in again.", null);
    }

    return loadAdminSessionWithoutRecovery(config);
  })();

  adminSessionRecoveryPromise = recoveryPromise.finally(() => {
    adminSessionRecoveryPromise = undefined;
  });

  return adminSessionRecoveryPromise;
}

async function recoverAdminSessionCsrf(config: AdminAppConfig): Promise<void> {
  const activeRecoveryPromise = adminSessionCsrfRecoveryPromise;
  if (activeRecoveryPromise !== undefined) {
    return activeRecoveryPromise;
  }

  const recoveryPromise = (async (): Promise<void> => {
    await fetchAdminSession(config);
  })();

  adminSessionCsrfRecoveryPromise = recoveryPromise.finally(() => {
    adminSessionCsrfRecoveryPromise = undefined;
  });

  return adminSessionCsrfRecoveryPromise;
}

async function ensureAdminSessionLoaded(config: AdminAppConfig): Promise<void> {
  if (adminSessionState !== undefined) {
    return;
  }

  await fetchAdminSession(config);
}

export async function fetchAdminSession(config: AdminAppConfig): Promise<AdminSession> {
  resetAdminSessionState();
  const response = await performAdminFetch(config, "/admin/session", {
    method: "GET",
  });

  if (response.status === 401) {
    return recoverAdminSession(config);
  }

  return parseAdminSessionResponse(response);
}

export async function runAdminQuery(
  config: AdminAppConfig,
  sql: string,
): Promise<AdminQueryResponse> {
  await ensureAdminSessionLoaded(config);
  const body = JSON.stringify({ sql });
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body,
  };

  let response = await performAdminFetch(config, "/admin/reports/query", requestInit);

  let didRecoverSession: boolean = false;
  let didRecoverSessionCsrf: boolean = false;
  while (true) {
    if (response.status === 401 && didRecoverSession === false) {
      didRecoverSession = true;
      await recoverAdminSession(config);
      response = await performAdminFetch(config, "/admin/reports/query", requestInit);
      continue;
    }

    if (didRecoverSessionCsrf === false && await isRecoverableAdminCsrfResponse(response)) {
      didRecoverSessionCsrf = true;
      await recoverAdminSessionCsrf(config);
      response = await performAdminFetch(config, "/admin/reports/query", requestInit);
      continue;
    }

    break;
  }

  if (!response.ok) {
    return parseApiError(response);
  }

  return response.json() as Promise<AdminQueryResponse>;
}
