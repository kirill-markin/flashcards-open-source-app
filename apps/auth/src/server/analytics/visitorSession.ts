/**
 * The analytics identity this origin reports under: the product domain's shared visitor id, and
 * nothing of its own.
 *
 * The anonymous id is read from the shared `analytics_visitor` cookie and never written here
 * (`docs/analytics-visitor-identity.md`). It is a plain random UUID with no signature and no secret,
 * so the shape check below is the whole validation, and a value that fails it is treated as absent.
 * Nothing mints one on this origin: a browser holding none is not measured here at all, which is
 * also what keeps this surface inside the app origin's consent gate without a banner of its own.
 *
 */
import type { Context } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";

/** The parent-domain cookie the backend mints, shared by every host under the product domain. */
const sharedVisitorCookieName = "analytics_visitor";
const sharedCollectionCookieName = "product_analytics_collection";

/**
 * The host-only cookie a build from before the collector change wrote a guest bearer token into. No
 * code writes it now; it is only read for its presence and deleted.
 */
const guestCookieName = "__Host-analytics_guest";

const analyticsUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Missing or invalid preference is unmeasured here; a caller hint can only deny collection. */
export function isSharedProductAnalyticsCollectionEnabled(context: Context): boolean {
  return getCookie(context, sharedCollectionCookieName) === "1"
    && context.req.header("x-product-analytics-enabled") !== "0";
}

export function readSharedAnalyticsVisitorId(context: Context): string | null {
  const cookieValue = getCookie(context, sharedVisitorCookieName);
  if (cookieValue === undefined) {
    return null;
  }

  const visitorId = cookieValue.trim().toLowerCase();
  return analyticsUuidPattern.test(visitorId) ? visitorId : null;
}

/**
 * Whether this browser still carries the retired guest cookie, so a caller that tests it first
 * sends the clear below only to the browsers that have one rather than as a `Set-Cookie` on every
 * request it handles for ever.
 *
 * Presence is the whole test. The payload is not parsed and its signature is not verified: nothing
 * reads what is inside it any more, and a cookie that would fail either check still has to go.
 */
export function hasAuthAnalyticsGuestSession(context: Context): boolean {
  const cookieValue = getCookie(context, guestCookieName);
  return cookieValue !== undefined && cookieValue !== "";
}

/**
 * Retires the guest credential a previous build left on this browser.
 *
 * Housekeeping, not a guarantee: nothing reads that token any more, so a copy left behind is inert
 * until it expires, every copy by about 2026-12-23. Paths where a session only expired clear the
 * session cookies and leave this one to the sign-in or logout that follows.
 *
 * What the clear leaves behind is a guest session nobody holds, which the 90-day web guest reaper in
 * `apps/backend/src/guestAuth/reaper/` collects. Revoking it here would be a second cross-service
 * call inside the budget whose cost this change exists to remove.
 *
 * `path` and `secure` repeat the original write options because a `__Host-` cookie is only deleted
 * by a `Set-Cookie` that still satisfies the prefix.
 */
export function clearAuthAnalyticsGuestSession(context: Context): void {
  deleteCookie(context, guestCookieName, { path: "/", secure: true });
}
