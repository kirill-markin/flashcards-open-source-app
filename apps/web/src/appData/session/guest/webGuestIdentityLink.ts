import {
  ApiError,
  getOptionalSession,
  linkWebGuestIdentity,
  type WebGuestSessionEnvelope,
} from "../../../api";
import { readAnalyticsSessionOwnerId } from "../../../analytics";
import { readStoredAnalyticsEnabled } from "../../../analytics/identity";
import { reportAnalyticsGuestIdentityLinkFailure } from "../../../analytics/observation";
import { waitForDelay } from "../lifecycle/workspaceLifecycleHelpers";
import {
  markWebGuestSessionLinkAccount,
  readStoredWebGuestSession,
  readWebGuestIdentityGeneration,
  readWebGuestSessionLinkAccountId,
  resetWebGuestSession,
} from "./webGuestSession";

/**
 * Hands the guest identity this browser measured under to the account that has just signed in, so
 * the visitor's analytics history follows them into it.
 *
 * Nothing here may block, delay or fail sign-in: the caller starts it and walks away, and every
 * failure ends as one report and a swallowed error. What it may not do is give up quietly on a
 * failure the route calls retryable, which is why the retry rules below are as explicit as the
 * route's own.
 */

/** Attempts one sign-in spends before leaving the rest to the next app start. */
const maximumLinkAttemptCount = 4;
const linkRetryBaseDelayMs = 1000;
/**
 * The ceiling for any single wait, a served `Retry-After` included, and the top step of the local
 * ladder. This whole loop is a background task inside a page load that can end at any moment, so a
 * `Retry-After` of minutes would not be honoured — it would park every remaining attempt past the
 * load that could have run them, turning a retryable refusal into no retry at all. Capping costs
 * nothing: the envelope is kept, and the next app start picks the work back up.
 */
const linkRetryMaxDelayMs = 4 * linkRetryBaseDelayMs;

/**
 * `retryable` is a refusal that says nothing about this guest token, so the token is kept.
 * `account_row_missing` is the same, plus the one precondition a client can actually satisfy.
 * `unconvergeable` is a refusal no repeat of these same bytes converges on, but which says nothing
 * about the token either, so the loop stops and the token is still kept.
 * `terminal` is a refusal of the token itself, which is therefore dropped with it.
 */
type GuestIdentityLinkVerdict =
  | "retryable"
  | "account_row_missing"
  | "unconvergeable"
  | "terminal";

/**
 * The refusals that are about this guest token rather than about the moment it was sent. Only these
 * drop it, because only these stay true of the token itself on every later attempt.
 */
const terminalGuestIdentityLinkCodes: ReadonlySet<string> = new Set([
  // The guest owns data the upgrade flow transfers. A web guest should never reach it — it is an
  // analytics credential that can never own anything, and there is deliberately no upgrade flow here
  // to convert it through — and repeating the call unchanged never succeeds.
  "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED",
  // The token names a user that is already a different real account: not this browser's to link.
  "GUEST_IDENTITY_LINK_OTHER_ACCOUNT",
  // The account this browser just signed into has been deleted.
  "ACCOUNT_DELETED",
]);

function readGuestIdentityLinkVerdict(error: unknown): GuestIdentityLinkVerdict {
  // Not a refusal from the route at all — a timed-out or aborted request, most often.
  if (error instanceof ApiError === false) {
    return "retryable";
  }

  if (error.code !== null && terminalGuestIdentityLinkCodes.has(error.code)) {
    return "terminal";
  }

  if (error.code === "GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED") {
    return "account_row_missing";
  }

  // A status the route's error contract does not name at all. A body it refuses is a defect in this
  // client and the same bytes fail identically, so repeating is pointless — but the token is kept
  // regardless, because a `400` says nothing about the guest it names. Dropping it is irreversible
  // and loses that visitor's whole analytics tail; keeping it costs one stored envelope that the next
  // identity boundary clears anyway. An `ApiNetworkError` raised while reading a `400` body carries
  // the real status too, and belongs on this branch rather than on a retry of the same refusal.
  if (error.statusCode === 400) {
    return "unconvergeable";
  }

  // Everything else is kept and repeated. A web guest reaches no upgrade flow, so an attempt here is
  // what claims its tail: a `5xx` leaves that tail unclaimed, and a dropped token loses it
  // permanently. A transport failure, or a browser session that lapsed between `/me` and here, says
  // nothing about the guest token either. Repeating is safe in all of them: the route commits the
  // link and the revoke together, so a repeat either redoes an attempt that stored nothing, or meets
  // a revoked token and is a no-op.
  return "retryable";
}

