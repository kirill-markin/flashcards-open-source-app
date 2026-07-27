import {
  hasCapturedBackendException,
  markCapturedBackendException,
  normalizeCaughtError,
} from "./sentry/errorNormalization";

const reportedBackendExceptionWrappers = new WeakSet<Error>();

export function markBackendExceptionWrapperAsReported(error: Error): Error {
  reportedBackendExceptionWrappers.add(error);
  return error;
}

export function hasReportedBackendExceptionWrapper(error: Error): boolean {
  return reportedBackendExceptionWrappers.has(error);
}

export function hasReportedBackendException(error: Error): boolean {
  return hasCapturedBackendException(error)
    || hasReportedBackendExceptionWrapper(error);
}

export {
  markCapturedBackendException,
  normalizeCaughtError,
};
