import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { AlwaysOnSampler, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel";
import type { LangfuseObservation } from "@langfuse/tracing";
import {
  createTraceId,
  propagateAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";

type TelemetryMetadata = Readonly<Record<string, string>>;
type LangfuseSanitizedObject = Readonly<{
  [key: string]: LangfuseSanitizedTelemetryValue;
}>;
type LangfuseSanitizedTelemetryValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | ReadonlyArray<LangfuseSanitizedTelemetryValue>
  | LangfuseSanitizedObject;

type ChatTurnTelemetryParams = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  turnIndex: number;
  runState: string;
  turnInput: unknown;
}>;

type ChatTranscriptionTelemetryParams = Readonly<{
  requestId: string;
  userId: string;
  sessionId: string;
  source: string;
  fileName: string;
  mediaType: string;
  fileSize: number;
}>;

type StartChatTurnObservationDependencies = Readonly<{
  createTraceId: typeof createTraceId;
  propagateAttributes: typeof propagateAttributes;
  startObservation: typeof startObservation;
}>;

type StartChatTranscriptionObservationDependencies = Readonly<{
  createTraceId: typeof createTraceId;
  propagateAttributes: typeof propagateAttributes;
  startObservation: typeof startObservation;
}>;

type InitializeLangfuseTelemetryDependencies = Readonly<{
  createLangfuseSpanProcessor: () => LangfuseSpanProcessor | null;
  createLangfuseTracerProvider: (spanProcessor: SpanProcessor) => BasicTracerProvider;
  setLangfuseTracerProvider: typeof setLangfuseTracerProvider;
}>;

const DEFAULT_START_CHAT_TURN_OBSERVATION_DEPENDENCIES: StartChatTurnObservationDependencies = {
  createTraceId,
  propagateAttributes,
  startObservation,
};

const DEFAULT_START_CHAT_TRANSCRIPTION_OBSERVATION_DEPENDENCIES: StartChatTranscriptionObservationDependencies = {
  createTraceId,
  propagateAttributes,
  startObservation,
};

const DEFAULT_INITIALIZE_LANGFUSE_TELEMETRY_DEPENDENCIES: InitializeLangfuseTelemetryDependencies = {
  createLangfuseSpanProcessor,
  createLangfuseTracerProvider,
  setLangfuseTracerProvider,
};

const langfuseRedactedSecretValue = "<redacted-secret>";

const langfuseSecretKeyFragments: ReadonlyArray<string> = [
  "authorization",
  "cookie",
  "csrf",
  "otp",
  "password",
  "secret",
  "token",
  "apikey",
];

const langfuseOperationalTokenMetricKeyNames: ReadonlySet<string> = new Set([
  "completiontokens",
  "inputtokens",
  "outputtokens",
  "prompttokens",
  "tokencount",
  "totaltokens",
]);

const langfuseMaskPatterns: ReadonlyArray<Readonly<{
  pattern: RegExp;
  replacement: string;
}>> = [
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "<masked-email>",
  },
  {
    pattern: /\b(?:sk|pk|rk)[_-][A-Za-z0-9_-]{16,}\b/g,
    replacement: "<masked-api-key>",
  },
  {
    pattern: /\b(Bearer|ApiKey|Guest|Live)\s+[A-Za-z0-9._~+/=-]{8,}\b/g,
    replacement: "$1 <redacted-secret>",
  },
];

let telemetryTracerProvider: BasicTracerProvider | null = null;
let telemetryStarted = false;

function getPresentConfigValueCount(
  values: ReadonlyArray<string | undefined>,
): number {
  return values.filter((value) => value !== undefined && value !== "").length;
}

function metadataValue(value: string | number | boolean): string {
  return String(value).slice(0, 200);
}

function normalizeLangfuseTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLangfuseOperationalTokenMetricKey(key: string): boolean {
  return langfuseOperationalTokenMetricKeyNames.has(normalizeLangfuseTelemetryKey(key));
}

