/**
 * Backend-owned audio transcription helpers used by dictation before the user reviews and sends the draft.
 * The upload is validated and transcribed on the server so the chat surface stays resilient across reconnects.
 */
import { Buffer } from "node:buffer";
import { toFile } from "openai";
import {
  toOpenAITranscriptionUsageCounters,
  type AiUsageCounters,
  type OpenAITranscriptionUsage,
} from "../aiUsage";
import { HttpError } from "../shared/errors";
import {
  addBackendBreadcrumb,
  captureBackendWarning,
  createBackendObservationScope,
  getBackendErrorLogDetails,
  type ChatTranscriptionFailureDetails,
} from "../observability/sentry";
import { expectWorkspaceIdString } from "../server/requestParsing";
import { createObservedUserOpenAIClient, getObservedOpenAIClient } from "./openai/client";
import {
  classifyChatTranscriptionFailure,
  getAIProviderFailureMetadata,
  makeChatTranscriptionNotConfiguredError,
  makeOwnOpenAIKeyProviderError,
  readOwnOpenAIKeyProviderErrorText,
} from "./providerFailure";
import type { UserOpenAIApiKey } from "./userOpenAIApiKey";

export type ChatTranscriptionSource = "android" | "ios" | "web";

type OpenAITranscriptionClient = Readonly<{
  audio: Readonly<{
    transcriptions: Readonly<{
      create: (
        body: Readonly<{
          file: File;
          model: "gpt-4o-transcribe";
        }>,
      ) => Promise<Readonly<{
        text: string;
        // Optional because the provider decides whether to report usage for a call, and a call it
        // reports nothing for is still metered, with null counters. The field and its two shapes are
        // the pinned SDK's own `Transcription.usage`; which of them this model returns is recorded in
        // `apps/backend/src/aiUsage/openaiUsage.ts`.
        usage?: OpenAITranscriptionUsage;
      }>>;
    }>;
  }>;
}>;

export type ChatTranscriptionUpload = Readonly<{
  file: File;
  source: ChatTranscriptionSource;
  sessionId?: string;
  workspaceId?: string;
}>;

export type ChatTranscriptionRequestContext = Readonly<{
  requestId: string;
  sessionId: string;
  /** The person's own OpenAI key, which pays for this one transcription instead of the platform key. */
  userOpenAIApiKey: UserOpenAIApiKey | null;
}>;

/**
 * The transcript and what the provider charged for producing it. The counters travel back to the caller
 * rather than being appended here, because this module knows the provider and not who is paying: the
 * route holds the person, the workspace and the resolved tier a usage fact has to carry.
 */
export type ChatTranscriptionResult = Readonly<{
  text: string;
  usageCounters: AiUsageCounters | null;
}>;

/**
 * An empty transcript, carrying what the provider already charged for producing it. Silence or no speech
 * is an ordinary outcome of tapping the mic rather than a provider failure, and the call is paid for
 * either way, so the counters leave this module with the failure and the route appends the fact before
 * it answers. The status, the message and the code are the ones this failure has always carried, so no
 * released client sees a new shape.
 */
export class ChatTranscriptionEmptyTranscriptError extends HttpError {
  readonly usageCounters: AiUsageCounters | null;

  constructor(
    usageCounters: AiUsageCounters | null,
    statusCode: number,
    message: string,
    code: string,
  ) {
    super(statusCode, message, code);
    this.usageCounters = usageCounters;
  }
}

/**
 * The same empty transcript before it is classified. It is thrown inside the provider call's `try` so
 * that an empty transcript is logged and classified through exactly the path it already went through,
 * and only then rewritten into the exported error with its counters attached.
 */
class EmptyTranscriptTextError extends Error {
  readonly usageCounters: AiUsageCounters | null;

  constructor(usageCounters: AiUsageCounters | null) {
    super("Transcription response was empty");
    this.usageCounters = usageCounters;
  }
}

export const CHAT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const CHAT_TRANSCRIPTION_INVALID_AUDIO_ERROR_MESSAGE = "We couldn’t process that recording. Please try again.";
const SUPPORTED_AUDIO_FILE_EXTENSIONS = new Set(["m4a", "wav", "webm"]);
const SUPPORTED_AUDIO_MEDIA_TYPES = new Set([
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
]);

type ChatTranscriptionDependencies = Readonly<{
  getObservedOpenAIClient: () => OpenAITranscriptionClient;
  createObservedUserOpenAIClient: (userOpenAIApiKey: UserOpenAIApiKey) => OpenAITranscriptionClient;
}>;

