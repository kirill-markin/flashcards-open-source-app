import OpenAI from "openai";
import { buildOpenAISafetyIdentifier } from "../openai/safetyIdentifier";
import { getOpenAIClient } from "../openai/client";
import {
  addBackendBreadcrumb,
  captureBackendWarning,
  type GeneratedCardImageProviderDetails,
} from "../../observability/sentry";
import { maximumImageIngestionOriginalBytes } from "../../mediaAssets/validators";
import {
  GeneratedCardImageDeadlineExceededError,
  type GeneratedProviderImage,
  type OpenAIImageGenerationInput,
} from "./providerTypes";

export const generatedCardImageModel = "gpt-image-2";
export const generatedCardImageSize = "1024x1024";
export const generatedCardImageQuality = "low";
export const generatedCardImageOutputFormat = "jpeg";

const generatedCardImageMaximumProviderAttempts = 3;
const generatedCardImageInitialRetryDelayMs = 500;
const generatedCardImageMaximumRetryDelayMs = 30_000;
const generatedCardImagePersistenceReserveMs = 30_000;
const generatedCardImageMinimumRetryRequestMs = 10_000;
const maximumEncodedImageCharacters = Math.ceil(maximumImageIngestionOriginalBytes / 3) * 4;

type OpenAIImageFailureMetadata = Readonly<{
  status: number | null;
  requestId: string | null;
  errorType: string | null;
  errorCode: string | null;
  errorParam: string | null;
  moderationStage: string | null;
  moderationCategories: ReadonlyArray<string>;
  errorClass: string;
}>;

type ErrorRecord = Readonly<Record<string, unknown>>;

function toRecord(value: unknown): ErrorRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as ErrorRecord;
}

