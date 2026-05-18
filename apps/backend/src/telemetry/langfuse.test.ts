import assert from "node:assert/strict";
import test from "node:test";
import type { BasicTracerProvider, Sampler } from "@opentelemetry/sdk-trace-base";
import { NoopSpanProcessor, SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  initializeBackendSentryWithDeps,
  resetBackendSentryForTests,
} from "../observability/sentry";
import {
  createLangfuseTracerProvider,
  flushLangfuseTelemetry,
  initializeLangfuseTelemetryWithDeps,
  resetLangfuseTelemetryForTests,
  sanitizeTelemetryValue,
} from "./langfuse";

const LANGFUSE_ENV_NAMES = [
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
  "SENTRY_DSN",
] as const;

type LangfuseEnvName = typeof LANGFUSE_ENV_NAMES[number];
type EnvSnapshot = Readonly<Record<LangfuseEnvName, string | undefined>>;
type SamplingSampler = Readonly<{
  shouldSample: () => Readonly<{
    decision: SamplingDecision;
  }>;
  toString: () => string;
}>;
type BasicTracerProviderConfig = Readonly<{
  _config: Readonly<{
    sampler: Sampler;
  }>;
}>;

function snapshotEnv(): EnvSnapshot {
  return {
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    SENTRY_DSN: process.env.SENTRY_DSN,
  };
}

function writeOptionalEnv(name: LangfuseEnvName, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const name of LANGFUSE_ENV_NAMES) {
    writeOptionalEnv(name, snapshot[name]);
  }
}

function configureLangfuseEnvWithSentryDsn(): void {
  process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-test";
  process.env.LANGFUSE_BASE_URL = "https://langfuse.example.invalid";
  process.env.SENTRY_DSN = "https://sentry.example.invalid/1";
}

function createTestLangfuseSpanProcessor(): LangfuseSpanProcessor {
  return new LangfuseSpanProcessor({
    publicKey: "pk-test",
    secretKey: "sk-test",
    baseUrl: "https://langfuse.example.invalid",
    exportMode: "immediate",
  });
}

function getTracerProviderSampler(provider: BasicTracerProvider): SamplingSampler {
  const providerConfig = provider as unknown as BasicTracerProviderConfig;
  return providerConfig._config.sampler as unknown as SamplingSampler;
}

test("Langfuse tracer provider always samples spans independent from active parents", () => {
  const tracerProvider = createLangfuseTracerProvider(new NoopSpanProcessor());
  const sampler = getTracerProviderSampler(tracerProvider);

  assert.equal(sampler.toString(), "AlwaysOnSampler");
  assert.equal(sampler.shouldSample().decision, SamplingDecision.RECORD_AND_SAMPLED);
});

test("Langfuse sanitizer preserves AI content while redacting credentials and emails", () => {
  const sanitized = sanitizeTelemetryValue({
    frontText: "What does async mean? Ask teacher@example.com",
    backText: "It lets work continue while waiting for an operation.",
    turnInput: [
      {
        type: "text",
        text: "Create a card about PostgreSQL indexes.",
      },
    ],
    localMessages: [
      {
        role: "user",
        content: "Keep this raw user prompt for AI debugging.",
      },
    ],
    model_output: "Use a B-tree index for equality lookups.",
    output: {
      content: "Tool returned the exact generated card content.",
    },
    authorization: "Bearer live-token-value",
    cookie: "session=secret-cookie-value",
    csrfToken: "csrf-token-value",
    otp: "123456",
    apiKey: "sk_12345678901234567890",
    password: "password-value",
    secret: "secret-value",
    sessionId: "session-id-kept",
    sessionToken: "session-token-value",
    userId: "user-id-kept",
    workspaceId: "workspace-id-kept",
    outputTokens: 42,
  });

  assert.deepEqual(sanitized, {
    frontText: "What does async mean? Ask <masked-email>",
    backText: "It lets work continue while waiting for an operation.",
    turnInput: [
      {
        type: "text",
        text: "Create a card about PostgreSQL indexes.",
      },
    ],
    localMessages: [
      {
        role: "user",
        content: "Keep this raw user prompt for AI debugging.",
      },
    ],
    model_output: "Use a B-tree index for equality lookups.",
    output: {
      content: "Tool returned the exact generated card content.",
    },
    authorization: "<redacted-secret>",
    cookie: "<redacted-secret>",
    csrfToken: "<redacted-secret>",
    otp: "<redacted-secret>",
    apiKey: "<redacted-secret>",
    password: "<redacted-secret>",
    secret: "<redacted-secret>",
    sessionId: "session-id-kept",
    sessionToken: "<redacted-secret>",
    userId: "user-id-kept",
    workspaceId: "workspace-id-kept",
    outputTokens: 42,
  });
});

test("Langfuse sanitizer preserves raw plain strings except emails", () => {
  assert.equal(
    sanitizeTelemetryValue("Prompt text with front/back card content and owner@example.com"),
    "Prompt text with front/back card content and <masked-email>",
  );
});

