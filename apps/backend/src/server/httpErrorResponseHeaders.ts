import {
  authVerificationRetryAfterSeconds,
  authVerificationTemporarilyUnavailableCode,
} from "../auth";
import type { HttpError } from "../shared/errors";

export function getHttpErrorResponseHeaders(error: HttpError): ReadonlyArray<readonly [string, string]> {
  const retryAfterSeconds = error.details?.retryAfterSeconds;
  if (
    retryAfterSeconds !== undefined
    && Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds >= 1
    && retryAfterSeconds <= 60
  ) {
    return [["Retry-After", retryAfterSeconds.toString()]];
  }

  if (error.statusCode === 503 && error.code === "SERVICE_UNAVAILABLE") {
    return [["Retry-After", "1"]];
  }

  if (error.statusCode === 503 && error.code === authVerificationTemporarilyUnavailableCode) {
    return [["Retry-After", authVerificationRetryAfterSeconds.toString()]];
  }

  return [];
}