function readGuestIdentityLinkStatusCode(error: unknown): number | null {
  return error instanceof ApiError ? error.statusCode : null;
}

/** A served `Retry-After` is honoured under the cap; a refusal that serves none backs off locally. */
function createLinkRetryDelayMs(attemptCount: number, error: unknown): number {
  const retryAfterMs = error instanceof ApiError ? error.retryAfterMs : null;
  const requestedDelayMs = retryAfterMs ?? linkRetryBaseDelayMs * 2 ** (attemptCount - 1);
  return Math.min(requestedDelayMs, linkRetryMaxDelayMs);
}

/**
 * Drops the envelope, but only while it is still the one this task captured. This runs as a
 * background task with awaits in it, and a drop crossing meanwhile could otherwise take out a guest
 * identity that belongs to whoever is on this browser by then.
 */
function dropStoredWebGuestSession(guestToken: string): void {
  if (readStoredWebGuestSession()?.guestToken !== guestToken) {
    return;
  }

  resetWebGuestSession();
}

async function runGuestIdentityLink(
  guestToken: string,
  capturedIdentityGeneration: number,
  accountUserId: string,
): Promise<void> {
  for (let attemptCount = 1; attemptCount <= maximumLinkAttemptCount; attemptCount += 1) {
    // The one thing this task may never do is offer a captured guest to an account it did not
    // belong to. The route binds the token in the body to whoever the browser session is *now*, into
    // an append-only, first-link-wins table with no repair path, so a browser that changed hands
    // since the capture would hand one person's signed-out tail to another, permanently.
    //
    // Both halves are checked before every attempt rather than once at the start: the loop spans
    // awaits, and either one changing inside it matters just as much as before it. The generation
    // catches every drop this module made, and only those — `readWebGuestIdentityGeneration`
    // documents the storage sweep it cannot see. The published owner catches the case it cannot
    // — a second account signing in from another tab replaces the shared session cookie
    // immediately, while this tab only observes it on focus, on visibility, or on its 60s
    // revalidate, and this loop can live for tens of seconds inside that lag. `getOptionalSession()`
    // below would even re-cache the new account's CSRF token for it. Giving up here undercounts a
    // single cross-identity sign-in, which is the same trade the analytics queue claim already makes
    // rather than risk merging two people.
    if (
      readWebGuestIdentityGeneration() !== capturedIdentityGeneration
      || readAnalyticsSessionOwnerId() !== accountUserId
    ) {
      return;
    }

    try {
      await linkWebGuestIdentity(guestToken);
      // The route revoked the guest session, so the envelope is now a dead credential. Dropping it
      // here rather than at the identity boundary is what stops a later signed-out load from
      // republishing it as the analytics owner and posting batches nothing will accept.
      dropStoredWebGuestSession(guestToken);
      return;
    } catch (error) {
      const verdict = readGuestIdentityLinkVerdict(error);
      if (verdict === "terminal") {
        // No retry can make this token linkable, so it is dropped rather than carried forward.
        dropStoredWebGuestSession(guestToken);
        reportAnalyticsGuestIdentityLinkFailure(readGuestIdentityLinkStatusCode(error));
        return;
      }

      if (verdict === "unconvergeable" || attemptCount === maximumLinkAttemptCount) {
        // The envelope is deliberately left in place. Neither refusal was about this guest token,
        // and dropping it on one of those loses this visitor's whole analytics tail permanently.
        // Every app start reads the envelope back and retries after its own `GET /me`. What keeps a
        // kept envelope from reaching a different account is the account stamp written before the
        // first attempt: within this load the two guards above hold, and across loads — where the
        // generation restarts at zero and the IndexedDB record the sign-in path detects switches
        // from may be gone — the stamp is what refuses it.
        reportAnalyticsGuestIdentityLinkFailure(readGuestIdentityLinkStatusCode(error));
        return;
      }

      await waitForDelay(createLinkRetryDelayMs(attemptCount, error));
      if (verdict === "account_row_missing") {
        // The route resolves the account from `auth.user_identities`, which the first request that
        // loads a request context after sign-in writes. The caller already awaited one, so reaching
        // this means the row is still absent, and repeating the link alone would be refused
        // identically forever: another request context is the documented remedy, not an
        // optimisation. It never redirects to sign in and it never throws on a 401.
        //
        // It also answers, live and from the server, who the browser session names right now, which
        // is the very question the published owner can only answer as of this tab's last look. This
        // call re-caches that account's CSRF token on its way through, so the remaining attempts
        // would carry the new account's credential fully formed; a different account here therefore
        // ends the loop rather than starting the next attempt.
        //
        // Which is why the loop's own guard is re-run here as well, immediately before the one
        // request in this loop it does not already precede: this point sits a failed round trip and
        // up to `linkRetryMaxDelayMs` past that check, and a CSRF token re-cached for an owner that
        // has moved since is not one this browser's queued work should be handed.
        if (
          readWebGuestIdentityGeneration() !== capturedIdentityGeneration
          || readAnalyticsSessionOwnerId() !== accountUserId
        ) {
          return;
        }

        // Deliberately uncontained: this rethrows everything that is not a `401`, so a `5xx` or a
        // transport failure on the remedy ends the ladder instead of costing it one attempt. That
        // lands on the same outcome as exhausting it — the envelope and its stamp are kept, the
        // caller's `catch` reports the failure, and the next app start retries from the top.
        const currentSession = await getOptionalSession();
        if (currentSession !== null && currentSession.userId !== accountUserId) {
          return;
        }
      }
    }
  }
}

