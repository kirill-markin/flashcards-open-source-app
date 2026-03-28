import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel";
import type { LangfuseObservation } from "@langfuse/tracing";
import { createTraceId, propagateAttributes, startObservation } from "@langfuse/tracing";

type TelemetryMetadata = Readonly<Record<string, string>>;

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
  createNodeSdk: (spanProcessor: LangfuseSpanProcessor) => NodeSDK;
  startNodeSdk: (sdk: NodeSDK) => void | Promise<void>;
}>;

const MASK_PATTERNS: ReadonlyArray<Readonly<{
  pattern: RegExp;
  replacement: string;
}>> = [
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "<masked-email>",
  },
  {
    pattern: /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g,
    replacement: "<masked-phone>",
  },
  {
    pattern: /\b(?:sk|pk|rk)_[A-Za-z0-9_-]{16,}\b/g,
    replacement: "<masked-api-key>",
  },
  {
    pattern: /\b\d{12,19}\b/g,
    replacement: "<masked-number>",
  },
];

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
  createNodeSdk: (spanProcessor: LangfuseSpanProcessor): NodeSDK =>
    new NodeSDK({
      spanProcessors: [spanProcessor],
    }),
  startNodeSdk: (sdk: NodeSDK): void => {
    void sdk.start();
  },
};

let telemetrySdk: NodeSDK | null = null;
let telemetryStarted = false;

function getPresentConfigValueCount(
  values: ReadonlyArray<string | undefined>,
): number {
  return values.filter((value) => value !== undefined && value !== "").length;
}

function metadataValue(value: string | number | boolean): string {
  return String(value).slice(0, 200);
}

function sanitizeString(value: string): string {
  return MASK_PATTERNS.reduce(
    (currentValue, rule) => currentValue.replace(rule.pattern, rule.replacement),
    value,
  );
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

export function sanitizeTelemetryValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTelemetryValue(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [
        key,
        key === "base64Data"
          ? "<redacted-base64>"
          : sanitizeTelemetryValue(childValue),
      ]),
    );
  }

  return value;
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

export function resetLangfuseTelemetryForTests(): void {
  telemetrySdk = null;
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

  telemetrySdk = dependencies.createNodeSdk(spanProcessor);
  dependencies.startNodeSdk(telemetrySdk);
  telemetryStarted = true;
}

export function initializeLangfuseTelemetry(): void {
  initializeLangfuseTelemetryWithDeps(DEFAULT_INITIALIZE_LANGFUSE_TELEMETRY_DEPENDENCIES);
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
