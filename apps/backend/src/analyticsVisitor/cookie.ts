/**
 * The product domain's shared analytics visitor identity, carried in one first-party cookie.
 *
 * The web app is a static Vite bundle on S3 + CloudFront, so it has no server and no middleware that
 * could set a cookie on the parent domain. This API is the first-party server that can, which is why
 * the identity is minted here and not in the client.
 *
 * The value is a plain random UUID with no signature and no secret. It grants no authority, and the
 * analytics ingest route it feeds already accepts whatever `anonymousId` a caller sends without
 * verifying it (apps/backend/src/routes/productAnalytics.ts), so a signature here would protect a
 * value the very next hop takes on trust, at the price of giving this function a signing key. The
 * server therefore validates the shape and nothing else.
 *
 * That shape check is also the only mitigation against cookie shadowing: any sibling host under the
 * base domain can overwrite `analytics_visitor`, and a planted value that happens to be a UUID is
 * accepted as this browser's id. This is stated plainly in docs/analytics-visitor-identity.md rather
 * than defended against, because no mechanism available to a cookie can distinguish the two writers.
 *
 * Sessions are deliberately not in this cookie. Nothing on the server observes the events that would
 * advance a session, so every client owns its own rotation under the shared 30-minute rule
 * (apps/web/src/analytics/identity.ts, and the iOS and Android equivalents).
 *
 * The cookie is scoped to the current product base domain, so the planned move to nibomo.com resets
 * every visitor id on that day. That is accepted: no anonymous identity survives the domain move,
 * and nothing tries to carry one across it.
 */
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const visitorCookieName = "analytics_visitor";

/** 13 months, the retention ceiling this identity is kept to and under the browsers' 400-day cap. */
const visitorCookieMaxAgeSeconds = 395 * 24 * 60 * 60;

const analyticsUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * The base domain the cookie is published on, so every host under it — the web app, this API and the
 * auth origin — sees one visitor. A missing value is a deployment error rather than something to
 * fall back from: a host-only cookie would silently make the app and the API two different visitors.
 */
function getVisitorCookieDomain(): string {
  const domain = process.env.COOKIE_DOMAIN ?? "";
  if (domain === "") {
    throw new Error("COOKIE_DOMAIN must be the product base domain before the analytics visitor cookie can be set");
  }

  return domain;
}

/**
 * `httpOnly` is deliberately absent: browser code has to read this id to attach it to the events it
 * reports, which is the whole reason the cookie exists. Nothing else is carried in it, so a script
 * that reads it learns only the anonymous id it is about to send anyway.
 *
 * A `Domain` attribute always covers the named host and its subdomains, so the leading dot the
 * cookie is described with (`Domain=.<base domain>`) is what a browser stores either way; RFC 6265
 * section 5.2.3 strips it on receipt.
 */
function getVisitorCookieOptions(): Readonly<{
  domain: string;
  path: string;
  secure: true;
  sameSite: "Lax";
  maxAge: number;
}> {
  return {
    domain: getVisitorCookieDomain(),
    path: "/",
    secure: true,
    sameSite: "Lax",
    maxAge: visitorCookieMaxAgeSeconds,
  };
}

export function createAnalyticsVisitorId(): string {
  return randomUUID();
}

/**
 * A value that is not a UUID is treated as absent and re-minted over. It carries no authority, so
 * there is nothing to report or recover.
 */
export function readAnalyticsVisitorId(context: Context): string | null {
  const cookieValue = getCookie(context, visitorCookieName);
  if (cookieValue === undefined) {
    return null;
  }

  const visitorId = cookieValue.trim().toLowerCase();
  return analyticsUuidPattern.test(visitorId) ? visitorId : null;
}

/** Writing the id a caller already holds is how the 13-month lifetime is extended on each visit. */
export function writeAnalyticsVisitorId(context: Context, visitorId: string): void {
  setCookie(context, visitorCookieName, visitorId, getVisitorCookieOptions());
}

/** The domain and path repeat the write options, because that is what a browser matches a delete on. */
export function clearAnalyticsVisitor(context: Context): void {
  deleteCookie(context, visitorCookieName, {
    domain: getVisitorCookieDomain(),
    path: "/",
    secure: true,
  });
}
