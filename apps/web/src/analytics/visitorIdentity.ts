/**
 * Obtaining the shared analytics visitor identity for this browser.
 *
 * It lives beside `identity.ts` rather than in it because this is the half that talks to the API,
 * and `identity.ts` is imported by the browser-data cleanup the API transport itself depends on.
 */
import { requestAnalyticsVisitor } from "../api";
import { publishAnalyticsConsentJurisdiction, readAnalyticsConsentDecision } from "./consent";
import {
  adoptLegacyAnalyticsAnonymousId,
  dropLegacyAnalyticsAnonymousId,
  readAnalyticsVisitorId,
} from "./identity";

/**
 * What a failed call may cost one page load. Only a thrown request is asked again: a withheld
 * identity is an answer, and a retry that did not separate the two would turn the 60-second periodic
 * flush into one `GET` per tick for every European browser waiting for the consent banner. The cap
 * bounds the whole load and the delay sits far above that tick, so a flaky network cannot poll a
 * route whose first call can pay a GeoLite download.
 */
const maxVisitorIdentityAttemptCount = 3;
const visitorIdentityRetryDelayMs = 5 * 60 * 1000;

let visitorIdentityTask: Promise<void> | null = null;
let hasSettledVisitorIdentity = false;
let hasFailedVisitorIdentity = false;
let visitorIdentityAttemptCount = 0;
let lastVisitorIdentityFailureAtMs = 0;

async function runVisitorIdentityResolution(): Promise<void> {
  try {
    if (readAnalyticsVisitorId() !== null) {
      // This browser already carries the shared identity, so the stored key describes history the
      // cookie has replaced, and the cookie is itself the record that it was allowed one: no banner
      // is owed to a browser that already holds it.
      publishAnalyticsConsentJurisdiction(false);
      dropLegacyAnalyticsAnonymousId();
      hasSettledVisitorIdentity = true;
      return;
    }

    // The answer's own `visitorId` is not read: it carries a fresh id whether or not the browser
    // stored the cookie that came with it, so the cookie is the only evidence that this browser has
    // an identity at all (docs/analytics-visitor-identity.md).
    const visitor = await requestAnalyticsVisitor();
    // The banner is owed to this browser exactly where the route says the country requires one, and
    // it is published before the cookie is read so a granting browser stops being asked either way.
    publishAnalyticsConsentJurisdiction(visitor.consentRequired);
    if (readAnalyticsVisitorId() !== null) {
      adoptLegacyAnalyticsAnonymousId();
      hasSettledVisitorIdentity = true;
      return;
    }

    // No cookie, and the two reasons for that are not the same thing. `consentRequired === false`
    // means the server granted an identity this browser did not keep: it blocks cookies, and it
    // degrades to the per-tab in-memory id for this tab exactly as it did before the shared cookie
    // existed. `consentRequired === true` on `GET` means the server deliberately withheld one until
    // this browser is asked, and reporting it under a fabricated per-tab id is precisely what that
    // refusal forbids — so the gate stays shut and the events wait in the queue for the consent
    // banner. An unreadable body is parsed as withheld, so this fails closed too.
    //
    // A browser that has already granted is settled either way: it asked for the identity itself
    // and the server withholding one here means it kept no cookie, which is the same
    // cookie-blocking degrade to the per-tab id that a minted browser takes.
    hasSettledVisitorIdentity = visitor.consentRequired === false
      || readAnalyticsConsentDecision() === "granted";
  } catch {
    // A transient failure is not an answer, so the gate stays shut rather than releasing delivery
    // under a per-tab id no later load can ever see again: the events stay queued under their
    // 14-day TTL. Unlike a withheld identity this outcome is not latched, because the browser it
    // leaves unmeasured is the signed-out one this whole path exists to measure, and an SPA tab that
    // was offline at boot or met a 5xx is not reloaded when connectivity returns. This request takes
    // no network retry of its own and a first visit can pay a GeoLite download inside it, so failing
    // here is expected rather than exceptional. The failure is already visible to the server, and
    // nothing analytics does may surface to the user.
    hasFailedVisitorIdentity = true;
    lastVisitorIdentityFailureAtMs = Date.now();
    if (visitorIdentityAttemptCount >= maxVisitorIdentityAttemptCount) {
      // The attempts are spent, so this load will never be told what the country requires — and not
      // knowing is not permission, the same rule the route itself applies when it cannot place a
      // caller. Published as "must be asked": the gate stays shut, but the banner comes up and the
      // person can open it themselves. Without an answer here nothing else moves either — the flush
      // returns on the open question, a deferred queue-owner claim is never run, and a signed-in
      // browser that refused holds everything it collects in memory until the document goes away.
      publishAnalyticsConsentJurisdiction(true);
    }
  }
}

/** A later attempt is worth making only while both bounds allow one. */
function canRetryVisitorIdentity(): boolean {
  return visitorIdentityAttemptCount < maxVisitorIdentityAttemptCount
    && Date.now() - lastVisitorIdentityFailureAtMs >= visitorIdentityRetryDelayMs;
}

function startVisitorIdentityAttempt(): Promise<void> {
  // Cleared before the run, which can reach its own `catch` synchronously.
  hasFailedVisitorIdentity = false;
  visitorIdentityAttemptCount += 1;
  visitorIdentityTask = runVisitorIdentityResolution();
  return visitorIdentityTask;
}

/**
 * Asks the backend for the identity when this browser has none. Never gates rendering or an event: a
 * first visit can pay a GeoLite download inside the request, so the page renders and events queue
 * while it runs. Safe to call repeatedly: an answer — held, granted-but-unkept, or withheld — is
 * asked for once and then kept, and only a call that threw is asked again, under the two bounds
 * above. A call made while one is in flight joins it rather than starting a second.
 */
export function resolveAnalyticsVisitorIdentity(): Promise<void> {
  if (visitorIdentityTask === null) {
    return startVisitorIdentityAttempt();
  }

  if (hasFailedVisitorIdentity === false || canRetryVisitorIdentity() === false) {
    return visitorIdentityTask;
  }

  return startVisitorIdentityAttempt();
}

/**
 * Asks once more after the consent banner granted, which is the one thing that turns a deliberately
 * withheld identity into one this browser may hold. The grant's own `POST` has already minted the
 * cookie, so this normally settles by reading it rather than by asking for anything; a browser that
 * kept no cookie pays one more `GET` and then degrades to the per-tab id its grant allows.
 *
 * The attempt bounds are reset with it: they exist to stop a flaky network from polling the route,
 * and a person answering a banner is neither.
 */
export function resolveAnalyticsVisitorIdentityAfterConsentGrant(): Promise<void> {
  hasSettledVisitorIdentity = false;
  visitorIdentityAttemptCount = 0;
  lastVisitorIdentityFailureAtMs = 0;
  return startVisitorIdentityAttempt();
}

/**
 * Whether this load reached an answer about the identity: the browser holds the shared id, or the
 * server granted one it could not keep. Reporting with no credential waits for this, so the first
 * page view of a browser that can hold the cookie carries the shared id rather than the per-tab
 * fallback. It stays false when the call failed or the server withheld an identity, which holds
 * those events in the queue instead of spending a fabricated id on them. A failed call is asked
 * again later in the same load; a withheld one waits for the consent banner instead.
 */
export function hasResolvedAnalyticsVisitorIdentity(): boolean {
  return hasSettledVisitorIdentity;
}
