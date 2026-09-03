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

// The closed domain of `analytics.product_events.platform`, plus the bucket that stands for "the row
// carries no platform". The dashboard splits on this and never sums over it.
//
// `agent` exists so machine-API activity stays visible as its own series: a scheduled MCP client
// merged into `web` would read as a person using the site. `unattributed` is where every row whose
// platform column is NULL lands, which means the row carries no resolved device fact - either the
// actor behind it is not a device or no device could be resolved for it - so it stays its own bucket
// and is never guessed at. See the note on `buildReviewEventsByDateSql` for how a `review_answered`
// row reaches a device bucket or this one.
export const reviewEventPlatforms = ["web", "android", "ios", "agent", "unattributed"] as const;

export type ReviewEventPlatform = (typeof reviewEventPlatforms)[number];

export const reviewEventCohorts = ["returning", "new"] as const;

export type ReviewEventCohort = (typeof reviewEventCohorts)[number];

/**
 * One person in the report.
 *
 * `userId` carries `actor_id` from `analytics.product_events_resolved`, not a raw `user_id`: the view
 * has already collapsed a guest and the account that guest became into one person. It is therefore
 * not always an account id - a guest who never upgraded stays on the guest user id, and an
 * unresolved row resolves to its own `anonymous_id`. The field keeps its name because the filter
 * popup, the tooltips and the chart colour scale are all keyed on it.
 */
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

/** One community activity row per report date and user. */
export type ReviewEventsByDateCommunityRow = Readonly<{
  date: string;
  userId: string;
  email: string;
  friendInvitationCount: number;
  friendshipCount: number;
}>;

export type ReviewEventsByDateReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  totalReviewEvents: number;
  users: ReadonlyArray<ReviewEventsByDateUser>;
  /** Users with community activity in range but no review events in range. */
  communityOnlyUsers: ReadonlyArray<ReviewEventsByDateUser>;
  dateTotals: ReadonlyArray<ReviewEventsByDateTotal>;
  dailyUniqueUserCohorts: ReadonlyArray<ReviewEventsByDateUniqueUserCohort>;
  platformActiveUserTotals: ReadonlyArray<ReviewEventsByDatePlatformActiveUserTotal>;
  platformReviewEventTotals: ReadonlyArray<ReviewEventsByDatePlatformReviewEventTotal>;
  rows: ReadonlyArray<ReviewEventsByDateRow>;
  communityRows: ReadonlyArray<ReviewEventsByDateCommunityRow>;
}>;

/**
 * One person in the daily active users report.
 *
 * `userId` carries the same resolved `actor_id` as `ReviewEventsByDateUser`, so the same person keeps
 * one identity, one filter entry and one colour across both sections.
 */
export type DailyActiveUsersUser = Readonly<{
  userId: string;
  email: string;
  activeDayCount: number;
}>;

/** One (UTC date, actor, platform) the actor opened the app on. */
export type DailyActiveUsersRow = Readonly<{
  date: string;
  userId: string;
  email: string;
  platform: ReviewEventPlatform;
  firstActiveDate: string;
}>;

export type DailyActiveUsersCohortTotal = Readonly<{
  date: string;
  newActiveUsers: number;
  returningActiveUsers: number;
}>;

export type DailyActiveUsersPlatformTotal = Readonly<{
  date: string;
  platform: ReviewEventPlatform;
  activeUserCount: number;
}>;

export type DailyActiveUsersReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  users: ReadonlyArray<DailyActiveUsersUser>;
  /**
   * Each actor's first `app_opened` UTC day over all history, which is the report's cohort
   * definition. Exposed as a lookup so another section can apply the same cohort split without
   * restating it.
   */
  firstActiveDateByUserId: ReadonlyMap<string, string>;
  dailyCohortTotals: ReadonlyArray<DailyActiveUsersCohortTotal>;
  platformActiveUserTotals: ReadonlyArray<DailyActiveUsersPlatformTotal>;
  rows: ReadonlyArray<DailyActiveUsersRow>;
}>;

/**
 * One person who installed at least one catalog deck in the report range.
 *
 * `userId` carries the same resolved `actor_id` as `ReviewEventsByDateUser`, so an installer keeps
 * one identity, one filter entry and one colour across every section.
 */
export type CatalogInstallsUser = Readonly<{
  userId: string;
  email: string;
  installCount: number;
}>;

/**
 * One deck in the report. The install event carries `catalog.packages.slug` and nothing else about
 * the deck, so the slug is the whole deck dimension: there is no title and no version number here.
 */
export type CatalogInstallsPackage = Readonly<{
  packageSlug: string;
  installCount: number;
}>;

/**
 * One (UTC date, actor, package slug). `installCount` counts install actions, and `cardCount` sums
 * the cards those installs added.
 */
export type CatalogInstallsRow = Readonly<{
  date: string;
  userId: string;
  email: string;
  platform: ReviewEventPlatform;
  packageSlug: string;
  installCount: number;
  cardCount: number;
}>;

export type CatalogInstallsReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  totalInstalls: number;
  users: ReadonlyArray<CatalogInstallsUser>;
  packages: ReadonlyArray<CatalogInstallsPackage>;
  rows: ReadonlyArray<CatalogInstallsRow>;
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
