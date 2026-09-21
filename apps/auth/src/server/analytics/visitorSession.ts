/**
 * The analytics identity this origin reports under: the product domain's shared visitor id, plus the
 * only two things that id cannot carry — this origin's `web` guest session and its session id.
 *
 * The anonymous id is read from the shared `analytics_visitor` cookie and never written here
 * (`docs/analytics-visitor-identity.md`). It is a plain random UUID with no signature and no secret,
 * so the shape check below is the whole validation, and a value that fails it is treated as absent.
 * Nothing mints one on this origin: a browser holding none is not measured here at all, which is
 * also what keeps this surface inside the app origin's consent gate without a banner of its own.
 */
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "../crypto.js";

/** The parent-domain cookie the backend mints, shared by every host under the product domain. */
const sharedVisitorCookieName = "analytics_visitor";

/**
 * The `__Host-` prefix costs nothing here — the attributes below already satisfy everything it
 * requires — and it is what stops this cookie from being shadowed. Without it any host under the
 * registrable domain can set a `Domain=<base domain>` cookie of the same name; both then have path
 * `/` (RFC 6265 section 5.4), the duplicate that arrives later in the `Cookie` header is the one
 * Hono's parser returns, and because a shadow fails `verify` and is treated as absent, every
 * instrumented request would mint a fresh guest user — unbounded guest rows, one per request —
 * while it kept rewriting a host-only cookie that never wins. For a cookie carrying a bearer token
 * the prefix is the cheapest correct answer.
 */
const guestCookieName = "__Host-analytics_guest";
const guestCookieMaxAgeSeconds = 90 * 24 * 60 * 60;

/** Shared with the web, iOS and Android clients: a new session after 30 minutes with no event. */
const sessionInactivityTimeoutMs = 30 * 60 * 1000;

const analyticsUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * This is the one cookie in the service that must not use `getCookieOptions()` from
 * `browserSession.ts`. That helper sets `domain: COOKIE_DOMAIN`, which is the bare base domain, so
 * it would publish a guest credential to `app.` and `admin.` as well; host-only is what keeps this
 * bearer token to the origin that obtained it.
 *
 * `secure`, `path: "/"` and the absent `domain` are also exactly what the `__Host-` prefix in the
 * cookie name requires. Change any of the three and a browser rejects the cookie outright.
 */
const guestCookieOptions = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Lax",
  maxAge: guestCookieMaxAgeSeconds,
} as const;

/** What this origin keeps of its own, because the shared visitor cookie carries neither. */
export type AuthAnalyticsGuestState = Readonly<{
  sessionId: string;
  guestToken: string | null;
  guestUserId: string | null;
  lastEventAtMs: number;
}>;

export type AuthAnalyticsVisitor = AuthAnalyticsGuestState & Readonly<{ anonymousId: string }>;

function parseGuestStatePayload(value: unknown): AuthAnalyticsGuestState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { sessionId, guestToken, guestUserId, lastEventAtMs } = value as Readonly<{
    sessionId?: unknown;
    guestToken?: unknown;
    guestUserId?: unknown;
    lastEventAtMs?: unknown;
  }>;
  if (typeof sessionId !== "string" || analyticsUuidPattern.test(sessionId) === false) {
    return null;
  }

  if (guestToken !== null && typeof guestToken !== "string") {
    return null;
  }

  if (guestUserId !== null && typeof guestUserId !== "string") {
    return null;
  }

  if (typeof lastEventAtMs !== "number" || Number.isFinite(lastEventAtMs) === false) {
    return null;
  }

  return { sessionId, guestToken, guestUserId, lastEventAtMs };
}

/** The anonymous id every event of this surface is attributed to, or null where the browser has none. */
export function readSharedAnalyticsVisitorId(context: Context): string | null {
  const cookieValue = getCookie(context, sharedVisitorCookieName);
  if (cookieValue === undefined) {
    return null;
  }

  const visitorId = cookieValue.trim().toLowerCase();
  return analyticsUuidPattern.test(visitorId) ? visitorId : null;
}

/**
 * Opens a session with no guest credential yet: the session id is local and costs no network call,
 * and the guest session that authenticates ingest is obtained later, only on the request that
 * actually reports an event. `lastEventAtMs` starts now so the first event of the visit continues
 * this session instead of immediately rotating it.
 */
