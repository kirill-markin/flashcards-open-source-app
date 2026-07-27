import {
  configureBackendRuntimeObservability,
  resetBackendRuntimeObservability,
} from "../runtime";
import {
  addBackendBreadcrumb as addBackendBreadcrumbImpl,
  captureBackendException as captureBackendExceptionImpl,
  captureBackendWarning as captureBackendWarningImpl,
} from "./capture";
import {
  initializeBackendSentry as initializeBackendSentryImpl,
  resetBackendSentryForTests as resetBackendSentryForTestsImpl,
} from "./config";
import type { BackendService } from "./events";

export { getBackendErrorLogDetails } from "../cloudWatch";
export {
  addBackendBreadcrumb,
  addBackendSentryBreadcrumb,
  captureBackendException,
  captureBackendWarning,
  captureBackendWarningWithFingerprint,
} from "./capture";
export {
  getBackendSentryConfig,
  initializeBackendSentryWithDeps,
  isBackendSentryInitializedForOpenTelemetry,
} from "./config";
export {
  hasCapturedBackendException,
  normalizeCaughtError,
} from "./errorNormalization";
export * from "./events";
export {
  createBackendObservationScope,
  createBackendRuntimeObservationScope,
  runWithBackendSentryIsolationScope,
} from "./scope";
export {
  continueBackendTrace,
  flushBackendSentry,
  getBackendTraceCarrier,
  startBackendSpan,
  wrapBackendHandler,
  wrapBackendStreamHandler,
} from "./tracing";

export function initializeBackendSentry(service: BackendService): void {
  initializeBackendSentryImpl(service);
  configureBackendRuntimeObservability(service, {
    addBreadcrumb: addBackendBreadcrumbImpl,
    captureWarning: captureBackendWarningImpl,
    captureException: captureBackendExceptionImpl,
  });
}

export function resetBackendSentryForTests(): void {
  resetBackendSentryForTestsImpl();
  resetBackendRuntimeObservability();
}
