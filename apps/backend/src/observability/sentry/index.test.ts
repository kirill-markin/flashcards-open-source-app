import assert from "node:assert/strict";
import test from "node:test";
import {
  addBackendBreadcrumb,
  addBackendSentryBreadcrumb,
  type BackendBreadcrumbEvent,
  type BackendExceptionEvent,
  type BackendObservationScope,
  type BackendService,
  type BackendTraceCarrier,
  type BackendWarningEvent,
  captureBackendException,
  captureBackendWarning,
  continueBackendTrace,
  createBackendObservationScope,
  createBackendRuntimeObservationScope,
  flushBackendSentry,
  getBackendErrorLogDetails,
  getBackendSentryConfig,
  getBackendTraceCarrier,
  hasCapturedBackendException,
  initializeBackendSentry,
  initializeBackendSentryWithDeps,
  isBackendSentryInitializedForOpenTelemetry,
  normalizeCaughtError,
  resetBackendSentryForTests,
  runWithBackendSentryIsolationScope,
  startBackendSpan,
  wrapBackendHandler,
  wrapBackendStreamHandler,
} from ".";

type FacadeTypeSample = Readonly<{
  service: BackendService;
  scope: BackendObservationScope;
  trace: BackendTraceCarrier;
  breadcrumb: BackendBreadcrumbEvent;
  warning: BackendWarningEvent;
  exception: BackendExceptionEvent;
}>;

function createFacadeTypeSample(scope: BackendObservationScope, error: Error): FacadeTypeSample {
  return {
    service: "backend-api",
    scope,
    trace: {
      sentryTrace: null,
      baggage: null,
    },
    breadcrumb: {
      action: "request_error",
      scope,
      details: {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "failed",
        validationIssues: [],
        errorClass: "Error",
        errorMessage: "failed",
        errorStack: null,
        sourceFile: null,
        sourceLine: null,
        sourceColumn: null,
        sqlState: null,
      },
    },
    warning: {
      action: "database_pool_error",
      scope,
      details: {
        poolName: "main",
        sqlState: null,
        errorCode: null,
        errorClass: "Error",
        errorMessage: "database failed",
      },
    },
    exception: {
      action: "request_failed",
      error,
      scope,
      details: {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "failed",
        validationIssues: [],
      },
    },
  };
}

test("backend Sentry facade exports the public observability API", () => {
  const runtimeExports: ReadonlyArray<Readonly<{
    name: string;
    value: unknown;
  }>> = [
    { name: "addBackendBreadcrumb", value: addBackendBreadcrumb },
    { name: "addBackendSentryBreadcrumb", value: addBackendSentryBreadcrumb },
    { name: "captureBackendException", value: captureBackendException },
    { name: "captureBackendWarning", value: captureBackendWarning },
    { name: "continueBackendTrace", value: continueBackendTrace },
    { name: "createBackendObservationScope", value: createBackendObservationScope },
    { name: "createBackendRuntimeObservationScope", value: createBackendRuntimeObservationScope },
    { name: "flushBackendSentry", value: flushBackendSentry },
    { name: "getBackendErrorLogDetails", value: getBackendErrorLogDetails },
    { name: "getBackendSentryConfig", value: getBackendSentryConfig },
    { name: "getBackendTraceCarrier", value: getBackendTraceCarrier },
    { name: "hasCapturedBackendException", value: hasCapturedBackendException },
    { name: "initializeBackendSentry", value: initializeBackendSentry },
    { name: "initializeBackendSentryWithDeps", value: initializeBackendSentryWithDeps },
    { name: "isBackendSentryInitializedForOpenTelemetry", value: isBackendSentryInitializedForOpenTelemetry },
    { name: "normalizeCaughtError", value: normalizeCaughtError },
    { name: "resetBackendSentryForTests", value: resetBackendSentryForTests },
    { name: "runWithBackendSentryIsolationScope", value: runWithBackendSentryIsolationScope },
    { name: "startBackendSpan", value: startBackendSpan },
    { name: "wrapBackendHandler", value: wrapBackendHandler },
    { name: "wrapBackendStreamHandler", value: wrapBackendStreamHandler },
  ];

  for (const exportedFunction of runtimeExports) {
    assert.equal(typeof exportedFunction.value, "function", exportedFunction.name);
  }

  const scope = createBackendObservationScope(
    "backend-api",
    "request-1",
    "/v1/test",
    "GET",
    "user-1",
    "workspace-1",
    null,
    null,
    null,
  );
  const normalizedError = normalizeCaughtError("failed");
  const typeSample = createFacadeTypeSample(scope, normalizedError);

  assert.deepEqual(getBackendSentryConfig({}), { enabled: false });
  assert.equal(scope.service, typeSample.service);
  assert.equal(typeSample.trace.sentryTrace, null);
  assert.equal(typeSample.breadcrumb.action, "request_error");
  assert.equal(typeSample.warning.action, "database_pool_error");
  assert.equal(typeSample.exception.error, normalizedError);
});