/**
 * Creates the OpenAI transcription client used by the shared dictation path.
 */
function createOpenAITranscriptionClient(): OpenAITranscriptionClient {
  return getObservedOpenAIClient() as unknown as OpenAITranscriptionClient;
}

function createUserOpenAITranscriptionClient(userOpenAIApiKey: UserOpenAIApiKey): OpenAITranscriptionClient {
  return createObservedUserOpenAIClient(userOpenAIApiKey) as unknown as OpenAITranscriptionClient;
}

/**
 * Normalizes uploaded filenames so extension checks stay consistent across platforms.
 */
function normalizeFileExtension(fileName: string): string | null {
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex < 0 || extensionIndex === fileName.length - 1) {
    return null;
  }

  return fileName.slice(extensionIndex + 1).toLowerCase();
}

/**
 * Validates whether an uploaded dictation file matches the server-supported audio formats.
 */
function isSupportedAudioUpload(file: File): boolean {
  const normalizedMediaType = file.type.trim().toLowerCase();
  const normalizedExtension = normalizeFileExtension(file.name);

  return SUPPORTED_AUDIO_MEDIA_TYPES.has(normalizedMediaType)
    || (normalizedExtension !== null && SUPPORTED_AUDIO_FILE_EXTENSIONS.has(normalizedExtension));
}

/**
 * Parses and validates the multipart upload accepted by the shared dictation endpoint.
 */
export async function parseChatTranscriptionUpload(request: Request): Promise<ChatTranscriptionUpload> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data", "CHAT_TRANSCRIPTION_INVALID_MULTIPART");
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    throw new HttpError(400, "file is required", "CHAT_TRANSCRIPTION_FILE_REQUIRED");
  }

  if (fileValue.size <= 0) {
    throw new HttpError(400, "file must not be empty", "CHAT_TRANSCRIPTION_FILE_EMPTY");
  }

  if (isSupportedAudioUpload(fileValue) === false) {
    throw new HttpError(
      400,
      "Unsupported audio file type. Use m4a, wav, or webm.",
      "CHAT_TRANSCRIPTION_FILE_UNSUPPORTED",
    );
  }

  const sourceValue = formData.get("source");
  if (sourceValue !== "android" && sourceValue !== "ios" && sourceValue !== "web") {
    throw new HttpError(
      400,
      "source must be either android, ios, or web",
      "CHAT_TRANSCRIPTION_SOURCE_INVALID",
    );
  }

  const sessionValue = formData.get("sessionId");
  const sessionId = typeof sessionValue === "string" && sessionValue.trim() !== ""
    ? sessionValue.trim()
    : undefined;
  const workspaceValue = formData.get("workspaceId");
  const workspaceId = workspaceValue === null
    ? undefined
    : expectWorkspaceIdString(workspaceValue, "workspaceId");

  return {
    file: fileValue,
    source: sourceValue,
    sessionId,
    workspaceId,
  };
}

/**
 * Extracts the upstream provider message used by transcription error normalization.
 */
function getUpstreamMessage(error: unknown): string | null {
  const message = getAIProviderFailureMetadata(error).upstreamMessage;
  return message === "" ? null : message;
}

/**
 * Detects provider messages that should be exposed as invalid-audio errors to the user.
 */
function isInvalidAudioMessage(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /corrupted|unsupported|processing failed|unprocessable/i.test(message);
}

/**
 * Classifies whether a provider failure should become a user-facing invalid-audio response.
 */
function isInvalidAudioFailure(error: unknown): boolean {
  const upstreamStatus = getAIProviderFailureMetadata(error).upstreamStatus;
  if (upstreamStatus === null) {
    return false;
  }

  return [400, 415, 422, 500].includes(upstreamStatus) && isInvalidAudioMessage(getUpstreamMessage(error));
}

/**
 * Logs transcription failures with structured provider metadata for debugging.
 */
function logChatTranscriptionFailure(details: ChatTranscriptionFailureDetails): void {
  captureBackendWarning({
    action: "chat_transcription_failed",
    message: "Chat transcription failed.",
    scope: createBackendObservationScope(
      "backend-api",
      details.requestId,
      null,
      null,
      null,
      null,
      null,
      null,
      details.sessionId,
      null,
      null,
    ),
    details,
  });
}

/**
 * Logs expected invalid audio provider failures without creating Sentry warning issues.
 */
