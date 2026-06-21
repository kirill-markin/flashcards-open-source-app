import {
  addWebBreadcrumb,
  type StaleBundleReloadSkipReason,
  type WebObservationScope,
} from "./observability/webObservability";

const PRELOAD_ERROR_RELOADED_AT_STORAGE_KEY = "flashcards-preload-error-reloaded-at";
const PRELOAD_ERROR_REPORT_PENDING_STORAGE_KEY = "flashcards-preload-error-report-pending";
const PRELOAD_ERROR_RELOAD_MIN_INTERVAL_MS = 60_000;
const ASSET_PATH_PATTERN = /(?:https?:\/\/[^\s"'<>]+|(?:\/|\.\.?\/)assets\/[^\s"'<>]+)/u;

function getSessionStorage(): Storage | null {
  try {
    const storageValue = window.sessionStorage;
    if (
      typeof storageValue?.getItem !== "function"
      || typeof storageValue.setItem !== "function"
      || typeof storageValue.removeItem !== "function"
    ) {
      return null;
    }

    return storageValue;
  } catch {
    // Browsers with blocked site data throw on the sessionStorage getter
    // itself; treat that as storage being unavailable.
    return null;
  }
}

function getCurrentRoute(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildReloadObservationScope(): WebObservationScope {
  return {
    app: "web",
    feature: "app",
    userId: null,
    workspaceId: null,
    installationId: null,
    route: getCurrentRoute(),
    requestId: null,
    statusCode: null,
    code: null,
  };
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/u, "");
}

function extractPreloadAssetPath(error: Error): string | null {
  const match = error.message.match(ASSET_PATH_PATTERN);
  if (match === null) {
    return null;
  }

  try {
    const url = new URL(stripTrailingPunctuation(match[0]), window.location.origin);
    return url.pathname.startsWith("/assets/") ? url.pathname : null;
  } catch {
    return null;
  }
}

function reportPreloadError(
  assetPath: string | null,
  reloadScheduled: boolean,
  reloadSkipReason: StaleBundleReloadSkipReason | null,
): void {
  addWebBreadcrumb({
    action: "stale_bundle_reload",
    scope: buildReloadObservationScope(),
    details: {
      eventName: "stale_bundle_preload_error",
      assetPath,
      reloadScheduled,
      reloadSkipReason,
    },
  });
}

function reportRecoveredReload(sessionStorage: Storage): void {
  if (sessionStorage.getItem(PRELOAD_ERROR_REPORT_PENDING_STORAGE_KEY) !== "1") {
    return;
  }

  sessionStorage.removeItem(PRELOAD_ERROR_REPORT_PENDING_STORAGE_KEY);
  const lastReloadAtMs = Number(sessionStorage.getItem(PRELOAD_ERROR_RELOADED_AT_STORAGE_KEY) ?? "0");
  const isReloadTimestampValid = Number.isFinite(lastReloadAtMs) && lastReloadAtMs > 0;
  addWebBreadcrumb({
    action: "stale_bundle_reload",
    scope: buildReloadObservationScope(),
    details: {
      eventName: "stale_bundle_reload_recovered",
      reloadAgeMs: isReloadTimestampValid ? Math.max(0, Date.now() - lastReloadAtMs) : null,
    },
  });
}

/**
 * Reloads the page once when a lazy route chunk fails to load.
 *
 * A browser-cached `index.html` from a previous deploy can reference hashed
 * assets that no longer resolve; a reload fetches the current entry and heals
 * the session. The reload runs at most once per interval per tab so a real
 * outage still surfaces as an error instead of a reload loop, and the load
 * that follows a reload emits a recovery breadcrumb so this self-healing
 * stays observable.
 */
export function installStaleBundleReloadGuard(): void {
  const startupSessionStorage = getSessionStorage();
  if (startupSessionStorage !== null) {
    reportRecoveredReload(startupSessionStorage);
  }

  window.addEventListener("vite:preloadError", (event) => {
    const assetPath = extractPreloadAssetPath(event.payload);
    const sessionStorage = getSessionStorage();
    if (sessionStorage === null) {
      reportPreloadError(assetPath, false, "storage_unavailable");
      return;
    }

    const lastReloadAtMs = Number(sessionStorage.getItem(PRELOAD_ERROR_RELOADED_AT_STORAGE_KEY) ?? "0");
    if (Number.isFinite(lastReloadAtMs) && Date.now() - lastReloadAtMs < PRELOAD_ERROR_RELOAD_MIN_INTERVAL_MS) {
      reportPreloadError(assetPath, false, "rate_limited");
      return;
    }

    try {
      sessionStorage.setItem(PRELOAD_ERROR_RELOADED_AT_STORAGE_KEY, String(Date.now()));
      sessionStorage.setItem(PRELOAD_ERROR_REPORT_PENDING_STORAGE_KEY, "1");
    } catch {
      // Without a persisted rate-limit marker a reload could loop, so let the
      // preload error surface instead of healing.
      reportPreloadError(assetPath, false, "storage_write_failed");
      return;
    }

    reportPreloadError(assetPath, true, null);
    event.preventDefault();
    window.location.reload();
  });
}
