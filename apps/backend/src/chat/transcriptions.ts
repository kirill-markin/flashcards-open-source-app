import { Buffer } from "node:buffer";
import OpenAI, { toFile } from "openai";
import { HttpError } from "../errors";

export type ChatTranscriptionSource = "ios" | "web";

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
}>;

const CHAT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const CHAT_TRANSCRIPTION_NETWORK_ERROR_MESSAGE = "There is a network problem. Fix it and try again.";
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

function createOpenAITranscriptionClient(): OpenAITranscriptionClient {
  return new OpenAI();
}

function normalizeFileExtension(fileName: string): string | null {
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex < 0 || extensionIndex === fileName.length - 1) {
    return null;
  }

  return fileName.slice(extensionIndex + 1).toLowerCase();
}

function isSupportedAudioUpload(file: File): boolean {
  const normalizedMediaType = file.type.trim().toLowerCase();
  const normalizedExtension = normalizeFileExtension(file.name);

  return SUPPORTED_AUDIO_MEDIA_TYPES.has(normalizedMediaType)
    || (normalizedExtension !== null && SUPPORTED_AUDIO_FILE_EXTENSIONS.has(normalizedExtension));
}

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
  if (sourceValue !== "ios" && sourceValue !== "web") {
    throw new HttpError(400, "source must be either ios or web", "CHAT_TRANSCRIPTION_SOURCE_INVALID");
  }

  return {
    file: fileValue,
    source: sourceValue,
  };
}

function logChatTranscriptionFailure(source: ChatTranscriptionSource, error: unknown): void {
  console.error(JSON.stringify({
    domain: "chat",
    action: "chat_transcription_failed",
    source,
    error: error instanceof Error ? error.message : String(error),
  }));
}

export async function transcribeChatAudioUpload(
  upload: ChatTranscriptionUpload,
  client?: OpenAITranscriptionClient,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new HttpError(500, "OPENAI_API_KEY environment variable is not set");
  }

  try {
    const transcriptionClient = client ?? createOpenAITranscriptionClient();
    const buffer = Buffer.from(await upload.file.arrayBuffer());
    const file = await toFile(buffer, upload.file.name, { type: upload.file.type });
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
    logChatTranscriptionFailure(upload.source, error);
    throw new HttpError(
      503,
      CHAT_TRANSCRIPTION_NETWORK_ERROR_MESSAGE,
      "CHAT_TRANSCRIPTION_UNAVAILABLE",
    );
  }
}
