import { authVerificationTemporarilyUnavailableCode } from "../auth";
import { HttpError } from "../errors";
import {
  addBackendBreadcrumb,
  captureBackendException,
} from "./sentry/capture";
import { hasCapturedBackendException } from "./sentry/errorNormalization";
import type {
  BackendBreadcrumbEvent,
  BackendExceptionEvent,
} from "./sentry/events";

const reportedBackendExceptionWrappers = new WeakSet<Error>();

function isExpectedHttpError(error: unknown): boolean {
  if (error instanceof HttpError === false) {
    return false;
  }

  return error.statusCode < 500 || error.code === authVerificationTemporarilyUnavailableCode;
}

export function markBackendExceptionWrapperAsReported(error: Error): Error {
  reportedBackendExceptionWrappers.add(error);
  return error;
}

export function hasReportedBackendException(error: Error): boolean {
  return hasCapturedBackendException(error) || reportedBackendExceptionWrappers.has(error);
}

export function reportBackendExceptionOrBreadcrumb(
  error: unknown,
  exceptionEvent: BackendExceptionEvent,
  breadcrumbEvent: BackendBreadcrumbEvent,
): void {
  if (isExpectedHttpError(error)) {
    addBackendBreadcrumb(breadcrumbEvent);
    return;
  }

  if (hasReportedBackendException(exceptionEvent.error)) {
    addBackendBreadcrumb(breadcrumbEvent);
    return;
  }

  captureBackendException(exceptionEvent);
}
