import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import {
  endAnalyticsScreenVisit,
  setCurrentAnalyticsSurface,
  startAnalytics,
  track,
  trackScreenViewed,
} from "./client";
import { readAnalyticsRootGate, subscribeToAnalyticsRootGate } from "./rootGate";
import { resolveAnalyticsSurface } from "./surfaces";

/**
 * Owns the analytics background task and the two route-driven events. Rendered inside the router so
 * every route, authenticated or not, is covered.
 */
export function AnalyticsLifecycle(): null {
  const location = useLocation();
  const rootGate = useSyncExternalStore(subscribeToAnalyticsRootGate, readAnalyticsRootGate);
  const hasTrackedColdOpenRef = useRef<boolean>(false);
  const hasLeftForegroundRef = useRef<boolean>(false);

  useEffect(() => startAnalytics(), []);

  // The stamp every event tracked from this document carries, set on the first commit as it always
  // was: the cold open below is filed against the route this document was opened on, and a gate that
  // replaced that route corrects the stamp in the effect after this one.
  useEffect(() => {
    setCurrentAnalyticsSurface(resolveAnalyticsSurface(location.pathname));

    if (hasTrackedColdOpenRef.current === false) {
      hasTrackedColdOpenRef.current = true;
      track({ name: "app_opened", launchType: "cold" });
    }
  }, [location.pathname]);

  // What the person is actually looking at, which is the route's own screen only while no gate
  // replaced it. `App.tsx` publishes that (`resolveRootGateReport`), rather than this reading it off
  // its own position in the tree, and `undecided` is the window before any gate has answered: a
  // report sent there names a screen that may never render, permanently, because
  // `analytics.product_events` is append-only and has no repair path.
  //
  // `gated_keeping_route_stamp` reports no view for that same reason, but it does put the route's
  // stamp back, which is where the catalog keeps a route's own loading and error states, so the
  // events tracked under such a gate carry the surface they always did.
  useEffect(() => {
    if (rootGate.status === "undecided") {
      return;
    }

    // Re-asserted rather than merely left alone: a gate before this one may have taken the surface
    // down on this same address — the workspace-unavailable panel stands at `{ status: "gated",
    // surface: null }` and a session revalidation under it drops the shell back to its loading
    // panel — and the effect above re-stamps only when `location.pathname` changes, so the take-down
    // would otherwise outlive the gate that made it and file every later event with no surface.
    // Strictly above the reporting path: no visit is opened here, the route's screen having still
    // not rendered. `undecided` deliberately does not get this, because the address itself may yet
    // be rewritten there by `LegacyFlatPathRedirect` or the unrecognised-workspace `<Navigate>`.
    if (rootGate.status === "gated_keeping_route_stamp") {
      setCurrentAnalyticsSurface(resolveAnalyticsSurface(location.pathname));
      return;
    }

    const surface = rootGate.status === "gated"
      ? rootGate.surface
      : resolveAnalyticsSurface(location.pathname);
    setCurrentAnalyticsSurface(surface);

    // A screen with no shared surface emits nothing: `screen` is a closed cross-client enum and a
    // route path is never sent in its place. The stamp still ran for it, so an event tracked from
    // such a screen carries no stale surface from the one before it, and ending the visit keeps a
    // return to the previous surface reporting as a second view rather than being swallowed as a
    // repeat.
    if (surface === null) {
      endAnalyticsScreenVisit();
      return;
    }

    trackScreenViewed(surface);
    // A gate resolving late re-runs this in a store-change render of this component alone, which
    // React flushes after every screen-level `useAnalyticsScreenView` effect of the commit before
    // it — so a screen-level caller that can mount under `AppShell` while the gate is still
    // undecided would have its stamp overwritten here. The overwrite is unconditional — unlike the
    // ref-guarded handover in `useAnalyticsScreenView`, this effect does not ask who set the stamp
    // before taking it, and since the dependency array now carries `rootGate` it can take it on a
    // gate change alone rather than only when the route moves. None of today's callers are exposed:
    // the two catalog install ones sit on a public top-level route, where this store never changes,
    // and the friend invitation dialog opens only on a user action, long after the gate has
    // answered. The ordering is load-bearing for any future caller mounted under `AppShell`, and
    // nothing in the type system enforces it.
  }, [location.pathname, rootGate]);

  // `warm` is a return to the foreground after actually having left it, which is what `app_opened`
  // has to mean on all three clients for the counts to be comparable. `visible` on its own is not
  // that: it also arrives for the first paint of a page that loaded hidden, so a real departure has
  // to be observed first. There is deliberately no minimum-away threshold — tab switching really is
  // more frequent than app switching, and `warm` is compared within a platform rather than across.
  useEffect(() => {
    function reportForegroundReturn(): void {
      if (hasLeftForegroundRef.current === false) {
        return;
      }

      hasLeftForegroundRef.current = false;
      track({ name: "app_opened", launchType: "warm" });
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        hasLeftForegroundRef.current = true;
        return;
      }

      reportForegroundReturn();
    }

    function handlePageHide(): void {
      hasLeftForegroundRef.current = true;
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Leaving for and returning from the back-forward cache is a real departure and return, and not
    // every browser pairs it with a `hidden`/`visible` transition. The shared flag is what keeps the
    // two signal pairs from reporting the same return twice, and it leaves the `pageshow` of the
    // initial load — which follows no departure — reporting nothing.
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", reportForegroundReturn);
    return (): void => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", reportForegroundReturn);
    };
  }, []);

  return null;
}
