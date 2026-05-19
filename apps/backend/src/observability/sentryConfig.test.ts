import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/aws-serverless";
import {
  getBackendSentryConfig,
  initializeBackendSentryWithDeps,
  isBackendSentryInitializedForOpenTelemetry,
  resetBackendSentryForTests,
} from "./sentryConfig";
import {
  type CapturedSentryInitOptions,
  requireCapturedSentryInitOptions,
  sentryModule,
} from "./sentryTestHelpers";

test("backend Sentry config is disabled outside Lambda without a DSN", () => {
  resetBackendSentryForTests();
  assert.deepEqual(getBackendSentryConfig({}), { enabled: false });
});

test("backend Sentry config requires a DSN in Lambda", () => {
  assert.throws(
    () => getBackendSentryConfig({ AWS_LAMBDA_FUNCTION_NAME: "BackendHandler" }),
    /SENTRY_DSN is required/,
  );
});

test("backend Sentry config validates enabled settings", () => {
  assert.throws(
    () => getBackendSentryConfig({ SENTRY_DSN: "https://example.invalid/1" }),
    /SENTRY_ENVIRONMENT is required/,
  );
  assert.throws(
    () => getBackendSentryConfig({
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "2",
    }),
    /SENTRY_TRACES_SAMPLE_RATE/,
  );

  assert.deepEqual(
    getBackendSentryConfig({
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0.1",
    }),
    {
      enabled: true,
      dsn: "https://example.invalid/1",
      environment: "production",
      release: "abc123",
      tracesSampleRate: 0.1,
    },
  );
});

test("backend Sentry init preserves safe integrations only", () => {
  resetBackendSentryForTests();
  const originalOpenAIIntegration = sentryModule.openAIIntegration;
  let capturedInitOptions: CapturedSentryInitOptions | null = null;
  let capturedOpenAIOptions: Parameters<typeof Sentry.openAIIntegration>[0] | null = null;

  sentryModule.openAIIntegration = (options) => {
    capturedOpenAIOptions = options ?? null;
    return originalOpenAIIntegration(options);
  };

  try {
    initializeBackendSentryWithDeps(
      "backend-api",
      {
        SENTRY_DSN: "https://example.invalid/1",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_RELEASE: "abc123",
        SENTRY_TRACES_SAMPLE_RATE: "0.1",
      },
      {
        init: (options) => {
          capturedInitOptions = options;
        },
      },
    );

    const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
    assert.equal(typeof initOptions.integrations, "function");
    if (typeof initOptions.integrations !== "function") {
      throw new Error("Expected backend Sentry integrations to be configured by factory.");
    }

    const configuredIntegrations = initOptions.integrations([
      Sentry.postgresIntegration(),
      originalOpenAIIntegration(),
      Sentry.httpIntegration(),
      Sentry.nativeNodeFetchIntegration(),
      Sentry.honoIntegration(),
    ]);
    const integrationNames = configuredIntegrations.map((integration: { name: string }) => integration.name);
    assert.deepEqual(integrationNames, ["Http", "NodeFetch", "Hono", "OpenAI"]);
    assert.deepEqual(capturedOpenAIOptions, {
      recordInputs: false,
      recordOutputs: false,
    });
  } finally {
    sentryModule.openAIIntegration = originalOpenAIIntegration;
  }
});

test("backend Sentry init does not register Langfuse span processors on Sentry OpenTelemetry provider", () => {
  resetBackendSentryForTests();
  let capturedInitOptions: CapturedSentryInitOptions | null = null;

  initializeBackendSentryWithDeps(
    "chat-live",
    {
      SENTRY_DSN: "https://example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_RELEASE: "abc123",
      SENTRY_TRACES_SAMPLE_RATE: "0.1",
    },
    {
      init: (options) => {
        capturedInitOptions = options;
      },
    },
  );

  const initOptions = requireCapturedSentryInitOptions(capturedInitOptions);
  assert.equal(initOptions.openTelemetrySpanProcessors, undefined);
  assert.equal(isBackendSentryInitializedForOpenTelemetry(), true);
});

test("backend Sentry OpenTelemetry state is false until enabled init succeeds", () => {
  resetBackendSentryForTests();
  initializeBackendSentryWithDeps(
    "backend-api",
    {},
    {
      init: () => {
        throw new Error("Sentry init should not run when disabled.");
      },
    },
  );
  assert.equal(isBackendSentryInitializedForOpenTelemetry(), false);

  resetBackendSentryForTests();
  assert.throws(
    () => initializeBackendSentryWithDeps(
      "backend-api",
      {
        SENTRY_DSN: "https://example.invalid/1",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_RELEASE: "abc123",
        SENTRY_TRACES_SAMPLE_RATE: "0.1",
      },
      {
        init: () => {
          throw new Error("init failed");
        },
      },
    ),
    /init failed/,
  );
  assert.equal(isBackendSentryInitializedForOpenTelemetry(), false);
});
