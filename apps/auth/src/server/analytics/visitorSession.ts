/**
 * The auth origin's own analytics visitor identity, carried in one signed cookie.
 *
 * The identity is minted here and never received from another origin: no identifier travels in a
 * URL and no parent-domain cookie is shared, so `app.<domain>` and this origin measure two separate
 * anonymous visitors. Joining them is a server-side job done at sign-in success through the existing
 * identity-link route, not something a browser is trusted to carry across the boundary.
 */
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "../crypto.js";

/**
 * The `__Host-` prefix costs nothing here — the attributes below already satisfy everything it
 * requires — and it is what stops this cookie from being shadowed. Without it any host under the
 * registrable domain can set a `Domain=<base domain>` cookie of the same name; both then have path
 * `/` (RFC 6265 section 5.4), the duplicate that arrives later in the `Cookie` header is the one
 * Hono's parser returns, and because a shadow fails `verify` and is treated as absent, this surface
 * would stop reporting silently while it kept rewriting a host-only cookie that never wins. For a
 * cookie carrying a bearer token the prefix is the cheapest correct answer.
 */
const visitorCookieName = "__Host-analytics_visitor";
const visitorCookieMaxAgeSeconds = 90 * 24 * 60 * 60;

/** Shared with the web, iOS and Android clients: a new session after 30 minutes with no event. */
const sessionInactivityTimeoutMs = 30 * 60 * 1000;

const analyticsUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * This is the one cookie in the service that must not use `getCookieOptions()` from
 * `browserSession.ts`, for two reasons. That helper sets `domain: COOKIE_DOMAIN`, which is the bare
 * base domain, so it would publish a guest credential and a tracking id to `app.` and `admin.` as
 * well. And host-only is what keeps this anonymous identity from being a cross-origin identifier at
 * all: it is the auth origin's own visitor, and no other origin may read or extend it.
 *
 * `secure`, `path: "/"` and the absent `domain` are also exactly what the `__Host-` prefix in the
 * cookie name requires. Change any of the three and a browser rejects the cookie outright.
 */
const visitorCookieOptions = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Lax",
  maxAge: visitorCookieMaxAgeSeconds,
} as const;

export type AuthAnalyticsVisitor = Readonly<{
  anonymousId: string;
  sessionId: string;
  guestToken: string | null;
  guestUserId: string | null;
  lastEventAtMs: number;
}>;

function parseVisitorPayload(value: unknown): AuthAnalyticsVisitor | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { anonymousId, sessionId, guestToken, guestUserId, lastEventAtMs } = value as Readonly<{
    anonymousId?: unknown;
    sessionId?: unknown;
    guestToken?: unknown;
    guestUserId?: unknown;
    lastEventAtMs?: unknown;
  }>;
  if (typeof anonymousId !== "string" || analyticsUuidPattern.test(anonymousId) === false) {
    return null;
  }

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

  return { anonymousId, sessionId, guestToken, guestUserId, lastEventAtMs };
}

/**
 * Mints a visitor with no guest credential yet: the ids are local and cost no network call, and the
 * guest session that authenticates ingest is obtained later, only on the request that actually
 * reports an event. `lastEventAtMs` starts at the page render so the first event of the visit
 * continues this session instead of immediately rotating it.
 */
export function createAuthAnalyticsVisitor(nowMs: number): AuthAnalyticsVisitor {
  return {
    anonymousId: randomUUID(),
    sessionId: randomUUID(),
    guestToken: null,
    guestUserId: null,
    lastEventAtMs: nowMs,
  };
}

export function readAuthAnalyticsVisitor(context: Context): AuthAnalyticsVisitor | null {
  const cookieValue = getCookie(context, visitorCookieName);
  if (cookieValue === undefined || cookieValue === "") {
    return null;
  }

  try {
    return parseVisitorPayload(JSON.parse(verify(cookieValue)) as unknown);
  } catch {
    // A cookie that fails the signature check, or that is not the payload this module writes, is
    // treated as absent and replaced by the next write. Nothing about a sign-in reads it.
    return null;
  }
}

export function writeAuthAnalyticsVisitor(context: Context, visitor: AuthAnalyticsVisitor): void {
  setCookie(context, visitorCookieName, sign(JSON.stringify(visitor)), visitorCookieOptions);
}

/**
 * Retires the visitor identity as soon as this cookie's one claim stops being pending. The claim
 * is that this browser's signed-out run belongs to the account of the sign-in it is heading for,
 * and the guest token in the cookie is what settles it: bound to exactly one account, once, in an
 * append-only table that is first-link-wins with no repair path
 * (`server/analytics/signInFunnel.ts`). A sign-in settles the claim, whether or not it is one this
 * measurement may attribute. Anything that leaves this browser unable to settle it honestly voids
 * the claim — handed back to whoever comes next, or left without the account the run was
 * accumulating toward. Settled or void, the cookie must not survive: the next person here would be
 * counted under its `anonymousId`, and any guest token left in it would be offered again, handing
 * their account this visitor's whole signed-out tail, permanently. The cost is one returning
 * visitor's continuity, the undercount preferred here.
 *
 * A session that only expired does neither: nothing was offered, and the same person is put
 * straight back on the sign-in form, so those paths clear the session cookies and keep this one.
 *
 * `path` and `secure` repeat the write options because a `__Host-` cookie is only deleted by a
 * `Set-Cookie` that still satisfies the prefix.
 */
export function clearAuthAnalyticsVisitor(context: Context): void {
  deleteCookie(context, visitorCookieName, { path: "/", secure: true });
}

/**
 * Returns the visitor as of the event being emitted now, rotating the session id once the visitor
 * has been inactive for the shared timeout so web session counts stay comparable with the other
 * clients.
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
