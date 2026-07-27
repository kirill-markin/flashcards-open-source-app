import assert from "node:assert/strict";
import test from "node:test";
import {
  captureBackendRuntimeWarning,
} from "../runtime";
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
  captureBackendWarningWithFingerprint,
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
import {
  sentryModule,
  withCapturedConsole,
} from "./testHelpers";

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
    { name: "captureBackendWarningWithFingerprint", value: captureBackendWarningWithFingerprint },
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

test("backend Sentry initialization configures the runtime sink idempotently and reset removes it", () => {
  resetBackendSentryForTests();
  const originalCaptureMessage = sentryModule.captureMessage;
  const originalEnvironment = {
    sentryDsn: process.env.SENTRY_DSN,
    awsExecutionEnvironment: process.env.AWS_EXECUTION_ENV,
    awsLambdaFunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
  };
  let captureMessageCount = 0;
  sentryModule.captureMessage = () => {
    captureMessageCount += 1;
    return "event-id";
  };
  delete process.env.SENTRY_DSN;
  delete process.env.AWS_EXECUTION_ENV;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;

  const event: BackendWarningEvent = {
    action: "database_pool_error",
    scope: createBackendObservationScope(
      "backend-api",
      "request-runtime-sink",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ),
    details: {
      poolName: "main",
      sqlState: null,
      errorCode: "ECONNRESET",
      errorClass: "Error",
      errorMessage: "pool failed",
    },
  };

  try {
    initializeBackendSentry("backend-api");
    initializeBackendSentry("backend-api");
    const configuredMessages = withCapturedConsole("warn", () => {
      captureBackendRuntimeWarning(event);
    });

    assert.equal(configuredMessages.length, 1);
    assert.equal(captureMessageCount, 1);
    assert.equal(createBackendRuntimeObservationScope().service, "backend-api");

    resetBackendSentryForTests();
    const fallbackMessages = withCapturedConsole("warn", () => {
      captureBackendRuntimeWarning(event);
    });

    assert.equal(fallbackMessages.length, 1);
    assert.equal(captureMessageCount, 1);
  } finally {
    sentryModule.captureMessage = originalCaptureMessage;
    if (originalEnvironment.sentryDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalEnvironment.sentryDsn;
    }
    if (originalEnvironment.awsExecutionEnvironment === undefined) {
      delete process.env.AWS_EXECUTION_ENV;
    } else {
      process.env.AWS_EXECUTION_ENV = originalEnvironment.awsExecutionEnvironment;
    }
    if (originalEnvironment.awsLambdaFunctionName === undefined) {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    } else {
      process.env.AWS_LAMBDA_FUNCTION_NAME = originalEnvironment.awsLambdaFunctionName;
    }
    resetBackendSentryForTests();
  }
});
