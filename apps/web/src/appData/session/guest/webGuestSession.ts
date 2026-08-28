import {
  createWebGuestSession,
  getCachedSessionCsrfToken,
  getOptionalSession,
  type WebGuestSessionEnvelope,
} from "../../../api";
import { setAnalyticsConfirmedOwner, setAnalyticsGuestOwnerId } from "../../../analytics";
import { readStoredAnalyticsEnabled } from "../../../analytics/identity";
import { hasLoggedInCookie } from "../activation/warmStart";

/**
 * The signed-out browser's identity for product analytics, and nothing else.
 *
 * The ingest endpoint always requires a credential, so a visitor who never signs in cannot be
 * measured at all without one. This module obtains that credential lazily, on the first real
 * interaction, never on a page view: creating a guest session writes a user row and a workspace on
 * the server, so a page-view trigger would mint one for every crawler that renders the public
 * catalog, invite and share pages.
 *
 * The token is kept in `localStorage`, where the visitor and any script on the page can read it, so
 * it grants nothing beyond measurement. `apps/backend/src/guestAuth/webPlatform.ts` refuses the web
 * guest platform by default on every authenticated backend surface — sync, chat and its AI quota,
 * guest upgrade, every account surface — and analytics ingest is the only route that opts in.
 *
 * The stored session is deliberately not cleared when the person signs in. It is the record that
 * lets the analytics client recognise, on the next page load, that the queue's previous owner was
 * this browser's own guest rather than a different account — which is what keeps `anonymous_id`
 * alive across the sign-in, so the guest's tail and the account's rows carry the same raw
 * `anonymous_id` in `analytics.product_events` and can be joined on it. It does not resolve the
 * guest into the account in `analytics.product_events_resolved`; `analytics/client.ts` documents
 * why, at the rotation exception that decides it.
 *
 * Every real identity boundary drops it: `resetWebGuestSession` removes it synchronously alongside
 * the analytics reset, and the key also carries the `flashcards-` prefix that
 * `clearAllLocalBrowserData` wipes on logout, account deletion, and a confirmed account switch.
 */

const guestSessionStorageKey = "flashcards-web-guest-session";
/** Carries the `flashcards-` prefix too, so a probe left behind by a crash is swept like the rest. */
const guestSessionStorageProbeKey = "flashcards-web-guest-session-probe";

/** A failed attempt must not turn a click-happy visitor into a burst of session requests. */
const guestSessionRetryDelayMs = 30 * 1000;

type WebGuestSessionState = "idle" | "requesting" | "settled";

let state: WebGuestSessionState = "idle";
let retryNotBeforeMs = 0;
/**
 * Bumped by every identity boundary. A request captures it before it starts, so work that began
 * before the boundary can neither store nor publish the identity it obtained under the person who
 * has since left.
 */
let identityGeneration = 0;
/**
 * How many session layers are mounted right now. The session layer is the only thing that publishes
 * a confirmed account owner for the analytics queue, and it is mounted only under the authenticated
 * app shell: the public catalog, invite and share routes render without it. So while this is above
 * zero an account owner can still arrive on this page load, and while it is zero none can.
 */
let sessionOwnerPublisherCount = 0;

/**
 * Announces the session layer for as long as it is mounted, and returns the release.
 *
 * It exists so the `logged_in` cookie can be read as "an account may still claim this load" rather
 * than as "an account owns this browser". The cookie carries a 35-day max-age and the auth service
 * clears it only when a refresh is actually attempted and fails, so on the public routes — where no
 * refresh ever runs — treating the cookie on its own as a reason to stay silent would leave a
 * visitor who signed in once unmeasured for weeks on exactly the signed-out funnel this module
 * exists to cover. Pairing it with a mounted session layer keeps the protection where an account
 * can actually be raced and drops it where none can.
 */
export function registerWebSessionOwnerPublisher(): () => void {
  sessionOwnerPublisherCount += 1;
  let isReleased = false;
  return (): void => {
    // A double release would decrement the count below the publishers that are still mounted, and
    // this guard fails closed: the count only ever over-reports, never under-reports.
    if (isReleased) {
      return;
    }

    isReleased = true;
    sessionOwnerPublisherCount -= 1;
  };
}

/**
 * Whether an account owner can still be published on this page load and this browser says one
 * exists, in which case the guest identity stands down for the rest of the load.
 *
 * `getOptionalSession()` cannot answer this on its own: it deliberately does not refresh, so a
 * signed-in person whose access token has expired but is still refreshable answers 401 there and
 * looks signed out. A click landing in that window would let the guest claim the analytics queue
 * ahead of the account — discarding what the account had queued and rotating its `anonymous_id`,
 * neither of which has a repair path. Where no session layer is mounted the same cookie says only
 * that this visitor signed in at some point, and they are measured as the signed-out visitor they
 * are right now.
 */