function logChatTranscriptionInvalidAudio(details: ChatTranscriptionFailureDetails): void {
  addBackendBreadcrumb({
    action: "chat_transcription_invalid_audio",
    scope: createBackendObservationScope(
      "backend-api",
      details.requestId,
      null,
      null,
      null,
      null,
      null,
      null,
      details.sessionId,
      null,
      null,
    ),
    details,
  });
}

const DEFAULT_CHAT_TRANSCRIPTION_DEPENDENCIES: ChatTranscriptionDependencies = {
  getObservedOpenAIClient: createOpenAITranscriptionClient,
  createObservedUserOpenAIClient: createUserOpenAITranscriptionClient,
};

/**
 * Sends a validated audio upload to OpenAI and returns the trimmed transcript with its provider usage.
 */
export async function transcribeChatAudioUpload(
  upload: ChatTranscriptionUpload,
  requestContext: ChatTranscriptionRequestContext,
  client?: OpenAITranscriptionClient,
): Promise<ChatTranscriptionResult> {
  return transcribeChatAudioUploadWithDependencies(
    upload,
    requestContext,
    client,
    DEFAULT_CHAT_TRANSCRIPTION_DEPENDENCIES,
  );
}

export async function transcribeChatAudioUploadWithDependencies(
  upload: ChatTranscriptionUpload,
  requestContext: ChatTranscriptionRequestContext,
  client: OpenAITranscriptionClient | undefined,
  dependencies: ChatTranscriptionDependencies,
): Promise<ChatTranscriptionResult> {
  const userOpenAIApiKey = requestContext.userOpenAIApiKey;
  const apiKey = process.env.OPENAI_API_KEY;
  if (userOpenAIApiKey === null && (apiKey === undefined || apiKey.trim() === "")) {
    throw makeChatTranscriptionNotConfiguredError();
  }

  try {
    const transcriptionClient = client
      ?? (userOpenAIApiKey === null
        ? dependencies.getObservedOpenAIClient()
        : dependencies.createObservedUserOpenAIClient(userOpenAIApiKey));
    const buffer = Buffer.from(await upload.file.arrayBuffer());
    const file = await toFile(buffer, upload.file.name, { type: upload.file.type });
    // OpenAI transcription requests do not expose an end-user safety identifier field.
    const result = await transcriptionClient.audio.transcriptions.create({
      file,
      model: CHAT_TRANSCRIPTION_MODEL,
    });
    // Read before the emptiness check, because the provider has already answered and been paid by this
    // point: an empty transcript must lose the transcript, not the fact.
    const usageCounters = toOpenAITranscriptionUsageCounters(result.usage);
    const trimmedText = result.text.trim();
    if (trimmedText === "") {
      throw new EmptyTranscriptTextError(usageCounters);
    }

    return {
      text: trimmedText,
      usageCounters,
    };
  } catch (error) {
    const metadata = getAIProviderFailureMetadata(error);
    const errorDetails = getBackendErrorLogDetails(error);
    const failureDetails: ChatTranscriptionFailureDetails = {
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      source: upload.source,
      provider: "openai",
      fileSize: upload.file.size,
      fileExtension: normalizeFileExtension(upload.file.name),
      mediaType: upload.file.type.trim().toLowerCase(),
      upstreamStatus: metadata.upstreamStatus,
      upstreamRequestId: metadata.upstreamRequestId,
      errorClass: errorDetails.errorClass,
      errorMessage: errorDetails.errorMessage,
    };

    if (isInvalidAudioFailure(error)) {
      logChatTranscriptionInvalidAudio(failureDetails);
      throw new HttpError(
        422,
        CHAT_TRANSCRIPTION_INVALID_AUDIO_ERROR_MESSAGE,
        "CHAT_TRANSCRIPTION_INVALID_AUDIO",
      );
    }

    logChatTranscriptionFailure(failureDetails);
    // OpenAI's answer to a call made with the person's own key is theirs to act on, so it is passed on.
    const ownKeyProviderErrorText = userOpenAIApiKey === null ? null : readOwnOpenAIKeyProviderErrorText(error);
    if (ownKeyProviderErrorText !== null) {
      throw makeOwnOpenAIKeyProviderError(ownKeyProviderErrorText);
    }

    const normalizedFailure = classifyChatTranscriptionFailure(error);
    if (error instanceof EmptyTranscriptTextError) {
      throw new ChatTranscriptionEmptyTranscriptError(
        error.usageCounters,
        normalizedFailure.statusCode,
        normalizedFailure.message,
        normalizedFailure.code,
      );
    }

    throw new HttpError(
      normalizedFailure.statusCode,
      normalizedFailure.message,
      normalizedFailure.code,
    );
  }
}