function readOptionalString(record: ErrorRecord | null, fieldName: string): string | null {
  const value = record?.[fieldName];
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

function readOptionalStatus(record: ErrorRecord | null): number | null {
  const value = record?.status ?? record?.statusCode;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readModerationCategories(record: ErrorRecord | null): ReadonlyArray<string> {
  const value = record?.categories;
  if (Array.isArray(value) === false) {
    return [];
  }

  return value
    .filter((category): category is string => typeof category === "string")
    .map((category) => category.trim())
    .filter((category) => category !== "")
    .slice(0, 16);
}

function getErrorClass(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }

  return "NonErrorThrow";
}

function getOpenAIImageFailureMetadata(error: unknown): OpenAIImageFailureMetadata {
  const errorRecord = toRecord(error);
  const providerErrorRecord = toRecord(errorRecord?.error);
  const moderationDetails = toRecord(providerErrorRecord?.moderation_details);
  return {
    status: readOptionalStatus(errorRecord),
    requestId: readOptionalString(errorRecord, "requestID")
      ?? readOptionalString(errorRecord, "requestId")
      ?? readOptionalString(errorRecord, "request_id"),
    errorType: readOptionalString(errorRecord, "type")
      ?? readOptionalString(providerErrorRecord, "type"),
    errorCode: readOptionalString(errorRecord, "code")
      ?? readOptionalString(providerErrorRecord, "code"),
    errorParam: readOptionalString(errorRecord, "param")
      ?? readOptionalString(providerErrorRecord, "param"),
    moderationStage: readOptionalString(moderationDetails, "moderation_stage"),
    moderationCategories: readModerationCategories(moderationDetails),
    errorClass: getErrorClass(error),
  };
}

function isTransientProviderFailure(
  error: unknown,
  metadata: OpenAIImageFailureMetadata,
): boolean {
  return error instanceof OpenAI.APIConnectionTimeoutError
    || metadata.status === 429
    || (metadata.status !== null && metadata.status >= 500 && metadata.status <= 599);
}

function retryDelayMs(attempt: number): number {
  return generatedCardImageInitialRetryDelayMs * (2 ** (attempt - 1));
}

function parseNonNegativeDecimalDelay(value: string): number | null {
  const normalizedValue = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(normalizedValue) === false) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

function readProviderRetryDelayMs(error: unknown, nowMs: number): number | null {
  if (error instanceof OpenAI.APIError === false || error.headers === undefined) {
    return null;
  }

  const retryAfterMilliseconds = error.headers.get("retry-after-ms");
  if (retryAfterMilliseconds !== null) {
    const parsedMilliseconds = parseNonNegativeDecimalDelay(retryAfterMilliseconds);
    if (parsedMilliseconds !== null) {
      return Math.min(parsedMilliseconds, generatedCardImageMaximumRetryDelayMs);
    }
  }

  const retryAfter = error.headers.get("retry-after");
  if (retryAfter === null) {
    return null;
  }

  const parsedSeconds = parseNonNegativeDecimalDelay(retryAfter);
  const parsedDelayMs = parsedSeconds === null
    ? Date.parse(retryAfter) - nowMs
    : parsedSeconds * 1_000;
  if (Number.isFinite(parsedDelayMs) === false || parsedDelayMs < 0) {
    return null;
  }

  return Math.min(parsedDelayMs, generatedCardImageMaximumRetryDelayMs);
}

function retryDelayForFailureMs(error: unknown, attempt: number): number {
  return readProviderRetryDelayMs(error, Date.now()) ?? retryDelayMs(attempt);
}

function createAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("OpenAI image generation was aborted.", "AbortError");
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = (): void => {
      clearTimeout(timeout);
      reject(createAbortError(signal));
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function createProviderDetails(
  imagePrompt: string,
  attempt: number,
  retryDelay: number | null,
  metadata: OpenAIImageFailureMetadata,
  durationMs: number,
  requestTimeoutMs: number,
  retrySkippedForBudget: boolean,
): GeneratedCardImageProviderDetails {
  return {
    model: generatedCardImageModel,
    size: generatedCardImageSize,
    quality: generatedCardImageQuality,
    outputFormat: generatedCardImageOutputFormat,
    promptLength: imagePrompt.length,
    attempt,
    maximumAttempts: generatedCardImageMaximumProviderAttempts,
    retryDelayMs: retryDelay,
    durationMs,
    requestTimeoutMs,
    retrySkippedForBudget,
    providerStatus: metadata.status,
    providerRequestId: metadata.requestId,
    providerErrorType: metadata.errorType,
    providerErrorCode: metadata.errorCode,
    providerErrorParam: metadata.errorParam,
    providerModerationStage: metadata.moderationStage,
    providerModerationCategories: metadata.moderationCategories,
    errorClass: metadata.errorClass,
  };
}

function createSuccessProviderDetails(
  imagePrompt: string,
  attempt: number,
  providerRequestId: string | null,
  durationMs: number,
  requestTimeoutMs: number,
): GeneratedCardImageProviderDetails {
  return {
    model: generatedCardImageModel,
    size: generatedCardImageSize,
    quality: generatedCardImageQuality,
    outputFormat: generatedCardImageOutputFormat,
    promptLength: imagePrompt.length,
    attempt,
    maximumAttempts: generatedCardImageMaximumProviderAttempts,
    retryDelayMs: null,
    durationMs,
    requestTimeoutMs,
    retrySkippedForBudget: false,
    providerStatus: 200,
    providerRequestId,
    providerErrorType: null,
    providerErrorCode: null,
    providerErrorParam: null,
    providerModerationStage: null,
    providerModerationCategories: [],
    errorClass: null,
  };
}

function describeSafeProviderFailure(metadata: OpenAIImageFailureMetadata): string {
  return [
    `status=${metadata.status === null ? "unknown" : String(metadata.status)}`,
    `requestId=${metadata.requestId ?? "unknown"}`,
    `type=${metadata.errorType ?? "unknown"}`,
    `code=${metadata.errorCode ?? "unknown"}`,
    `param=${metadata.errorParam ?? "unknown"}`,
    `moderationStage=${metadata.moderationStage ?? "unknown"}`,
    `moderationCategories=${metadata.moderationCategories.join(",") || "none"}`,
    `errorClass=${metadata.errorClass}`,
  ].join(" ");
}

function providerFailureHint(metadata: OpenAIImageFailureMetadata): string {
  if (metadata.errorClass === "APIConnectionTimeoutError") {
    return "The OpenAI image connection timed out within the bounded retry budget.";
  }

  if (metadata.status === 401 || metadata.status === 403) {
    return "Check the OpenAI API key, project permissions, and image-model access.";
  }

  if (metadata.status === 429) {
    return "The OpenAI image rate limit prevented generation within the bounded retry budget.";
  }

  if (metadata.errorCode === "moderation_blocked") {
    return "Revise the image prompt to meet OpenAI image safety requirements.";
  }

  if (
    metadata.status !== null
    && metadata.status >= 500
    && metadata.status <= 599
  ) {
    return "OpenAI image generation remained unavailable within the bounded retry budget.";
  }

  return "Review the safe provider fields and correct the image request before retrying.";
}

const mappedOpenAIImageError = Symbol("mappedOpenAIImageError");
type MappedOpenAIImageError = Error & Readonly<{
  [mappedOpenAIImageError]: true;
  status: number | null;
  code: string | null;
}>;

export function isOpenAIImageGenerationProviderError(error: unknown): error is MappedOpenAIImageError {
  return error instanceof Error
    && mappedOpenAIImageError in error
    && error[mappedOpenAIImageError] === true;
}

function isExpectedOpenAIImageGenerationFailure(error: unknown): boolean {
  if (isOpenAIImageGenerationProviderError(error)) {
    return true;
  }
  if (error instanceof OpenAI.APIError === false) {
    return false;
  }
  return [
    OpenAI.APIConnectionError,
    OpenAI.APIConnectionTimeoutError,
    OpenAI.BadRequestError,
    OpenAI.AuthenticationError,
    OpenAI.PermissionDeniedError,
    OpenAI.NotFoundError,
    OpenAI.ConflictError,
    OpenAI.UnprocessableEntityError,
    OpenAI.RateLimitError,
    OpenAI.InternalServerError,
  ].some((expectedConstructor) => error.constructor === expectedConstructor);
}

function createMappedProviderError(error: unknown, metadata: OpenAIImageFailureMetadata): MappedOpenAIImageError {
  return Object.assign(
    new Error(
      [
        "OpenAI image generation failed.",
        providerFailureHint(metadata),
        describeSafeProviderFailure(metadata),
      ].join(" "),
      { cause: error },
    ),
    {
      [mappedOpenAIImageError]: true as const,
      name: "OpenAIImageGenerationError",
      status: metadata.status,
      requestID: metadata.requestId,
      type: metadata.errorType,
      code: metadata.errorCode,
      param: metadata.errorParam,
      moderationStage: metadata.moderationStage,
      moderationCategories: metadata.moderationCategories,
    },
  );
}

export class OpenAIImageGenerationResponseError extends Error {
  readonly status: number;
  readonly requestID: string | null;
  readonly type = "invalid_response";
  readonly code = "invalid_image_response";

  constructor(
    message: string,
    providerStatus: number,
    providerRequestId: string | null,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "OpenAIImageGenerationResponseError";
    this.status = providerStatus;
    this.requestID = providerRequestId;
  }
}

function createInvalidProviderResponseError(
  message: string,
  providerStatus: number,
  providerRequestId: string | null,
  cause: unknown,
): OpenAIImageGenerationResponseError {
  return new OpenAIImageGenerationResponseError(
    message,
    providerStatus,
    providerRequestId,
    cause,
  );
}

function remainingOperationTimeMs(operationDeadlineMs: number): number {
  return Math.max(0, operationDeadlineMs - Date.now());
}

function providerRequestTimeoutMs(operationDeadlineMs: number): number {
  const requestBudgetMs = remainingOperationTimeMs(operationDeadlineMs)
    - generatedCardImagePersistenceReserveMs;
  if (requestBudgetMs <= 0) {
    throw new GeneratedCardImageDeadlineExceededError(null);
  }

  return Math.max(1, Math.floor(requestBudgetMs));
}

class GeneratedCardImageProviderDeadlineSignalError extends Error {
  constructor() {
    super("The generated card image provider request reached its bounded deadline.");
    this.name = "GeneratedCardImageProviderDeadlineSignalError";
  }
}

function createProviderDeadlineController(requestTimeoutMs: number): Readonly<{
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new GeneratedCardImageProviderDeadlineSignalError()),
    requestTimeoutMs,
  );
  return { controller, timer };
}

