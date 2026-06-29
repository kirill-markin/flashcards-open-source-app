import {
  authVerificationRetryAfterSeconds,
  authVerificationTemporarilyUnavailableCode,
} from "../auth";
import type { HttpError } from "../shared/errors";

export function getHttpErrorResponseHeaders(error: HttpError): ReadonlyArray<readonly [string, string]> {
  if (error.statusCode === 503 && error.code === "SERVICE_UNAVAILABLE") {
    return [["Retry-After", "1"]];
  }

  if (error.statusCode === 503 && error.code === authVerificationTemporarilyUnavailableCode) {
    return [["Retry-After", authVerificationRetryAfterSeconds.toString()]];
  }

  return [];
}
