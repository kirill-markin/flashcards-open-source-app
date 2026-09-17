import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";
import type { CountryRetentionResult } from "../../productAnalytics/countryRetention";

initializeBackendSentry("country-retention");

const countryRetentionHandler: Handler<Record<string, never>, CountryRetentionResult> = async (_event, context) => {
  const scope = createBackendObservationScope(
    "country-retention", context.awsRequestId, null, null, null, null, null, null, null, null, null,
  );
  try {
    const { retainRecentCountryObservations } = await import("../../productAnalytics/countryRetention");
    const result = await retainRecentCountryObservations(
      new Date(), Date.now() + context.getRemainingTimeInMillis() - 10_000,
    );
    addBackendBreadcrumb({ action: "country_retention_completed", scope, details: result });
    if (!result.finished) {
      throw new Error(`Country retention still has expired periods after deleting ${result.deleted} rows. Review job capacity or database contention.`);
    }
    return result;
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "country_retention_failed", scope, error: normalizedError, details: { message: normalizedError.message },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(countryRetentionHandler);
