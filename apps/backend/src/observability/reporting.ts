import { AuthError, authVerificationTemporarilyUnavailableCode } from "../auth";
import { HttpError } from "../shared/errors";
import {
  addBackendRuntimeBreadcrumb,
  captureBackendRuntimeException,
} from "./runtime";
import type {
  BackendBreadcrumbEvent,
  BackendExceptionEvent,
} from "./sentry/events";
import {
  hasReportedBackendException,
} from "./reportedErrors";

function isExpectedRequestError(error: unknown): boolean {
  if (error instanceof AuthError) {
    return true;
  }

  return error instanceof HttpError
    && (error.statusCode < 500 || error.code === authVerificationTemporarilyUnavailableCode);
}

export {
  hasReportedBackendException,
  markBackendExceptionWrapperAsReported,
} from "./reportedErrors";

export function reportBackendExceptionOrBreadcrumb(
  error: unknown,
  exceptionEvent: BackendExceptionEvent,
  breadcrumbEvent: BackendBreadcrumbEvent,
): void {
  if (isExpectedRequestError(error)) {
    addBackendRuntimeBreadcrumb(breadcrumbEvent);
    return;
  }

  if (hasReportedBackendException(exceptionEvent.error)) {
    addBackendRuntimeBreadcrumb(breadcrumbEvent);
    return;
  }

  captureBackendRuntimeException(exceptionEvent);
}