function hasProviderRetryBudget(
  operationDeadlineMs: number,
  retryDelay: number,
): boolean {
  return remainingOperationTimeMs(operationDeadlineMs)
    >= retryDelay
      + generatedCardImageMinimumRetryRequestMs
      + generatedCardImagePersistenceReserveMs;
}

function extractGeneratedImageBase64(response: unknown): string {
  const responseRecord = toRecord(response);
  const data = responseRecord?.data;
  if (Array.isArray(data) === false || data.length !== 1) {
    throw new Error("OpenAI image generation must return exactly one image.");
  }

  const imageRecord = toRecord(data[0]);
  const base64Image = imageRecord?.b64_json;
  if (typeof base64Image !== "string" || base64Image.trim() === "") {
    throw new Error("OpenAI image generation returned an empty image.");
  }

  return base64Image;
}

function isBase64AlphabetCharacter(characterCode: number): boolean {
  return (
    (characterCode >= 65 && characterCode <= 90)
    || (characterCode >= 97 && characterCode <= 122)
    || (characterCode >= 48 && characterCode <= 57)
    || characterCode === 43
    || characterCode === 47
  );
}

function hasCanonicalBase64Shape(base64Image: string): boolean {
  const paddingBytes = base64Image.endsWith("==") ? 2 : base64Image.endsWith("=") ? 1 : 0;
  const dataEndIndex = base64Image.length - paddingBytes;
  for (let index = 0; index < dataEndIndex; index += 1) {
    if (isBase64AlphabetCharacter(base64Image.charCodeAt(index)) === false) {
      return false;
    }
  }

  return true;
}