/**
 * Starts the link for a guest envelope captured before sign-in, and returns immediately.
 *
 * Pass the envelope read before any identity-boundary cleanup ran, together with the generation read
 * beside it, and the account the verified session names. The first two are load-bearing in opposite
 * directions: reading early is what keeps the token available at all, because the cleanup clears the
 * stored one — and the generation is what makes reading early safe, because an early read also
 * survives the boots where that cleanup fires because a *different* person now holds this browser.
 * Nothing is linked once the generation has moved on.
 *
 * The account closes the door neither of them can. A guest may be bound to exactly one account,
 * once, so an envelope that outlived an earlier unfinished link is already spoken for; the
 * generation cannot say so, because it is in-memory and starts at zero on every load. Across loads
 * the only detector of a changed account is the IndexedDB cloud-settings record, and a browser that
 * loses it while keeping `localStorage` — the store both the envelope and this stamp live in — sees
 * no boundary at all. So the account the envelope was offered to is stored beside it, and an
 * envelope offered to somebody else is dropped here rather than re-offered.
 */
export function linkWebGuestIdentityInBackground(
  guestSession: WebGuestSessionEnvelope | null,
  capturedIdentityGeneration: number,
  accountUserId: string,
): void {
  // The same opt-out that stops `resolveWebGuestSession` before it mints an identity stops this
  // before it spends one. The link writes an append-only, first-link-wins row with no repair path,
  // so it is the most permanent backend write on this path and the least defensible one to make for
  // somebody who declined measurement — and the switch outlives every local data wipe, so the
  // visitor who minted a guest and only then opted out still arrives here. The envelope and its
  // stamp are left alone rather than dropped: `resolveWebGuestSession` refuses to republish or mint
  // while the switch is off, so the envelope sits inert, and keeping it is what lets the tail still
  // be linked if analytics is turned back on before the next identity boundary.
  if (readStoredAnalyticsEnabled() === false) {
    return;
  }

  if (guestSession === null) {
    return;
  }

  // This runs inside the sign-in path, which no analytics work may fail. Everything below already
  // swallows its own storage errors; the wrapper is what keeps that a property of this call rather
  // than of the functions it happens to use today.
  try {
    // Checked before the stamp is read or written: once the generation has moved the stored envelope
    // is no longer the captured one, and both operations would be describing somebody else's.
    if (readWebGuestIdentityGeneration() !== capturedIdentityGeneration) {
      return;
    }

    const offeredAccountUserId = readWebGuestSessionLinkAccountId();
    if (offeredAccountUserId !== null && offeredAccountUserId !== accountUserId) {
      // This envelope was spent on another account and can never be linked again. Dropping it now
      // is also what retires the stamp: the pair never survives its own first mismatch, so it
      // cannot become a permanently unlinkable envelope that every later load republishes as the
      // analytics owner. The cost is one visitor's signed-out tail, which is the undercount this
      // codebase prefers to a misattribution.
      dropStoredWebGuestSession(guestSession.guestToken);
      return;
    }

    markWebGuestSessionLinkAccount(guestSession.guestToken, accountUserId);
    void runGuestIdentityLink(guestSession.guestToken, capturedIdentityGeneration, accountUserId)
      .catch((error: unknown): void => {
        reportAnalyticsGuestIdentityLinkFailure(readGuestIdentityLinkStatusCode(error));
      });
  } catch {
    // The link is lost for this load; the envelope is kept and the next app start picks it back up.
  }
}
