import type { Handler } from "aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";
import { withTransientDatabaseRetry } from "../../database/transient";

initializeBackendSentry("probable-android-burst-refresh");

// CONCURRENTLY keeps every report reading the previous classification while the refresh runs.
const refreshProbableAndroidBurstActorsSql =
  "REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.probable_android_burst_actors";

type ProbableAndroidBurstRefreshResponse = Readonly<{ ok: true }>;

const probableAndroidBurstRefreshHandler: Handler<
  Record<string, never>,
  ProbableAndroidBurstRefreshResponse
> = async (_event, context) => {
  const scope = createBackendObservationScope(
    "probable-android-burst-refresh", context.awsRequestId, null, null, null, null, null, null, null, null, null,
  );
  try {
    const { unsafeQuery } = await import("../../database/unsafe");
    await withTransientDatabaseRetry(
      () => unsafeQuery(refreshProbableAndroidBurstActorsSql, []),
      () => scope,
    );
    return { ok: true };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "probable_android_burst_refresh_failed",
      scope,
      error: normalizedError,
      details: { message: normalizedError.message },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(probableAndroidBurstRefreshHandler);
