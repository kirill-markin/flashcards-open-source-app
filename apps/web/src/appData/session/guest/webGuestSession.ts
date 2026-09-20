import type { WebGuestSessionEnvelope } from "../../../api";

/**
 * The guest identity a browser may still be carrying from an earlier build of this app, and nothing
 * more: this app no longer asks for one.
 *
 * It existed because the analytics ingest endpoint always requires a credential, so a signed-out
 * visitor could not be measured without one. That is no longer true — a signed-out browser reports
 * through the credential-free collector under the shared visitor identity
 * (docs/anonymous-client-analytics.md, docs/analytics-visitor-identity.md) — and the web guest
 * session had no other consumer: `apps/backend/src/guestAuth/webPlatform.ts` refuses the web guest
 * platform on every authenticated backend surface, sync, chat and its AI quota, guest upgrade and
 * every account surface among them.
 *
 * A stored envelope is still worth something, which is why this module remains: it names the guest
 * whose rows are that browser's signed-out tail, and `POST /guest-auth/identity/link` binds it to
 * the account at the next sign-in. `webGuestIdentityLink.ts` owns that call and its retry rules,
 * and the envelope is dropped once it has answered. An envelope kept across loads by an unfinished
 * link carries the account it was offered to beside it, because a guest may be bound to exactly one
 * account and nothing else survives a reload to say which.
 *
 * Every real identity boundary drops it: `resetWebGuestSession` removes it synchronously alongside
 * the analytics reset, and the key also carries the `flashcards-` prefix that
 * `clearAllLocalBrowserData` wipes on logout, account deletion, and a confirmed account switch.
 */

const guestSessionStorageKey = "flashcards-web-guest-session";
/**
 * The creation idempotency key earlier builds kept beside the envelope while a creation attempt was
 * open. Nothing writes one any more; it is still swept with the envelope it described.
 */
const guestSessionIdempotencyKeyStorageKey = "flashcards-web-guest-session-idempotency-key";
/**
 * The account the stored envelope has already been offered to for linking, kept beside the envelope
 * because it describes one envelope and is meaningless without it. `resetWebGuestSession` drops it
 * with the envelope, so it can never outlive what it describes.
 */
const guestSessionLinkAccountStorageKey = "flashcards-web-guest-session-link-account";

/**
 * Advanced by every `resetWebGuestSession()` — see `readWebGuestIdentityGeneration` for what that
 * does and does not cover.
 */
let identityGeneration = 0;

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
    // The stamp is an optimisation over the server's own first-link-wins rule; see
    // `markWebGuestSessionLinkAccount`.
  }
}

function removeBrowserStorageItem(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing readable is left behind either: the same store is what a read would have failed on.
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
 * which covers each identity boundary and a finished or refused link — several of those fire for the
 * same visitor, so this is deliberately not a count of identity boundaries.
 *
 * Only the unequal direction is a fact consumers may rely on. Anything that captures a guest
 * envelope and then does asynchronous work with it captures this number beside it, and a capture
 * that reads unequal here is stale and must be dropped, never used: the envelope it names is no
 * longer the envelope in storage, and may not be in storage at all.
 *
 * An equal read proves nothing, and reading it as "the envelope is unchanged" is the mistake to
 * avoid. `clearAllLocalBrowserData` sweeps every `flashcards-` key — the envelope and the
 * link-account stamp among them — and never touches this counter, and the account deletion gate
 * calls that sweep with no `resetWebGuestSession()` in front of it, so storage can empty while this
 * number stands still. That is why every storage operation here re-reads the stored token rather
 * than trusting an equal generation, and why the link task carries an account assertion of its own
 * instead of inferring the account from this.
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
 * The write itself may be silently lost, and the caller offers the envelope whether or not the stamp
 * landed. That falls back to the server's own first-link-wins rule, under which the same guest
 * offered to a second account writes a losing append-only row rather than a wrong binding. The cost
 * is an undercounted tail, never a misattributed one.
 */
export function markWebGuestSessionLinkAccount(guestToken: string, accountUserId: string): void {
  if (readStoredWebGuestSession()?.guestToken !== guestToken) {
    return;
  }

  writeBrowserStorageItem(guestSessionLinkAccountStorageKey, accountUserId);
}

/**
 * Drops this browser's guest identity.
 *
 * At an identity boundary it is synchronous, and called next to `reset()` in the analytics client
 * rather than left to the `flashcards-` prefix sweep in `clearAllLocalBrowserData`. That sweep runs
 * several awaits later and is skipped entirely when the IndexedDB recovery guard fires first, and
 * until the key is gone the link started for the outgoing person could still read it back out of
 * storage and bind it to whoever signs in next.
 */
export function resetWebGuestSession(): void {
  try {
    identityGeneration += 1;
    removeBrowserStorageItem(guestSessionStorageKey);
    // The key of an earlier build's open creation attempt goes with it. Replaying one hands whoever
    // presents it a fresh valid token for the guest it names.
    removeBrowserStorageItem(guestSessionIdempotencyKeyStorageKey);
    // So does the account the envelope was offered to: it describes an envelope that no longer
    // exists. A stamp left behind would outlive its envelope and refuse a later, unrelated one, so
    // the two only ever leave together — here, and in the `flashcards-` prefix sweep.
    removeBrowserStorageItem(guestSessionLinkAccountStorageKey);
  } catch {
    // Identity-boundary cleanup must not fail because the guest record could not be removed.
  }
}