function shouldDeferToBrowserSessionOwner(): boolean {
  return sessionOwnerPublisherCount > 0 && hasLoggedInCookie();
}

function readBrowserStorageItem(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    // Storage is unusable in a few real configurations (Safari private browsing, storage disabled by
    // policy). Analytics must never surface that to the user; the visitor simply stays unmeasured.
    return null;
  }
}

function writeBrowserStorageItem(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // The session still works for this page load; it just will not be reused on the next one.
  }
}

function removeBrowserStorageItem(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing readable is left behind either: the same store is what a read would have failed on.
  }
}

/**
 * Whether a guest session obtained now could actually be remembered.
 *
 * Creating one is not a local operation: the backend writes a user row, a workspace, a membership
 * and the guest session itself, and nothing deletes them. Where `localStorage` is unusable — blocked
 * by policy or setting, some embedded webviews — the stored-session guard can never match, so every
 * page load would mint another permanent set of rows, for a visitor who cannot persist an
 * `anonymous_id` or an IndexedDB queue and therefore produces no measurement to pay for them.
 *
 * The probe writes and reads back rather than only writing: a store that accepts a write and keeps
 * nothing fails exactly the same way as one that throws.
 */
function canPersistWebGuestSession(): boolean {
  try {
    window.localStorage.setItem(guestSessionStorageProbeKey, "1");
    const didPersist = window.localStorage.getItem(guestSessionStorageProbeKey) === "1";
    window.localStorage.removeItem(guestSessionStorageProbeKey);
    return didPersist;
  } catch {
    return false;
  }
}

function toWebGuestSession(value: unknown): WebGuestSessionEnvelope | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { guestToken, userId } = value as Readonly<{ guestToken?: unknown; userId?: unknown }>;
  if (
    typeof guestToken !== "string"
    || guestToken.trim() === ""
    || typeof userId !== "string"
    || userId.trim() === ""
  ) {
    return null;
  }

  return { guestToken, userId };
}

function readStoredWebGuestSession(): WebGuestSessionEnvelope | null {
  const storedValue = readBrowserStorageItem(guestSessionStorageKey);
  if (storedValue === null) {
    return null;
  }

  try {
    return toWebGuestSession(JSON.parse(storedValue) as unknown);
  } catch {
    return null;
  }
}

/**
 * Tells the analytics client which guest identity this browser holds. It confirms no owner and sends
 * nothing; it only lets a later sign-in be recognised as this guest continuing rather than a second
 * person arriving. Call it on every load, before the session layer can confirm an account owner.
 */
export function registerWebGuestOwnerForAnalytics(): void {
  try {
    setAnalyticsGuestOwnerId(readStoredWebGuestSession()?.userId ?? null);
  } catch {
    // Leaving it unregistered only costs the `anonymous_id` continuity at a later sign-in, which
    // undercounts rather than attributing one person's history to another.
  }
}

/**
 * Whether the session layer already owns the analytics identity on this browser. Synchronous and
 * cheap on purpose, so it can be re-read immediately before a publish: the cached CSRF token is set
 * by the same `/me` load the session layer confirms its owner from, and it is only ever cached for
 * the session transport.
 */
function hasVerifiedBrowserSession(): boolean {
  return getCachedSessionCsrfToken() !== null;
}

function publishWebGuestOwner(guestSession: WebGuestSessionEnvelope): void {
  // Re-checked synchronously here, immediately before the publish, rather than only at the top of
  // `resolveWebGuestSession`: awaits sit between the two, and the session layer both mounts and
  // verifies the browser session on its own schedule. This narrows the window; it does not close it.
  // What closes it is `setAnalyticsConfirmedOwner` refusing to let a guest replace a session owner
  // at all.
  if (hasVerifiedBrowserSession() || shouldDeferToBrowserSessionOwner()) {
    return;
  }

  setAnalyticsGuestOwnerId(guestSession.userId);
  setAnalyticsConfirmedOwner(guestSession.userId, {
    kind: "guest",
    guestToken: guestSession.guestToken,
  });
}