export function decodeGeneratedCardImageBase64(base64Image: string): Buffer {
  if (base64Image.length > maximumEncodedImageCharacters) {
    throw new Error(
      `OpenAI image generation returned more than ${maximumImageIngestionOriginalBytes} decoded bytes.`,
    );
  }

  const canonicalBase64 = base64Image.trim();
  if (
    canonicalBase64 !== base64Image
    || canonicalBase64.length === 0
    || canonicalBase64.length % 4 !== 0
    || hasCanonicalBase64Shape(canonicalBase64) === false
  ) {
    throw new Error("OpenAI image generation returned malformed base64 image data.");
  }

  const paddingBytes = canonicalBase64.endsWith("==") ? 2 : canonicalBase64.endsWith("=") ? 1 : 0;
  const decodedByteLength = (canonicalBase64.length / 4) * 3 - paddingBytes;
  if (decodedByteLength > maximumImageIngestionOriginalBytes) {
    throw new Error(
      `OpenAI image generation returned ${decodedByteLength} decoded bytes; maximum is ${maximumImageIngestionOriginalBytes}.`,
    );
  }

  const imageBytes = Buffer.from(canonicalBase64, "base64");
  if (
    imageBytes.byteLength === 0
    || imageBytes.byteLength !== decodedByteLength
    || imageBytes.toString("base64") !== canonicalBase64
  ) {
    throw new Error("OpenAI image generation returned invalid base64 image data.");
  }

  return imageBytes;
}

/**
 * Calls the official OpenAI Image API while keeping retries, aborts, and safe provider telemetry explicit.
 */
export class OpenAIGeneratedCardImageProvider {
  readonly #client: OpenAI;

  public constructor(client: OpenAI) {
    this.#client = client;
  }

