import { HttpError } from "../errors";
import {
  addBackendBreadcrumb,
  captureBackendException,
} from "./sentryCapture";
import { hasCapturedBackendException } from "./sentryErrorNormalization";
import type {
  BackendBreadcrumbEvent,
  BackendExceptionEvent,
} from "./sentryEvents";

const reportedBackendExceptionWrappers = new WeakSet<Error>();

function isExpectedHttpError(error: unknown): boolean {
  return error instanceof HttpError && error.statusCode < 500;
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
