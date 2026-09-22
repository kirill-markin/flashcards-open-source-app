import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";

initializeBackendSentry("daily-visitor-hash-salt-expiry");

type DailyVisitorHashSaltExpiryResult = Readonly<{ deleted: number }>;

// Deletes each daily visitor hash salt once its UTC day ends, without waiting for traffic; see
// db/migrations/0144_anonymous_client_daily_visitor_hash.sql.
const dailyVisitorHashSaltExpiryHandler: Handler<Record<string, never>, DailyVisitorHashSaltExpiryResult> = async (
  _event,
  context,
) => {
  const scope = createBackendObservationScope(
    "daily-visitor-hash-salt-expiry", context.awsRequestId, null, null, null, null, null, null, null, null, null,
  );
  try {
    const { deleteEndedDailyVisitorHashSalts } = await import("../../productAnalytics/writer");
    const result = { deleted: await deleteEndedDailyVisitorHashSalts() };
    addBackendBreadcrumb({ action: "daily_visitor_hash_salt_expiry_completed", scope, details: result });
    return result;
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "daily_visitor_hash_salt_expiry_failed",
      scope,
      error: normalizedError,
      details: { message: normalizedError.message },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(dailyVisitorHashSaltExpiryHandler);