async function resolveWebGuestSession(requestGeneration: number): Promise<void> {
  // The kill switch is an explicit opt-out, and a guest session writes a user row on the server.
  // Nothing about an opted-out visitor may reach the backend, so this stops before the identity is
  // requested rather than only holding the events back.
  if (readStoredAnalyticsEnabled() === false) {
    return;
  }

  // A verified browser session means the session layer owns the analytics identity. A guest
  // credential must never compete with it, and the cached CSRF token is the cheap half of the check:
  // inside the app shell it is already loaded, so a signed-in person's click costs no request.
  if (hasVerifiedBrowserSession()) {
    return;
  }

  // A mounted session layer is about to publish an account owner for this browser, and `logged_in`
  // is this browser's own statement that an account owns it. Standing down on that pair is what
  // keeps a guest out of the refresh window; standing down on the cookie alone is what would leave
  // the public routes unmeasured, so the two are only ever checked together.
  if (shouldDeferToBrowserSessionOwner()) {
    return;
  }

  if (await getOptionalSession() !== null) {
    return;
  }

  // The only await in this module that had no generation check after it. A boundary landing inside
  // it used to fall straight through to `createWebGuestSession()` and mint a permanent server-side
  // guest user, workspace and membership for nobody, which the check below the request then threw
  // away.
  if (requestGeneration !== identityGeneration) {
    return;
  }

  // Re-checked after the await as well, because the interaction that started this may itself be the
  // click that leaves a public route for the app shell: the session layer mounts while `/me` is in
  // flight, and from that moment an account owner is still coming on this load.
  if (shouldDeferToBrowserSessionOwner()) {
    return;
  }

  const storedGuestSession = readStoredWebGuestSession();
  if (storedGuestSession !== null) {
    publishWebGuestOwner(storedGuestSession);
    return;
  }

  // Nothing is minted that this browser could not recognise again on its next load. Giving up rather
  // than retrying is the point: every retry would be another permanent set of server rows.
  if (canPersistWebGuestSession() === false) {
    return;
  }

  const guestSession = await createWebGuestSession();
  // An identity boundary crossed while the request was in flight. This guest belongs to nobody on
  // this browser now, so it is neither stored nor published; the next interaction starts over.
  if (requestGeneration !== identityGeneration) {
    return;
  }

  writeBrowserStorageItem(guestSessionStorageKey, JSON.stringify(guestSession));
  publishWebGuestOwner(guestSession);
}

/**
 * Drops this browser's guest identity at an identity boundary.
 *
 * Synchronous, and called next to `reset()` in the analytics client rather than left to the
 * `flashcards-` prefix sweep in `clearAllLocalBrowserData`. That sweep runs several awaits later and
 * is skipped entirely when the IndexedDB recovery guard fires first, and until the key is gone an
 * interaction inside that window would read the outgoing person's guest session back out of storage
 * and publish it as the confirmed owner for the rest of the page load.
 *
 * The module state goes back to idle with it: this browser now holds no guest identity, so a later
 * interaction by a signed-out visitor may obtain a fresh one, exactly as it would on a new load.
 */
export function resetWebGuestSession(): void {
  try {
    identityGeneration += 1;
    state = "idle";
    retryNotBeforeMs = 0;
    removeBrowserStorageItem(guestSessionStorageKey);
  } catch {
    // Identity-boundary cleanup must not fail because the guest record could not be removed.
  }
}

/**
 * Obtains and publishes the guest identity, at most once per browser load and once more after each
 * identity boundary. Returns immediately: the request runs in the background, because no user action
 * may be blocked, delayed, or failed by anything analytics needs.
 *
 * Settling once per load is the bound that keeps server-side rows finite, and it is kept even though
 * it has a cost: if the published identity is invalidated later in the same load — the session
 * deleted server-side, say — nothing here tries again, and the rest of that load goes unmeasured.
 * That is the accepted side of the trade. Re-arming on invalidation would put minting back on a path
 * a repeating failure can drive, and every mint is a permanent guest user, workspace and membership.
 * Only a real failure re-arms, once per `guestSessionRetryDelayMs`.
 */
export function requestWebGuestSessionOnInteraction(): void {
  try {
    if (state !== "idle" || Date.now() < retryNotBeforeMs) {
      return;
    }

    state = "requesting";
    const requestGeneration = identityGeneration;
    void resolveWebGuestSession(requestGeneration).then((): void => {
      // An identity boundary already put this module back to idle for whoever is here now; a
      // finished request from before it may not settle the state on their behalf.
      if (requestGeneration !== identityGeneration) {
        return;
      }

      state = "settled";
    }).catch((): void => {
      // Offline, throttled, or refused: the events stay queued under their 14-day TTL and a later
      // interaction tries again. Nothing here is reported — the request the server refused is
      // already visible to the server.
      if (requestGeneration !== identityGeneration) {
        return;
      }

      state = "idle";
      retryNotBeforeMs = Date.now() + guestSessionRetryDelayMs;
    });
  } catch {
    // Nothing on the interaction path may surface as an uncaught error.
  }
}
