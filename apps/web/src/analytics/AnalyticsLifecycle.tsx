import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { setCurrentAnalyticsSurface, startAnalytics, track } from "./client";
import { resolveAnalyticsSurface } from "./surfaces";

/**
 * Owns the analytics background task and the two route-driven events. Rendered inside the router so
 * every route, authenticated or not, is covered.
 */
export function AnalyticsLifecycle(): null {
  const location = useLocation();
  const hasTrackedColdOpenRef = useRef<boolean>(false);
  const hasLeftForegroundRef = useRef<boolean>(false);

  useEffect(() => startAnalytics(), []);

  useEffect(() => {
    const surface = resolveAnalyticsSurface(location.pathname);
    setCurrentAnalyticsSurface(surface);

    if (hasTrackedColdOpenRef.current === false) {
      hasTrackedColdOpenRef.current = true;
      track({ name: "app_opened", launchType: "cold" });
    }

    // A route with no shared surface emits nothing: `screen` is a closed cross-client enum and a
    // route path is never sent in its place.
    if (surface !== null) {
      track({ name: "screen_viewed", screen: surface });
    }
  }, [location.pathname]);

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
