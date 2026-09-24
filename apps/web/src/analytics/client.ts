import { createAnalyticsDeliveryRuntime } from "./deliveryRuntime";
import {
  analyticsCatalogSlugPattern,
  analyticsUuidPattern,
  type AnalyticsEvent,
  type AnalyticsSurface,
  type IdentityFreeAnalyticsEventName,
} from "./events";

let currentSurface: AnalyticsSurface | null = null;
// The surface the open `screen_viewed` visit named, or null while no visit is open. Separate from
// `currentSurface`, which is a stamp rather than a visit: every caller writes the stamp, including
// the ones that must not report a view.
let lastViewedSurface: AnalyticsSurface | null = null;

const deliveryRuntime = createAnalyticsDeliveryRuntime(readCurrentAnalyticsSurface);

export function isAnalyticsEnabledForCurrentRuntime(): boolean {
  return deliveryRuntime.isAnalyticsEnabledForCurrentRuntime();
}

export function registerAnalyticsSessionOwnerPublisher(): () => void {
  return deliveryRuntime.registerAnalyticsSessionOwnerPublisher();
}

export function setAnalyticsConfirmedOwner(userId: string): void {
  deliveryRuntime.setAnalyticsConfirmedOwner(userId);
}

export function readAnalyticsSessionOwnerId(): string | null {
  return deliveryRuntime.readAnalyticsSessionOwnerId();
}

export function setCurrentAnalyticsSurface(surface: AnalyticsSurface | null): void {
  currentSurface = surface;
}

/**
 * The stamp every tracked event carries. The chat composer reads it once per attachment ingest,
 * because the catalog requires a surface on `media_attached` and the composer is the sidebar of
 * whatever route is open rather than a screen of its own. That one read gates both halves of the
 * ingest: a null surface names nothing the server accepts on `media_attached`, so the ingest reports
 * neither the attachment nor the `media_upload_failed` that would stand in its place
 * (`../chat/attachments/useChatAttachments.ts`).
 *
 * `dictation_started` is the other event this app reports from the composer that the catalog
 * requires a surface on, and it deliberately does not read this stamp: the composer is the only
 * place this client dictates from, so it asserts `ai` outright rather than dropping the start on a
 * route with no value in the enum.
 */
export function readCurrentAnalyticsSurface(): AnalyticsSurface | null {
  return currentSurface;
}

/**
 * Reports one entry into a screen: stamps it as the current surface, so every event tracked from it
 * carries it, and emits the `screen_viewed` that records the entry.
 *
 * This is where the web side of the `screen_viewed` contract stated on `AnalyticsEvent` is
 * enforced: a repeat of the surface already being viewed stamps and stays silent, so two routes
 * that collapse into one surface — the settings hub and every settings leaf — are one visit here as
 * they are on iOS and Android. The stamp still runs on the silent path, because a caller may be
 * taking the surface back from a screen that covered it.
 */
export function trackScreenViewed(surface: AnalyticsSurface): void {
  setCurrentAnalyticsSurface(surface);
  if (lastViewedSurface === surface) {
    return;
  }

  lastViewedSurface = surface;
  track({ name: "screen_viewed", screen: surface });
}

/**
 * Reports the entry back into the screen a presented one covered as that presented screen goes away
 * — but only while it is still the surface being viewed.
 *
 * The port of iOS `Analytics.trackScreenViewedOnDismiss` and its `restoreViewing(from:to:)` guard,
 * for the same reason: a dismissal handler also runs when the user left for somewhere else entirely,
 * and nothing orders it against that destination reporting itself. An unconditional restore would
 * then name a screen the user is not on, and `trackScreenViewed`'s dedupe would swallow the genuine
 * next view of it — a false row and a hidden true one from one line, permanently, on an append-only
 * table. Restoring only what the dismissed screen still holds makes the emission depend on observed
 * state rather than on ordering.
 */
export function trackScreenViewedOnDismiss(
  params: Readonly<{ dismissed: AnalyticsSurface; restored: AnalyticsSurface }>,
): void {
  if (lastViewedSurface !== params.dismissed) {
    return;
  }

  trackScreenViewed(params.restored);
}