function shouldRedactLangfuseSecretEntry(key: string, value: unknown): boolean {
  if (typeof value === "number" && isLangfuseOperationalTokenMetricKey(key)) {
    return false;
  }

  const normalizedKey = normalizeLangfuseTelemetryKey(key);
  return typeof value !== "boolean"
    && langfuseSecretKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

function maskLangfuseString(value: string): string {
  return langfuseMaskPatterns.reduce(
    (currentValue, rule) => currentValue.replace(rule.pattern, rule.replacement),
    value,
  );
}

function sanitizeLangfuseTelemetryEntry(
  key: string,
  value: unknown,
): LangfuseSanitizedTelemetryValue {
  if (shouldRedactLangfuseSecretEntry(key, value)) {
    return langfuseRedactedSecretValue;
  }

  return sanitizeTelemetryValue(value);
}

function logTelemetryFailure(
  action: string,
  error: unknown,
): void {
  console.error(JSON.stringify({
    domain: "backend",
    action,
    error: error instanceof Error ? error.message : String(error),
  }));
}

function logTelemetryWarning(
  action: string,
  error: unknown,
): void {
  console.warn(JSON.stringify({
    domain: "backend",
    action,
    errorClass: error instanceof Error ? error.name : null,
    error: error instanceof Error ? error.message : String(error),
  }));
}

function buildChatTurnMetadata(
  params: ChatTurnTelemetryParams,
): TelemetryMetadata {
  const attachmentCount = Array.isArray(params.turnInput)
    ? params.turnInput.filter((part) =>
      typeof part === "object"
      && part !== null
      && "type" in part
      && (part as Readonly<{ type: unknown }>).type !== "text").length
    : 0;

  return {
    requestId: metadataValue(params.requestId),
    workspaceId: metadataValue(params.workspaceId),
    model: metadataValue(params.model),
    turnIndex: metadataValue(params.turnIndex),
    hasAttachments: metadataValue(attachmentCount > 0),
    attachmentCount: metadataValue(attachmentCount),
    runState: metadataValue(params.runState),
  };
}

function buildChatTranscriptionMetadata(
  params: ChatTranscriptionTelemetryParams,
): TelemetryMetadata {
  return {
    requestId: metadataValue(params.requestId),
    userId: metadataValue(params.userId),
    sessionId: metadataValue(params.sessionId),
    source: metadataValue(params.source),
    fileName: metadataValue(params.fileName),
    mediaType: metadataValue(params.mediaType),
    fileSize: metadataValue(params.fileSize),
  };
}

function getLangfuseConfig(
  env: NodeJS.ProcessEnv,
): Readonly<{
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}> | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  const baseUrl = env.LANGFUSE_BASE_URL;

  if (
    publicKey === undefined
    || publicKey === ""
    || secretKey === undefined
    || secretKey === ""
    || baseUrl === undefined
    || baseUrl === ""
  ) {
    return null;
  }

  return {
    publicKey,
    secretKey,
    baseUrl,
  };
}

export function getLangfuseConfigValidationErrors(
  env: NodeJS.ProcessEnv,
): ReadonlyArray<string> {
  const presentCount = getPresentConfigValueCount([
    env.LANGFUSE_PUBLIC_KEY,
    env.LANGFUSE_SECRET_KEY,
    env.LANGFUSE_BASE_URL,
  ]);

  if (presentCount === 0 || presentCount === 3) {
    return [];
  }

  return [
    "LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL must be configured together",
  ];
}

export function isLangfuseConfigured(
  env: NodeJS.ProcessEnv,
): boolean {
  return getLangfuseConfig(env) !== null;
}

// Langfuse intentionally keeps raw AI/product input and output for debugging while stripping credentials and emails.
export function sanitizeTelemetryValue(value: unknown): LangfuseSanitizedTelemetryValue {
  if (typeof value === "string") {
    return maskLangfuseString(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTelemetryValue(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [
        key,
        sanitizeLangfuseTelemetryEntry(key, childValue),
      ]),
    );
  }

  return undefined;
}

export function createLangfuseSpanProcessor(): LangfuseSpanProcessor | null {
  const config = getLangfuseConfig(process.env);
  if (config === null) {
    return null;
  }

  return new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    exportMode: "immediate",
    environment: process.env.NODE_ENV,
    release: process.env.GITHUB_SHA,
    shouldExportSpan: ({ otelSpan }: Readonly<{ otelSpan: ReadableSpan }>): boolean =>
      isDefaultExportSpan(otelSpan),
    mask: ({ data }: Readonly<{ data: unknown }>): unknown =>
      sanitizeTelemetryValue(data),
  });
}

export function createLangfuseTracerProvider(spanProcessor: SpanProcessor): BasicTracerProvider {
  return new BasicTracerProvider({
    sampler: new AlwaysOnSampler(),
    spanProcessors: [spanProcessor],
  });
}

export function resetLangfuseTelemetryForTests(): void {
  setLangfuseTracerProvider(null);
  telemetryTracerProvider = null;
  telemetryStarted = false;
}

export function initializeLangfuseTelemetryWithDeps(
  dependencies: InitializeLangfuseTelemetryDependencies,
): void {
  const validationErrors = getLangfuseConfigValidationErrors(process.env);
  if (validationErrors.length > 0) {
    throw new Error(
      `Startup validation failed:\n${validationErrors.map((error) => `  - ${error}`).join("\n")}`,
    );
  }

  if (telemetryStarted) {
    return;
  }

  const spanProcessor = dependencies.createLangfuseSpanProcessor();
  if (spanProcessor === null) {
    return;
  }

  telemetryTracerProvider = dependencies.createLangfuseTracerProvider(spanProcessor);
  dependencies.setLangfuseTracerProvider(telemetryTracerProvider);
  telemetryStarted = true;
}

export function initializeLangfuseTelemetry(): void {
  initializeLangfuseTelemetryWithDeps(DEFAULT_INITIALIZE_LANGFUSE_TELEMETRY_DEPENDENCIES);
}

