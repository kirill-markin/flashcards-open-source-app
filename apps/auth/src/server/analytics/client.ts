/**
 * The auth origin's product analytics transport: two best-effort calls against the backend.
 *
 * Nothing in this module throws into a route handler and nothing it does changes a response. The
 * auth service's job is signing people in, and a measurement that fails must cost the person
 * nothing but the measurement.
 *
 * There is deliberately no queue, no backoff and no `Retry-After` handling, unlike the web client in
 * `apps/web/src/analytics/`: a Lambda invocation has no durable store and nothing to retry into
 * once the response is sent. A `429 ANALYTICS_WRITER_BUSY`, a `5xx`, a rejected event and a timeout
 * all mean one thing here — that event is lost, logged with its status and error text, and never
 * resent. That is the design of this producer, not an omission from it.
 *
 * What it costs: one `web` guest session, and the four rows the web guest reaper documents it
 * owning, per signed-out login-page load rather than per sign-in attempt. That is deliberate.
 * "Reached the login page and never entered an email" is the most valuable number this measurement
 * produces, and it cannot exist without an identity at step one. The bound is the existing 90-day
 * web guest reaper in `apps/backend/src/guestAuth/reaper/`, which deletes web guests that never
 * signed in and stopped being seen; its saturation alarm is `WebGuestReaperSaturatedAlarm` in
 * `infra/aws/lib/monitoring.ts`.
 *
 * Two of those guest identities are orphans by construction, and both are accepted costs of a
 * bounded best-effort report rather than defects — the only way to avoid either is to hold a
 * sign-in response open longer, which is the one thing this measurement may never do. Both are
 * reaped on the same 90-day schedule as any other web guest that never signed in:
 *
 *   A mint abandoned at its deadline. `POST /v1/guest-auth/session` commits the guest user,
 *   workspace and session rows before it answers, so a mint the caller stops waiting for has
 *   usually already succeeded on the backend. The visitor stores no token, the next load mints
 *   again, and the abandoned identity is never referenced.
 *
 *   Two login-page loads racing. Both read the same guest-token-less visitor cookie, both mint, and
 *   the last `Set-Cookie` of the two wins; the other identity is never referenced.
 */
import type { AuthAnalyticsBatch } from "./catalog.js";
import { logWarning } from "../logger.js";
import type { AuthTraceId } from "../sentry.js";

/** Keeps one failing response from filling the log group with a body nobody reads. */
const loggedErrorTextMaxLength = 300;

export type AuthAnalyticsGuestSession = Readonly<{
  guestToken: string;
  userId: string;
}>;

/** Everything about one report that does not change between the calls it makes. */
export type AuthAnalyticsTarget = Readonly<{
  apiBaseUrl: string;
  requestId: string;
  traceId: AuthTraceId | null;
  route: string;
}>;

/**
 * One call of one report, with the slice of that report's budget it may spend. The slice is the
 * caller's to apportion: this module never decides how long a route may hold a response open.
 */
export type AuthAnalyticsCall = AuthAnalyticsTarget & Readonly<{ timeoutMs: number }>;

type AuthAnalyticsFailureAction = "analytics_guest_session_error" | "analytics_ingest_error";