  public async generate(input: OpenAIImageGenerationInput): Promise<GeneratedProviderImage> {
    const providerObservation = input.observationContext.rootObservation?.startObservation(
      "generated_card_image_provider",
      {
        input: {
          hasPrompt: true,
          promptLength: input.imagePrompt.length,
        },
        metadata: {
          model: generatedCardImageModel,
          size: generatedCardImageSize,
          quality: generatedCardImageQuality,
          outputFormat: generatedCardImageOutputFormat,
        },
      },
      {
        asType: "generation",
      },
    ) ?? null;
    let providerResultRecorded = false;
    try {
      for (let attempt = 1; attempt <= generatedCardImageMaximumProviderAttempts; attempt += 1) {
        input.signal.throwIfAborted();
        const attemptStartedAt = Date.now();
        const requestTimeoutMs = providerRequestTimeoutMs(input.operationDeadlineMs);
        const providerDeadline = createProviderDeadlineController(requestTimeoutMs);
        const requestSignal = AbortSignal.any([
          input.signal,
          providerDeadline.controller.signal,
        ]);

        try {
          const providerRequest = this.#client.images.generate(
            {
              model: generatedCardImageModel,
              prompt: input.imagePrompt,
              n: 1,
              size: generatedCardImageSize,
              quality: generatedCardImageQuality,
              output_format: generatedCardImageOutputFormat,
              user: buildOpenAISafetyIdentifier(input.userId),
            },
            {
              maxRetries: 0,
              signal: requestSignal,
            },
          );
          const rawProviderResponse = await providerRequest.asResponse();
          const providerRequestId = rawProviderResponse.headers.get("x-request-id");

          let imageBytes: Buffer;
          try {
            imageBytes = decodeGeneratedCardImageBase64(
              extractGeneratedImageBase64(await providerRequest),
            );
          } catch (error) {
            throw createInvalidProviderResponseError(
              "OpenAI image generation returned an invalid image response.",
              rawProviderResponse.status,
              providerRequestId,
              error,
            );
          }

          const details = createSuccessProviderDetails(
            input.imagePrompt,
            attempt,
            providerRequestId,
            Date.now() - attemptStartedAt,
            requestTimeoutMs,
          );
          addBackendBreadcrumb({
            action: "generated_card_image_provider_complete",
            scope: input.observationContext.scope,
            details,
          });
          providerObservation?.updateOtelSpanAttributes({
            output: { result: "success" }, metadata: details,
          });
          providerResultRecorded = true;
          return {
            bytes: imageBytes,
            providerRequestId,
          };
        } catch (error) {
          if (input.signal.aborted) {
            throw error;
          }

          const metadata = getOpenAIImageFailureMetadata(error);
          if (providerDeadline.controller.signal.aborted) {
            const details = createProviderDetails(
              input.imagePrompt,
              attempt,
              null,
              metadata,
              Date.now() - attemptStartedAt,
              requestTimeoutMs,
              false,
            );
            captureBackendWarning({
              action: "generated_card_image_provider_failed",
              message: "OpenAI image generation reached its bounded request deadline.",
              scope: input.observationContext.scope,
              details,
            });
            providerObservation?.updateOtelSpanAttributes({
              output: { result: "deadline" },
              metadata: details,
            });
            providerResultRecorded = true;
            throw new GeneratedCardImageDeadlineExceededError(error);
          }
          if (isExpectedOpenAIImageGenerationFailure(error) === false) {
            throw error;
          }

          if (
            attempt < generatedCardImageMaximumProviderAttempts
            && isTransientProviderFailure(error, metadata)
          ) {
            const delayMs = retryDelayForFailureMs(error, attempt);
            if (hasProviderRetryBudget(input.operationDeadlineMs, delayMs)) {
              const details = createProviderDetails(
                input.imagePrompt,
                attempt,
                delayMs,
                metadata,
                Date.now() - attemptStartedAt,
                requestTimeoutMs,
                false,
              );
              captureBackendWarning({
                action: "generated_card_image_provider_retry",
                message: "OpenAI image generation will retry after a transient provider failure.",
                scope: input.observationContext.scope,
                details,
              });
              providerObservation?.updateOtelSpanAttributes({
                metadata: details,
              });
              await waitForRetry(delayMs, input.signal);
              continue;
            }

            const details = createProviderDetails(
              input.imagePrompt,
              attempt,
              delayMs,
              metadata,
              Date.now() - attemptStartedAt,
              requestTimeoutMs,
              true,
            );
            captureBackendWarning({
              action: "generated_card_image_provider_failed",
              message: "OpenAI image generation could not retry within the remaining operation budget.",
              scope: input.observationContext.scope,
              details,
            });
            providerObservation?.updateOtelSpanAttributes({
              output: { result: "error" },
              metadata: details,
            });
            providerResultRecorded = true;
            throw createMappedProviderError(error, metadata);
          }

          const details = createProviderDetails(
            input.imagePrompt,
            attempt,
            null,
            metadata,
            Date.now() - attemptStartedAt,
            requestTimeoutMs,
            false,
          );
          captureBackendWarning({
            action: "generated_card_image_provider_failed",
            message: "OpenAI image generation failed.",
            scope: input.observationContext.scope,
            details,
          });
          providerObservation?.updateOtelSpanAttributes({
            output: { result: "error" }, metadata: details,
          });
          providerResultRecorded = true;
          throw createMappedProviderError(error, metadata);
        } finally {
          clearTimeout(providerDeadline.timer);
        }
      }

      throw new Error("OpenAI image generation exhausted its attempt loop without a result.");
    } catch (error) {
      if (
        (input.signal.aborted || error instanceof GeneratedCardImageDeadlineExceededError)
        && providerResultRecorded === false
      ) {
        providerObservation?.updateOtelSpanAttributes({
          output: {
            result: error instanceof GeneratedCardImageDeadlineExceededError
              ? "deadline"
              : "aborted",
          },
        });
        providerResultRecorded = true;
      }
      throw error;
    } finally {
      providerObservation?.end();
    }
  }
}

export function createOpenAIGeneratedCardImageProvider(): OpenAIGeneratedCardImageProvider {
  return new OpenAIGeneratedCardImageProvider(getOpenAIClient());
}