test("Langfuse starts its isolated tracer provider when Sentry DSN exists", () => {
  const envSnapshot = snapshotEnv();
  resetBackendSentryForTests();
  resetLangfuseTelemetryForTests();
  configureLangfuseEnvWithSentryDsn();

  const spanProcessor = createTestLangfuseSpanProcessor();
  const tracerProvider = {} as BasicTracerProvider;
  let setProviderCount = 0;

  try {
    initializeLangfuseTelemetryWithDeps({
      createLangfuseSpanProcessor: () => spanProcessor,
      createLangfuseTracerProvider: (createdSpanProcessor) => {
        assert.equal(createdSpanProcessor, spanProcessor);
        return tracerProvider;
      },
      setLangfuseTracerProvider: (createdTracerProvider) => {
        assert.equal(createdTracerProvider, tracerProvider);
        setProviderCount += 1;
      },
    });

    assert.equal(setProviderCount, 1);
  } finally {
    restoreEnv(envSnapshot);
    resetBackendSentryForTests();
    resetLangfuseTelemetryForTests();
  }
});

test("Langfuse isolated provider starts after Sentry initializes with zero trace sample rate", () => {
  const envSnapshot = snapshotEnv();
  resetBackendSentryForTests();
  resetLangfuseTelemetryForTests();
  configureLangfuseEnvWithSentryDsn();

  try {
    initializeBackendSentryWithDeps(
      "chat-live",
      {
        SENTRY_DSN: "https://sentry.example.invalid/1",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_RELEASE: "abc123",
        SENTRY_TRACES_SAMPLE_RATE: "0",
      },
      {
        init: () => {},
      },
    );

    const tracerProvider = {} as BasicTracerProvider;
    let setProviderCount = 0;
    initializeLangfuseTelemetryWithDeps({
      createLangfuseSpanProcessor: () => createTestLangfuseSpanProcessor(),
      createLangfuseTracerProvider: () => tracerProvider,
      setLangfuseTracerProvider: (createdTracerProvider) => {
        assert.equal(createdTracerProvider, tracerProvider);
        setProviderCount += 1;
      },
    });

    assert.equal(setProviderCount, 1);
  } finally {
    restoreEnv(envSnapshot);
    resetBackendSentryForTests();
    resetLangfuseTelemetryForTests();
  }
});

test("Langfuse flush no-ops before telemetry starts", async () => {
  resetLangfuseTelemetryForTests();

  try {
    await flushLangfuseTelemetry();
  } finally {
    resetLangfuseTelemetryForTests();
  }
});

test("Langfuse flush force-flushes the isolated provider", async () => {
  const envSnapshot = snapshotEnv();
  resetLangfuseTelemetryForTests();
  configureLangfuseEnvWithSentryDsn();

  let flushCount = 0;
  const tracerProvider = {
    forceFlush: async (): Promise<void> => {
      flushCount += 1;
    },
  } as BasicTracerProvider;

  try {
    initializeLangfuseTelemetryWithDeps({
      createLangfuseSpanProcessor: () => createTestLangfuseSpanProcessor(),
      createLangfuseTracerProvider: () => tracerProvider,
      setLangfuseTracerProvider: () => {},
    });

    await flushLangfuseTelemetry();

    assert.equal(flushCount, 1);
  } finally {
    restoreEnv(envSnapshot);
    resetLangfuseTelemetryForTests();
  }
});

test("Langfuse flush logs and swallows force-flush failures", async () => {
  const envSnapshot = snapshotEnv();
  const originalWarn = console.warn;
  const warningRecords: Array<Readonly<Record<string, unknown>>> = [];
  resetLangfuseTelemetryForTests();
  configureLangfuseEnvWithSentryDsn();

  const tracerProvider = {
    forceFlush: async (): Promise<void> => {
      throw new Error("Langfuse export failed");
    },
  } as BasicTracerProvider;

  console.warn = (message?: unknown): void => {
    if (typeof message !== "string") {
      throw new Error("Expected Langfuse flush warning log to be a JSON string.");
    }
    warningRecords.push(JSON.parse(message) as Readonly<Record<string, unknown>>);
  };

  try {
    initializeLangfuseTelemetryWithDeps({
      createLangfuseSpanProcessor: () => createTestLangfuseSpanProcessor(),
      createLangfuseTracerProvider: () => tracerProvider,
      setLangfuseTracerProvider: () => {},
    });

    await flushLangfuseTelemetry();

    assert.deepEqual(warningRecords, [
      {
        domain: "backend",
        action: "langfuse_telemetry_flush_failed",
        errorClass: "Error",
        error: "Langfuse export failed",
      },
    ]);
  } finally {
    console.warn = originalWarn;
    restoreEnv(envSnapshot);
    resetLangfuseTelemetryForTests();
  }
});
