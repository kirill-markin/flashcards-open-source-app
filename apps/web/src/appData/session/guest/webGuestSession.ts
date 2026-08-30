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
 * The stored session survives the sign-in itself and is dropped only once
 * `POST /guest-auth/identity/link` has bound it to the account server-side, or answered that it
 * never can be. Until then it is the record that lets the analytics client recognise that the
 * queue's previous owner was this browser's own guest rather than a different account, which is what
 * keeps `anonymous_id` alive across the boundary so the guest's tail and the account's rows carry
 * the same raw `anonymous_id` in `analytics.product_events`. The link is what additionally resolves
 * the guest into the account in `analytics.product_events_resolved`; `webGuestIdentityLink.ts` owns
 * that call and its retry rules. An envelope kept across loads by an unfinished link carries the
 * account it was offered to beside it, because a guest may be bound to exactly one account and
 * nothing else survives a reload to say which.
 *
 * Every real identity boundary drops it: `resetWebGuestSession` removes it synchronously alongside
 * the analytics reset, and the key also carries the `flashcards-` prefix that
 * `clearAllLocalBrowserData` wipes on logout, account deletion, and a confirmed account switch.
 */

const guestSessionStorageKey = "flashcards-web-guest-session";
/** Carries the `flashcards-` prefix too, so a probe left behind by a crash is swept like the rest. */
const guestSessionStorageProbeKey = "flashcards-web-guest-session-probe";
/**
 * The creation idempotency key, kept beside the envelope rather than inside it: it exists only while
 * no envelope does, and it is dropped the moment one arrives.
 */
const guestSessionIdempotencyKeyStorageKey = "flashcards-web-guest-session-idempotency-key";
/**
 * The account the stored envelope has already been offered to for linking, kept beside the envelope
 * for the same reason the idempotency key is: it describes one envelope and is meaningless without
 * it. `resetWebGuestSession` drops it with the envelope, so it can never outlive what it describes.
 */
const guestSessionLinkAccountStorageKey = "flashcards-web-guest-session-link-account";
/** 16 random bytes, which the route's 32-to-200 lowercase-hex shape accepts at its lower bound. */
const guestSessionIdempotencyKeyByteCount = 16;
const guestSessionIdempotencyKeyPattern = /^[0-9a-f]{32,200}$/u;

/** A failed attempt must not turn a click-happy visitor into a burst of session requests. */
const guestSessionRetryDelayMs = 30 * 1000;

type WebGuestSessionState = "idle" | "requesting" | "settled";

let state: WebGuestSessionState = "idle";
let retryNotBeforeMs = 0;
/**
 * Advanced by every `resetWebGuestSession()` — see `readWebGuestIdentityGeneration` for what that
 * does and does not cover. A request captures it before it starts, so work that began before a reset
 * can neither store nor publish an identity that is no longer this browser's.
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

/**
 * The guest identity this browser holds, if any. Read it before any identity-boundary cleanup runs:
 * that cleanup clears the envelope, and the sign-in link needs the token it carries.
 */
