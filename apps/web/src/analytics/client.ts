import type { AnalyticsRequestCredential } from "../api";
import { createAnalyticsDeliveryRuntime } from "./deliveryRuntime";
import {
  analyticsCatalogSlugPattern,
  analyticsUuidPattern,
  type AnalyticsEvent,
  type AnalyticsSurface,
} from "./events";

let currentSurface: AnalyticsSurface | null = null;
// The surface the open `screen_viewed` visit named, or null while no visit is open. Separate from
// `currentSurface`, which is a stamp rather than a visit: every caller writes the stamp, including
// the ones that must not report a view.
let lastViewedSurface: AnalyticsSurface | null = null;

const deliveryRuntime = createAnalyticsDeliveryRuntime((): AnalyticsSurface | null => currentSurface);

export function isAnalyticsEnabledForCurrentRuntime(): boolean {
  return deliveryRuntime.isAnalyticsEnabledForCurrentRuntime();
}

export function registerAnalyticsGuestCredentialRefusalHandler(handler: () => void): () => void {
  return deliveryRuntime.registerAnalyticsGuestCredentialRefusalHandler(handler);
}

export function setAnalyticsGuestOwnerId(nextGuestOwnerId: string | null): void {
  deliveryRuntime.setAnalyticsGuestOwnerId(nextGuestOwnerId);
}

export function setAnalyticsConfirmedOwner(
  userId: string,
  credential: AnalyticsRequestCredential,
): void {
  deliveryRuntime.setAnalyticsConfirmedOwner(userId, credential);
}

export function readAnalyticsSessionOwnerId(): string | null {
  return deliveryRuntime.readAnalyticsSessionOwnerId();
}

export function setCurrentAnalyticsSurface(surface: AnalyticsSurface | null): void {
  currentSurface = surface;
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

/**
 * The existing general collector remains the sole owner of install intent. Carrying the journey
 * fields here keeps that event joinable without adding a duplicate through the public collector.
 */
export function trackCatalogDeckInstallStarted(
  packageSlug: string,
  installJourneyId: string | null,
  packageVersionId: string | null,
): void {
  if (
    analyticsCatalogSlugPattern.test(packageSlug) === false
    || (installJourneyId !== null && analyticsUuidPattern.test(installJourneyId) === false)
    || (packageVersionId !== null && analyticsUuidPattern.test(packageVersionId) === false)
  ) {
    return;
  }

  track({ name: "catalog_deck_install_started", packageSlug, installJourneyId, packageVersionId });
}

export function flush(): void {
  deliveryRuntime.flush();
}

export function reset(): void {
  // The open visit belongs to the person leaving, and this runs inside a live app rather than at a
  // page load, so the pointer is set. Carrying it over would make the dedupe swallow the next
  // person's first `screen_viewed` whenever they land on the same surface — which is the common
  // case, the route rarely changes across an account switch — leaving their rotated `anonymous_id`
  // with no entry into the screen they are on, permanently.
  endAnalyticsScreenVisit();
  deliveryRuntime.reset();
}

export function setEnabled(enabled: boolean): void {
  deliveryRuntime.setEnabled(enabled);
}

export function startAnalytics(): () => void {
  return deliveryRuntime.startAnalytics();
}
