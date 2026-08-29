import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { restoreCurrentAnalyticsSurface, trackScreenViewed } from "./client";
import type { AnalyticsSurface } from "./events";
import { resolveAnalyticsSurface } from "./surfaces";

/**
 * Reports a screen whose identity is component state rather than a route, for the screens
 * `resolveAnalyticsSurface` cannot see: the steps of the catalog install flow, its sign-in gate, the
 * two session gates that replace the whole app root, and the friend invitation dialog.
 *
 * One `screen_viewed` per entry, which `trackScreenViewed` enforces for every caller rather than
 * this hook: React re-renders and re-runs effects for reasons that have nothing to do with the
 * person moving, and `analytics.product_events` is append-only, so a duplicate row is permanent.
 * Calling on every run is therefore safe and is what takes the stamp back after something else
 * moved it.
 *
 * `null` means no screen of this kind is on display. It reports nothing, and it hands the stamp back
 * to the route once this hook has reported something, because otherwise every later event — a
 * `sync_failed` from a background task included — would stay filed against a screen that is no
 * longer rendered. The ref is what makes that conditional: a hook whose surface has always been null
 * owns nothing and must not overwrite a surface some other screen set. The handover is silent, and
 * the visit stays open, so a surface that blinks through null and comes back — a panel waiting one
 * commit on data it already had — is one visit rather than two.
 *
 * The handover happens once and only while the stamp is still what this hook last set, which is what
 * keeps it from reaching past its own screen. React flushes a parent's passive effects after every
 * child's, so `AppShell`'s copy of this hook runs last of all: without the one-shot ref and the
 * `restoreCurrentAnalyticsSurface` guard, a gate it had reported once would keep re-running its null
 * branch on every later route change and overwrite whatever a screen-level caller had just set.
 */
export function useAnalyticsScreenView(surface: AnalyticsSurface | null): void {
  const location = useLocation();
  const routeSurface = resolveAnalyticsSurface(location.pathname);
  const reportedSurfaceRef = useRef<AnalyticsSurface | null>(null);

  useEffect(() => {
    if (surface === null) {
      const reportedSurface = reportedSurfaceRef.current;
      if (reportedSurface !== null) {
        reportedSurfaceRef.current = null;
        restoreCurrentAnalyticsSurface({ dismissed: reportedSurface, restored: routeSurface });
      }
      return;
    }

    reportedSurfaceRef.current = surface;
    trackScreenViewed(surface);
  }, [routeSurface, surface]);
}