export function readStoredWebGuestSession(): WebGuestSessionEnvelope | null {
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
 * A monotonic count of the drops this module performed. Every `resetWebGuestSession()` advances it,
 * which covers each identity boundary, an ingest refusal of the credential, and a finished or
 * refused link — several of those fire for the same visitor, so this is deliberately not a count of
 * identity boundaries.
 *
 * Only the unequal direction is a fact consumers may rely on. Anything that captures a guest
 * envelope and then does asynchronous work with it captures this number beside it, and a capture
 * that reads unequal here is stale and must be dropped, never used: the envelope it names is no
 * longer the envelope in storage, and may not be in storage at all.
 *
 * An equal read proves nothing, and reading it as "the envelope is unchanged" is the mistake to
 * avoid. `clearAllLocalBrowserData` sweeps every `flashcards-` key — the envelope, the idempotency
 * key and the link-account stamp among them — and never touches this counter, and the account
 * deletion gate calls that sweep with no `resetWebGuestSession()` in front of it, so storage can
 * empty while this number stands still. That is why every storage operation here re-reads the stored
 * token rather than trusting an equal generation, and why the link task carries an account assertion
 * of its own instead of inferring the account from this.
 */
export function readWebGuestIdentityGeneration(): number {
  return identityGeneration;
}

/**
 * The account this browser's stored guest envelope has already been offered to, if any.
 *
 * A guest identity may be bound to exactly one account, in an append-only, first-link-wins table
 * with no repair path, so an envelope that survived an unfinished link is no longer offerable to
 * whoever signs in next: it is a specific person's signed-out tail, already claimed for a specific
 * account. Nothing else on this browser can say so on a later page load — the identity generation is
 * in-memory and starts at zero on every load, and the cloud-settings record the sign-in path detects
 * account switches from lives in IndexedDB, which can be lost while `localStorage` survives.
 */
export function readWebGuestSessionLinkAccountId(): string | null {
  const storedValue = readBrowserStorageItem(guestSessionLinkAccountStorageKey);
  if (storedValue === null || storedValue.trim() === "") {
    return null;
  }

  return storedValue;
}

/**
 * Records the account an envelope is being offered to, before the offer is made rather than after it
 * is answered: a tab closed mid-retry runs no completion path at all, and a response lost after the
 * commit landed leaves this browser unable to tell a claimed guest from an unclaimed one — so an
 * envelope still in storage afterwards must already carry the account it was spent on.
 *
 * Guarded on the stored envelope still being the one that is being offered, so that this can only
 * ever describe what is actually in storage: a stamp written over a dropped envelope would outlive
 * it and refuse the next visitor's. Two paths retire it — `resetWebGuestSession`, and the
 * `flashcards-` prefix sweep in `clearAllLocalBrowserData` — and each takes the envelope in the same
 * pass, which is what keeps the two from outliving each other.
 *
 * The write itself may be silently lost: `writeBrowserStorageItem` swallows a full quota or a
 * private-mode refusal, and the caller offers the envelope whether or not the stamp landed. The
 * asymmetry with `persistWebGuestSession`'s read-back is deliberate. There a lost write mints a
 * second permanent guest user, workspace and membership; here it only falls back to the server's own
 * first-link-wins rule, under which the same guest offered to a second account writes a losing
 * append-only row rather than a wrong binding. The cost is an undercounted tail, never a
 * misattributed one.
 */
export function markWebGuestSessionLinkAccount(guestToken: string, accountUserId: string): void {
  if (readStoredWebGuestSession()?.guestToken !== guestToken) {
    return;
  }

  writeBrowserStorageItem(guestSessionLinkAccountStorageKey, accountUserId);
}

/**
 * Stores the envelope and reports whether it can actually be read back.
 *
 * The read-back is not a repeat of `canPersistWebGuestSession()`. That probe ran before the creation
 * request, several awaits earlier, and `writeBrowserStorageItem` swallows its own failure, so a quota
 * that filled up in between leaves this browser holding no envelope at all — silently. It is what
 * decides whether the idempotency key may be released, and releasing it over an envelope that was
 * never stored is exactly the second permanent guest user, workspace and membership the key exists to
 * prevent.
 */
function persistWebGuestSession(guestSession: WebGuestSessionEnvelope): boolean {
  writeBrowserStorageItem(guestSessionStorageKey, JSON.stringify(guestSession));
  return readStoredWebGuestSession()?.guestToken === guestSession.guestToken;
}

function createGuestSessionIdempotencyKey(): string {
  const randomBytes = new Uint8Array(guestSessionIdempotencyKeyByteCount);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, (byte: number): string => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The key for the creation attempt that is currently open, generating one when none is.
 *
 * It is reused across attempts on purpose: a response lost after the server committed leaves this
 * browser with no envelope and a live guest session, and replaying the same key rotates that
 * session's secret and returns the same guest instead of minting a second permanent set of rows. It
 * must never be derived from an install id, a device id, or anything else stable — rotation hands
 * whoever presents the key a fresh valid token for that guest, so a predictable key is a bearer
 * credential for the identity behind it. A stored value that is not the shape the route accepts is
 * not this module's, and is replaced rather than sent.
 */
function readGuestSessionIdempotencyKey(): string {
  const storedValue = readBrowserStorageItem(guestSessionIdempotencyKeyStorageKey);
  if (storedValue !== null && guestSessionIdempotencyKeyPattern.test(storedValue)) {
    return storedValue;
  }

  const idempotencyKey = createGuestSessionIdempotencyKey();
  writeBrowserStorageItem(guestSessionIdempotencyKeyStorageKey, idempotencyKey);
  return idempotencyKey;
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

  const guestSession = await createWebGuestSession(readGuestSessionIdempotencyKey());
  // An identity boundary crossed while the request was in flight. This guest belongs to nobody on
  // this browser now, so it is neither stored nor published; the next interaction starts over.
  if (requestGeneration !== identityGeneration) {
    return;
  }

  // The key is released only once the envelope is provably readable again. The creation attempt
  // succeeding is not enough on its own: a browser left with neither envelope nor key mints a second
  // permanent guest user, workspace and membership on its next attempt, which is the one outcome the
  // key exists to prevent. Where the envelope did persist the key has done its job and keeping it
  // would leave a credential that can rotate this guest's token lying in `localStorage` for no
  // purpose. Publishing happens either way: this load is measured even when nothing about it can be
  // remembered for the next one.
  if (persistWebGuestSession(guestSession)) {
    removeBrowserStorageItem(guestSessionIdempotencyKeyStorageKey);
  }

  publishWebGuestOwner(guestSession);
}

/**
 * Drops this browser's guest identity.
 *
 * At an identity boundary it is synchronous, and called next to `reset()` in the analytics client
 * rather than left to the `flashcards-` prefix sweep in `clearAllLocalBrowserData`. That sweep runs
 * several awaits later and is skipped entirely when the IndexedDB recovery guard fires first, and
 * until the key is gone an interaction inside that window would read the outgoing person's guest
 * session back out of storage and publish it as the confirmed owner for the rest of the page load.
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
    // The key goes with the envelope. It names a creation attempt made for the person who is
    // leaving, and replaying it for the next one would hand them that guest's identity.
    removeBrowserStorageItem(guestSessionIdempotencyKeyStorageKey);
    // So does the account the envelope was offered to: it describes an envelope that no longer
    // exists. A stamp left behind would outlive its envelope and refuse a later, unrelated one, so
    // the two only ever leave together — here, and in the `flashcards-` prefix sweep.
    removeBrowserStorageItem(guestSessionLinkAccountStorageKey);
  } catch {
    // Identity-boundary cleanup must not fail because the guest record could not be removed.
  }
}

/**
 * Drops a guest identity the ingest endpoint has refused as a credential — a `401` or a `410`, which
 * for a guest means the session no longer exists server-side. Without this the envelope is
 * republished on every later load and the browser measures nothing for good.
 *
 * It goes through `resetWebGuestSession` so the generation counter and the storage keys stay
 * consistent, and then closes the module for the rest of this load. Returning to idle is right for
 * an identity boundary, where a new person may obtain a guest of their own, and wrong here: a
 * refused credential is the same visitor, and re-arming would put minting on a path a repeating
 * refusal can drive, one permanent guest user, workspace and membership per interaction. The rest of
 * this load goes unmeasured and the next one mints a fresh guest, which is the trade
 * `requestWebGuestSessionOnInteraction` already documents.
 */
export function discardRefusedWebGuestSession(): void {
  try {
    resetWebGuestSession();
    state = "settled";
  } catch {
    // Nothing on the analytics delivery path may surface as an uncaught error.
  }
}

/**
 * Obtains and publishes the guest identity, at most once per browser load and once more each time
 * `resetWebGuestSession()` puts this module back to idle. That is every identity boundary, and also
 * the link paths that drop a spent envelope — a finished link, a terminal refusal — which re-arm on
 * a load that is signed in by then, where `hasVerifiedBrowserSession()` stops the mint before it
 * starts. `discardRefusedWebGuestSession` is the one drop that deliberately does not re-arm.
 * Returns immediately: the request runs in the background, because no user action may be blocked,
 * delayed, or failed by anything analytics needs.
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
