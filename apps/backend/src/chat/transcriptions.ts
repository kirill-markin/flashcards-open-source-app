/**
 * Backend-owned audio transcription helpers used by dictation before the user reviews and sends the draft.
 * The upload is validated and transcribed on the server so the chat surface stays resilient across reconnects.
 */
import { Buffer } from "node:buffer";
import { toFile } from "openai";
import { HttpError } from "../errors";
import { getObservedOpenAIClient } from "./openai/client";
import {
  classifyAIEndpointFailure,
  getAIProviderFailureMetadata,
  makeAIEndpointNotConfiguredError,
} from "./legacy/aiAvailabilityErrors";

export type ChatTranscriptionSource = "android" | "ios" | "web";

type OpenAITranscriptionClient = Readonly<{
  audio: Readonly<{
    transcriptions: Readonly<{
      create: (
        body: Readonly<{
          file: File;
          model: "gpt-4o-transcribe";
        }>,
      ) => Promise<Readonly<{ text: string }>>;
    }>;
  }>;
}>;

export type ChatTranscriptionUpload = Readonly<{
  file: File;
  source: ChatTranscriptionSource;
  sessionId?: string;
}>;

export type ChatTranscriptionRequestContext = Readonly<{
  requestId: string;
  sessionId: string;
}>;

const CHAT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
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

type ChatTranscriptionFailureDetails = Readonly<{
  requestId: string;
  sessionId: string;
  source: ChatTranscriptionSource;
  fileName: string;
  fileSize: number;
  fileExtension: string | null;
  provider: string;
  mediaType: string;
  upstreamStatus: number | null;
  upstreamMessage: string | null;
  upstreamRequestId: string | null;
  error: string;
}>;

type ChatTranscriptionDependencies = Readonly<{
  getObservedOpenAIClient: () => OpenAITranscriptionClient;
}>;

/**
 * Creates the OpenAI transcription client used by the shared dictation path.
 */
function createOpenAITranscriptionClient(): OpenAITranscriptionClient {
  return getObservedOpenAIClient() as unknown as OpenAITranscriptionClient;
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

  return {
    file: fileValue,
    source: sourceValue,
    sessionId,
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
  console.error(JSON.stringify({
    domain: "chat",
    action: "chat_transcription_failed",
    requestId: details.requestId,
    sessionId: details.sessionId,
    source: details.source,
    provider: details.provider,
    fileName: details.fileName,
    fileSize: details.fileSize,
    fileExtension: details.fileExtension,
    mediaType: details.mediaType,
    upstreamStatus: details.upstreamStatus,
    upstreamMessage: details.upstreamMessage,
    upstreamRequestId: details.upstreamRequestId,
    error: details.error,
  }));
}

const DEFAULT_CHAT_TRANSCRIPTION_DEPENDENCIES: ChatTranscriptionDependencies = {
  getObservedOpenAIClient: createOpenAITranscriptionClient,
};

/**
 * Sends a validated audio upload to OpenAI and returns the trimmed transcript text.
 */
export async function transcribeChatAudioUpload(
  upload: ChatTranscriptionUpload,
  requestContext: ChatTranscriptionRequestContext,
  client?: OpenAITranscriptionClient,
): Promise<string> {
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
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw makeAIEndpointNotConfiguredError("transcription");
  }

  try {
    const transcriptionClient = client ?? dependencies.getObservedOpenAIClient();
    const buffer = Buffer.from(await upload.file.arrayBuffer());
    const file = await toFile(buffer, upload.file.name, { type: upload.file.type });
    // OpenAI transcription requests do not expose an end-user safety identifier field.
    const result = await transcriptionClient.audio.transcriptions.create({
      file,
      model: CHAT_TRANSCRIPTION_MODEL,
    });
    const trimmedText = result.text.trim();
    if (trimmedText === "") {
      throw new Error("Transcription response was empty");
    }

    return trimmedText;
  } catch (error) {
    const metadata = getAIProviderFailureMetadata(error);
    logChatTranscriptionFailure({
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      source: upload.source,
      provider: "openai",
      fileName: upload.file.name,
      fileSize: upload.file.size,
      fileExtension: normalizeFileExtension(upload.file.name),
      mediaType: upload.file.type.trim().toLowerCase(),
      upstreamStatus: metadata.upstreamStatus,
      upstreamMessage: metadata.upstreamMessage,
      upstreamRequestId: metadata.upstreamRequestId,
      error: metadata.originalMessage,
    });

    if (isInvalidAudioFailure(error)) {
      throw new HttpError(
        422,
        CHAT_TRANSCRIPTION_INVALID_AUDIO_ERROR_MESSAGE,
        "CHAT_TRANSCRIPTION_INVALID_AUDIO",
      );
    }

    const normalizedFailure = classifyAIEndpointFailure("transcription", error, "openai");
    throw new HttpError(
      normalizedFailure.statusCode,
      normalizedFailure.message,
      normalizedFailure.code,
    );
  }
}
