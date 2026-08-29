/**
 * Hand-written mirror of the parts of the product analytics contract this service emits, in the same
 * way the web, iOS and Android clients mirror it. The source of truth is
 * `apps/backend/src/productAnalytics/catalog.ts`, and the backend rejects anything it does not
 * declare, so only what the auth origin actually reports is declared here: one surface and one
 * event.
 *
 * Nothing server-owned is mirrored. `schema_version`, `platform`, `app_version` and the identity
 * columns are derived by the backend from the request, and an event that carries any of them is
 * rejected as `server_owned_field`.
 */
import { randomBytes } from "node:crypto";

/**
 * The only surface this service reports. `signin` is the sign-in screen itself, whatever steps the
 * page splits it into: the email step, the code step and the workspace choice are one screen.
 */
export type AuthAnalyticsSurface = "signin";

/** The only event this service reports. `screen_viewed` declares no properties in the catalog. */
export type AuthAnalyticsEventName = "screen_viewed";

/**
 * Exactly the client-owned fields `apps/backend/src/productAnalytics/validation.ts` accepts. It
 * parses an event strictly: any other key rejects that event as `unknown_field`, and a server-owned
 * key as `server_owned_field`.
 */
export type AuthAnalyticsWireEvent = Readonly<{
  eventId: string;
  eventName: AuthAnalyticsEventName;
  clientOccurredAt: string;
  // A server observes its own request, not the visitor's connectivity, so it reports none rather
  // than inventing `wifi` for a column that is retained indefinitely.
  networkState: null;
  screen: AuthAnalyticsSurface;
  properties: null;
  experimentAssignments: null;
}>;

/** The batch envelope, parsed just as strictly as the events inside it. */
export type AuthAnalyticsBatch = Readonly<{
  clientSentAt: string;
  anonymousId: string;
  // A session id sent from here survives only if the post that carried it was answered inside the
  // report budget: it is written back to the visitor cookie only once the acceptance envelope has
  // been read, so an event whose row the backend committed but whose 200 body did not finish
  // arriving is stored under an id the cookie never keeps. Read `session_id` on these rows knowing
  // that a visitor whose posts are consistently that slow contributes one distinct session per
  // stored event, inflating web session counts for exactly that population.
  sessionId: string;
  // The device context the mobile and web clients fill in. This producer is a server: it sees no OS
  // version, device model, locale or timezone of the visitor, so it sends none rather than deriving
  // one from request headers.
  context: null;
  events: ReadonlyArray<AuthAnalyticsWireEvent>;
}>;

const uuidByteCount = 16;
const uuidVersionByteIndex = 6;
const uuidVariantByteIndex = 8;

/**
 * UUID version 7, ported from `createAnalyticsUuidV7` in `apps/web/src/analytics/identity.ts`.
 * `randomUUID()` is version 4, and `isProductAnalyticsEventIdVersionValid` refuses it as a generic
 * `invalid_event` that is indistinguishable from a malformed one, so event ids are built explicitly.
 */
function createAuthAnalyticsUuidV7(nowMs: number): string {
  const bytes = randomBytes(uuidByteCount);
  bytes[0] = Math.floor(nowMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(nowMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(nowMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(nowMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(nowMs / 2 ** 8) & 0xff;
  bytes[5] = nowMs & 0xff;
  bytes[uuidVersionByteIndex] = (bytes[uuidVersionByteIndex] & 0x0f) | 0x70;
  bytes[uuidVariantByteIndex] = (bytes[uuidVariantByteIndex] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Ingest accepts UTC only: an offset fails `z.string().datetime()` and rejects the event, or the
 * whole batch when it is `clientSentAt`. `toISOString` is always `Z`-suffixed UTC.
 */
function toAuthAnalyticsTimestamp(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * The one batch this service sends: a signed-out visitor was shown the sign-in form.
 *
 * `clientOccurredAt` and `clientSentAt` are the same instant on purpose. Nothing is queued here, so
 * the event is observed and sent inside one invocation, and the backend's skew correction then
 * stores `occurred_at` as its own receive time rather than shifting it by an interval this producer
 * would have to invent.
 */
export function createSignInScreenViewedBatch(
  anonymousId: string,
  sessionId: string,
  nowMs: number,
): AuthAnalyticsBatch {
  const timestamp = toAuthAnalyticsTimestamp(nowMs);
  return {
    clientSentAt: timestamp,
    anonymousId,
    sessionId,
    context: null,
    events: [{
      eventId: createAuthAnalyticsUuidV7(nowMs),
      eventName: "screen_viewed",
      clientOccurredAt: timestamp,
      networkState: null,
      screen: "signin",
      properties: null,
      experimentAssignments: null,
    }],
  };
}