/**
 * Hands the stamp back to `restored` without reporting anything, for a screen that reported itself
 * and is now gone. Carries the same guard as `trackScreenViewedOnDismiss` and for the same reason:
 * something else may already own the surface, and a caller whose effect flushes late — a parent's
 * does, after every child's — would otherwise file later events against a screen nobody is on.
 */
export function restoreCurrentAnalyticsSurface(
  params: Readonly<{ dismissed: AnalyticsSurface; restored: AnalyticsSurface | null }>,
): void {
  if (currentSurface !== params.dismissed) {
    return;
  }

  currentSurface = params.restored;
}

/**
 * Ends the open visit without reporting anything, for a destination that has no value in the shared
 * enum and so cannot be reported at all. Returning to the surface that was open before it is a
 * second visit rather than a repeat, which is the reading Android's route tracking already gives
 * `review -> unmapped -> review`.
 */
export function endAnalyticsScreenVisit(): void {
  lastViewedSurface = null;
}

/**
 * Emits one event into the local queue. Synchronous, returns void, and cannot throw: a user action
 * is never blocked, delayed, or failed by anything in this module.
 */
export function track(event: AnalyticsEvent): void {
  try {
    deliveryRuntime.enqueue(event, currentSurface);
  } catch {
    // A failure inside analytics is swallowed on purpose; the queue reporting path covers the rest.
  }
}

/** The general collector is the sole owner of install intent; it carries this browser's identity. */
export function trackCatalogDeckInstallStarted(
  packageSlug: string,
  packageVersionId: string | null,
): void {
  if (
    analyticsCatalogSlugPattern.test(packageSlug) === false
    || (packageVersionId !== null && analyticsUuidPattern.test(packageVersionId) === false)
  ) {
    return;
  }

  track({ name: "catalog_deck_install_started", packageSlug, packageVersionId });
}

/**
 * Records the person's consent answer for this browser and releases, or withholds, everything that
 * depends on it. The caller reports the decision itself: these two only carry it out, so a decision
 * arriving from an account is not counted as one somebody just made.
 *
 * The grant resolves `false` when the server recorded none, which leaves the banner up.
 */
export function grantAnalyticsConsent(): Promise<boolean> {
  return deliveryRuntime.applyAnalyticsConsentGrant();
}

export function declineAnalyticsConsent(): Promise<void> {
  return deliveryRuntime.applyAnalyticsConsentDecline();
}

/**
 * Records the person's answer to the product-analytics setting for this browser and carries it out.
 * The caller writes the same answer to the account where there is a credential; this is the half
 * that decides what this load collects.
 */
export function setProductAnalyticsCollection(isCollectionEnabled: boolean): void {
  deliveryRuntime.applyProductAnalyticsCollection(isCollectionEnabled);
}

/**
 * Reports one of the two consent facts the catalog allows no identity at all. It never enters the
 * queue, so unlike `track` it is sent rather than collected.
 */
export function reportIdentityFreeAnalyticsEvent(eventName: IdentityFreeAnalyticsEventName): void {
  try {
    deliveryRuntime.reportIdentityFreeEvent(eventName);
  } catch {
    // A failure inside analytics is swallowed on purpose, exactly as in `track`.
  }
}

export function flush(): void {
  deliveryRuntime.flush();
}

/**
 * The bounded drain a control runs before it destroys the credential this browser reports under:
 * the sign-out link before it leaves for the auth origin, and the account deletion before it
 * dispatches the request that invalidates the session. `reset()` is too late for it — see
 * `flushBeforeIdentityTeardown` in `deliveryRuntime.ts`.
 */
export function flushBeforeIdentityTeardown(): Promise<void> {
  return deliveryRuntime.flushBeforeIdentityTeardown();
}

export function reset(): void {
  // The open visit belongs to the person leaving, and this runs inside a live app rather than at a
  // page load, so the pointer is set. Carrying it over would make the dedupe swallow the next
  // person's first `screen_viewed` whenever they land on the same surface — which is the common
  // case, the route rarely changes across an account switch — leaving their first session with no
  // entry into the screen they are on, permanently.
  endAnalyticsScreenVisit();
  deliveryRuntime.reset();
}

export function setEnabled(enabled: boolean): void {
  deliveryRuntime.setEnabled(enabled);
}

export function startAnalytics(): () => void {
  return deliveryRuntime.startAnalytics();
}