export function createAuthAnalyticsGuestState(nowMs: number): AuthAnalyticsGuestState {
  return {
    sessionId: randomUUID(),
    guestToken: null,
    guestUserId: null,
    lastEventAtMs: nowMs,
  };
}

export function readAuthAnalyticsGuestSession(context: Context): AuthAnalyticsGuestState | null {
  const cookieValue = getCookie(context, guestCookieName);
  if (cookieValue === undefined || cookieValue === "") {
    return null;
  }

  try {
    return parseGuestStatePayload(JSON.parse(verify(cookieValue)) as unknown);
  } catch {
    // A cookie that fails the signature check, or that is not the payload this module writes, is
    // treated as absent and replaced by the next write. Nothing about a sign-in reads it.
    return null;
  }
}

/** The anonymous id is destructured out rather than stored: this origin keeps no visitor identity. */
export function writeAuthAnalyticsGuestSession(context: Context, state: AuthAnalyticsGuestState): void {
  const { sessionId, guestToken, guestUserId, lastEventAtMs } = state;
  setCookie(
    context,
    guestCookieName,
    sign(JSON.stringify({ sessionId, guestToken, guestUserId, lastEventAtMs })),
    guestCookieOptions,
  );
}

/**
 * Retires the guest credential as soon as its one claim stops being pending. The claim is that this
 * browser's signed-out run belongs to the account of the sign-in it is heading for, and the guest
 * token is what settles it: bound to exactly one account, once, in an append-only table that is
 * first-link-wins with no repair path (`server/analytics/signInFunnel.ts`). A sign-in settles the
 * claim, whether or not it is one this measurement may attribute. Anything that leaves this browser
 * unable to settle it honestly voids the claim — handed back to whoever comes next, or left without
 * the account the run was accumulating toward. Settled or void, the token must not survive: offered
 * again, it would hand this browser's whole signed-out tail to the next person's account,
 * permanently. The cost is one returning browser's continuity, the undercount preferred here.
 *
 * A session that only expired does neither: nothing was offered, and the same person is put straight
 * back on the sign-in form, so those paths clear the session cookies and keep this one.
 *
 * No clear is airtight. A funnel report that read this cookie first writes it back on its own
 * response (`reportSignInFunnelEvent` in `signInFunnel.ts`), and what comes back is live: a
 * write-back needs a mint or an accepted post, and a dead token gets neither
 * (`deliverAuthAnalyticsEvent`). A sign-in's link can still retire that survivor; `/logout`,
 * `/logout-local` and `POST /api/revoke-token` run no link at all, so theirs stays live and
 * unbound — this token handed whole to the next person, which is what the rule above exists to
 * prevent. A tombstone would close it, a stronger case here than at sign-in, and is not worth a
 * second cookie every clear sets and every read consults, for one race.
 *
 * The shared visitor id is not touched here and is not this origin's to retire: it is the product
 * domain's, it survives a logout on every other client, and the person's own withdrawal is what ends
 * it (`docs/analytics-visitor-identity.md`).
 *
 * `path` and `secure` repeat the write options because a `__Host-` cookie is only deleted by a
 * `Set-Cookie` that still satisfies the prefix.
 */
export function clearAuthAnalyticsGuestSession(context: Context): void {
  deleteCookie(context, guestCookieName, { path: "/", secure: true });
}

/**
 * Returns the visitor as of the event being emitted now, rotating the session id once the browser
 * has been inactive for the shared timeout so web session counts stay comparable with the other
 * clients. Sessions are deliberately absent from the shared cookie, so every client — this origin
 * included — rotates its own.
 */
export function refreshAuthAnalyticsVisitorSession(
  visitor: AuthAnalyticsVisitor,
  nowMs: number,
): AuthAnalyticsVisitor {
  const isSameSession = nowMs >= visitor.lastEventAtMs
    && nowMs - visitor.lastEventAtMs <= sessionInactivityTimeoutMs;
  return {
    ...visitor,
    sessionId: isSameSession ? visitor.sessionId : randomUUID(),
    lastEventAtMs: nowMs,
  };
}
