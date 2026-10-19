import type { Handler } from "aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
  type BackendObservationScope,
} from "../../observability/sentry";
import { withTransientDatabaseRetry } from "../../database/transient";

initializeBackendSentry("probable-android-burst-refresh");

// CONCURRENTLY keeps every report reading the previous classification while the refresh runs.
const refreshProbableAndroidBurstActorsSql =
  "REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.probable_android_burst_actors";
const refreshProbableScraperFleetVisitorsSql =
  "REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.probable_scraper_fleet_visitors";

type ProbableAndroidBurstRefreshResponse = Readonly<{ ok: true }>;
type RefreshFailedAction = "probable_android_burst_refresh_failed" | "probable_scraper_fleet_refresh_failed";

async function refreshMaterializedView(
  sql: string,
  failedAction: RefreshFailedAction,
  scope: BackendObservationScope,
): Promise<void> {
  try {
    const { unsafeQuery } = await import("../../database/unsafe");
    await withTransientDatabaseRetry(
      () => unsafeQuery(sql, []),
      () => scope,
    );
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: failedAction,
      scope,
      error: normalizedError,
      details: { message: normalizedError.message },
    });
    throw error;
  }
}

const probableAndroidBurstRefreshHandler: Handler<
  Record<string, never>,
  ProbableAndroidBurstRefreshResponse
> = async (_event, context) => {
  const scope = createBackendObservationScope(
    "probable-android-burst-refresh", context.awsRequestId, null, null, null, null, null, null, null, null, null,
  );
  await refreshMaterializedView(refreshProbableAndroidBurstActorsSql, "probable_android_burst_refresh_failed", scope);
  await refreshMaterializedView(refreshProbableScraperFleetVisitorsSql, "probable_scraper_fleet_refresh_failed", scope);
  return { ok: true };
};

export const handler = wrapBackendHandler(probableAndroidBurstRefreshHandler);