function logAnalyticsFailure(
  call: AuthAnalyticsCall,
  action: AuthAnalyticsFailureAction,
  statusCode: number | null,
  errorMessage: string,
): void {
  logWarning({
    domain: "auth",
    action,
    requestId: call.requestId,
    traceId: call.traceId,
    route: call.route,
    statusCode: statusCode ?? undefined,
    // Truncated here rather than at the source, so what is parsed below is always the whole body.
    errorMessage: errorMessage.slice(0, loggedErrorTextMaxLength),
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A response body, or this module's own account of why there is none to look at.
 *
 * The budget's `AbortSignal` covers the body read as well as the connection, so an otherwise fine
 * 200 whose body did not finish arriving lands here. The two stay apart in the type rather than
 * collapsing into one string, because the other failure — a 200 carrying a body this module cannot
 * parse — is a real contract break between this mirror and the server catalog, and the one log
 * record either produces is the only signal that tells them apart. `unreadReason` is written here
 * and repeats nothing from the response, so it is safe to log whatever the status was.
 */
type AuthAnalyticsResponseBody =
  | Readonly<{ read: true; text: string }>
  | Readonly<{ read: false; unreadReason: string }>;

async function readResponseBody(response: Response): Promise<AuthAnalyticsResponseBody> {
  try {
    return { read: true, text: await response.text() };
  } catch (error) {
    return { read: false, unreadReason: `<response body was not read: ${toErrorMessage(error)}>` };
  }
}

/** For the paths whose body provably carries no credential and is therefore logged whole. */
function toLoggedBodyText(body: AuthAnalyticsResponseBody): string {
  return body.read ? body.text : body.unreadReason;
}

function parseJsonObject(responseText: string): Readonly<Record<string, unknown>> | null {
  try {
    const payload = JSON.parse(responseText) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return null;
    }

    return payload as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function parseGuestSession(responseText: string): AuthAnalyticsGuestSession | null {
  const payload = parseJsonObject(responseText);
  if (payload === null) {
    return null;
  }

  const { guestToken, userId } = payload;
  if (typeof guestToken !== "string" || guestToken === "" || typeof userId !== "string" || userId === "") {
    return null;
  }

  return { guestToken, userId };
}

/**
 * One word per value, drawn from a fixed vocabulary and never from what the value contains.
 * `typeof` alone would call both `null` and an array `object`, and would not separate the empty
 * string that `parseGuestSession` refuses from a populated one — which is one of the two
 * regressions the descriptor below exists to name.
 */
function describeJsonValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "string") {
    return value === "" ? "empty string" : "string";
  }

  return typeof value;
}

/**
 * Names the shape of a 2xx mint body — its sorted top-level keys and one type word each — for a
 * log record that must not contain the body itself.
 *
 * The mint's success envelope is the only response in this module that carries a credential, and
 * `parseGuestSession` refuses it whenever `guestToken` or `userId` is absent, not a string or empty;
 * one field renamed in `GuestSessionEnvelope` is enough. Logging that body verbatim would put a live
 * guest bearer token into the log group, well inside the truncation in `logAnalyticsFailure`.
 *
 * The descriptor cannot carry the token. Every value is replaced by one word chosen from the fixed
 * set in `describeJsonValueType` by type alone, and the token can only ever be a value: the mint
 * request sends no credential for any response to echo back, so the only credential such a body can
 * hold is the one the backend generated into its own envelope.
 */
function describeGuestSessionBodyShape(responseText: string): string {
  const payload = parseJsonObject(responseText);
  if (payload === null) {
    return "Mint returned 2xx with a body that is not a JSON object.";
  }

  const fields = Object.keys(payload)
    .sort()
    .map((key) => `${key}: ${describeJsonValueType(payload[key])}`)
    .join(", ");
  return `Mint returned 2xx with a body that is not a guest session; its shape was {${fields}}.`;
}

function readAcceptedEventCount(responseText: string): number | null {
  const accepted = parseJsonObject(responseText)?.accepted;
  return typeof accepted === "number" ? accepted : null;
}

/**
 * Creates the `web` guest session that authenticates ingest for one visitor.
 *
 * No `idempotencyKey` travels with it: the token is minted once per visitor and then kept in the
 * visitor cookie, and `apps/backend/src/routes/guestAuth.ts` documents an absent key as a fresh
 * guest identity per call, which is exactly what a first-ever login-page visit wants.
 */
export async function mintWebGuestSession(call: AuthAnalyticsCall): Promise<AuthAnalyticsGuestSession | null> {
  try {
    const response = await fetch(`${call.apiBaseUrl}/guest-auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "web" }),
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      // An error body carries no credential: the mint answers with one only when it succeeds.
      logAnalyticsFailure(call, "analytics_guest_session_error", response.status, toLoggedBodyText(body));
      return null;
    }

    const guestSession = body.read ? parseGuestSession(body.text) : null;
    if (guestSession === null) {
      // A 2xx body is the success envelope and holds the guest token, so it is described, never
      // logged; a body that never arrived is this module's own sentence and is logged as it is.
      logAnalyticsFailure(
        call,
        "analytics_guest_session_error",
        response.status,
        body.read ? describeGuestSessionBodyShape(body.text) : body.unreadReason,
      );
      return null;
    }

    return guestSession;
  } catch (error) {
    logAnalyticsFailure(call, "analytics_guest_session_error", null, toErrorMessage(error));
    return null;
  }
}

/**
 * Posts one batch and reports whether the backend stored all of it.
 *
 * The path carries no trailing slash, ever: `hasTrailingSlashRequestPath` in
 * `apps/backend/src/routes/productAnalytics.ts` answers 404 to the slash form, because that form
 * falls through to the `{proxy+}` method where neither the tighter per-method throttle nor the
 * ingest alarms can see the request.
 */
export async function postAnalyticsEvents(
  call: AuthAnalyticsCall,
  guestToken: string,
  batch: AuthAnalyticsBatch,
): Promise<boolean> {
  try {
    const response = await fetch(`${call.apiBaseUrl}/analytics/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Guest ${guestToken}`,
        "x-client-platform": "web",
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      logAnalyticsFailure(call, "analytics_ingest_error", response.status, toLoggedBodyText(body));
      return false;
    }

    // A 200 that accepted fewer events than were sent means this mirror and the server catalog
    // disagree. Nothing else would ever show it: the events are gone and the request looked fine.
    //
    // This success body is logged whole, unlike the mint's. The ingest envelope is a count plus one
    // `{ eventId, reason }` per refused event — ids this producer generated itself — and the guest
    // token travels in a request header that no response repeats. The rejection reason is the whole
    // diagnostic here, so a shape descriptor would say nothing.
    if (!body.read || readAcceptedEventCount(body.text) !== batch.events.length) {
      logAnalyticsFailure(call, "analytics_ingest_error", response.status, toLoggedBodyText(body));
      return false;
    }

    return true;
  } catch (error) {
    logAnalyticsFailure(call, "analytics_ingest_error", null, toErrorMessage(error));
    return false;
  }
}