export async function flushLangfuseTelemetry(): Promise<void> {
  if (!telemetryStarted || telemetryTracerProvider === null) {
    return;
  }

  try {
    await telemetryTracerProvider.forceFlush();
  } catch (error) {
    logTelemetryWarning("langfuse_telemetry_flush_failed", error);
  }
}

export async function startChatTurnObservationWithDeps(
  params: ChatTurnTelemetryParams,
  fn: (rootObservation: LangfuseObservation | null) => Promise<void>,
  dependencies: StartChatTurnObservationDependencies,
): Promise<void> {
  if (!isLangfuseConfigured(process.env)) {
    await fn(null);
    return;
  }

  let callbackStarted = false;
  let callbackError: unknown | null = null;

  try {
    const traceId = await dependencies.createTraceId(params.requestId);
    const parentSpanContext = {
      traceId,
      spanId: traceId.slice(0, 16),
      traceFlags: 1,
    };

    await dependencies.propagateAttributes(
      {
        traceName: "chat_turn",
        userId: params.userId,
        sessionId: params.sessionId,
        tags: ["surface:backend-chat", "runtime:worker-loop", "vendor:openai"],
        metadata: buildChatTurnMetadata(params),
      },
      async (): Promise<void> => {
        callbackStarted = true;
        const rootObservation = dependencies.startObservation(
          "chat_turn",
          {
            input: {
              turnInput: sanitizeTelemetryValue(params.turnInput),
            },
            metadata: buildChatTurnMetadata(params),
          },
          {
            asType: "agent",
            parentSpanContext,
          },
        );

        try {
          await fn(rootObservation);
          rootObservation.updateOtelSpanAttributes({
            output: {
              result: "success",
            },
          });
        } catch (error) {
          callbackError = error;
          rootObservation.updateOtelSpanAttributes({
            output: {
              result: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        } finally {
          rootObservation.end();
        }
      },
    );
  } catch (error) {
    if (callbackError !== null) {
      throw callbackError;
    }

    if (callbackStarted) {
      logTelemetryFailure("langfuse_chat_turn_export_failed", error);
      return;
    }

    logTelemetryFailure("langfuse_chat_turn_start_failed", error);
    await fn(null);
  }
}

export async function startChatTurnObservation(
  params: ChatTurnTelemetryParams,
  fn: (rootObservation: LangfuseObservation | null) => Promise<void>,
): Promise<void> {
  return startChatTurnObservationWithDeps(
    params,
    fn,
    DEFAULT_START_CHAT_TURN_OBSERVATION_DEPENDENCIES,
  );
}

export async function startChatTranscriptionObservationWithDeps<Result>(
  params: ChatTranscriptionTelemetryParams,
  fn: () => Promise<Result>,
  dependencies: StartChatTranscriptionObservationDependencies,
): Promise<Result> {
  if (!isLangfuseConfigured(process.env)) {
    return fn();
  }

  let callbackStarted = false;
  let callbackError: unknown | null = null;
  let callbackResult: Result | null = null;

  try {
    const traceId = await dependencies.createTraceId(params.requestId);
    const parentSpanContext = {
      traceId,
      spanId: traceId.slice(0, 16),
      traceFlags: 1,
    };

    return await dependencies.propagateAttributes(
      {
        traceName: "chat_transcription",
        userId: params.userId,
        tags: ["surface:chat-transcription", "runtime:backend-route", "vendor:openai"],
        metadata: buildChatTranscriptionMetadata(params),
      },
      async (): Promise<Result> => {
        callbackStarted = true;
        const rootObservation = dependencies.startObservation(
          "chat_transcription",
          {
            input: {
              sessionId: params.sessionId,
              source: params.source,
              fileName: params.fileName,
              mediaType: params.mediaType,
              fileSize: params.fileSize,
            },
            metadata: buildChatTranscriptionMetadata(params),
          },
          {
            asType: "agent",
            parentSpanContext,
          },
        );

        try {
          const result = await fn();
          callbackResult = result;
          rootObservation.updateOtelSpanAttributes({
            output: {
              result: "success",
            },
          });
          return result;
        } catch (error) {
          callbackError = error;
          rootObservation.updateOtelSpanAttributes({
            output: {
              result: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        } finally {
          rootObservation.end();
        }
      },
    );
  } catch (error) {
    if (callbackError !== null) {
      throw callbackError;
    }

    if (callbackStarted) {
      logTelemetryFailure("langfuse_chat_transcription_export_failed", error);
      if (callbackResult !== null) {
        return callbackResult;
      }
      return fn();
    }

    logTelemetryFailure("langfuse_chat_transcription_start_failed", error);
    return fn();
  }
}

export async function startChatTranscriptionObservation<Result>(
  params: ChatTranscriptionTelemetryParams,
  fn: () => Promise<Result>,
): Promise<Result> {
  return startChatTranscriptionObservationWithDeps(
    params,
    fn,
    DEFAULT_START_CHAT_TRANSCRIPTION_OBSERVATION_DEPENDENCIES,
  );
}
