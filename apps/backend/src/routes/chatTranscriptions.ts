/**
 * Route factory for the shared backend-owned dictation endpoint.
 * The endpoint stays thin: it authenticates, enforces guest quota, and delegates upload parsing and transcription to the chat module.
 */
import { Hono } from "hono";
import {
  parseChatTranscriptionUpload,
  transcribeChatAudioUpload,
  type ChatTranscriptionUpload,
} from "../chat/transcriptions";
import { HttpError } from "../errors";
import { startChatTranscriptionObservation } from "../telemetry/langfuse";
import {
  assertGuestAiLimitAllowsTranscription,
  recordGuestDictationUsage,
} from "../guestAiQuota";
import { loadRequestContextFromRequest } from "../server/requestContext";
import type { AppEnv } from "../app";

type ChatTranscriptionsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  transcribeAudioFn?: (upload: ChatTranscriptionUpload) => Promise<string>;
}>;

/**
 * Mounts the shared `/chat/transcriptions` endpoint used by web and mobile dictation flows.
 */
export function createChatTranscriptionsRoutes(options: ChatTranscriptionsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const transcribeAudioFn = options.transcribeAudioFn ?? (async (upload) => transcribeChatAudioUpload(upload));

  app.post("/chat/transcriptions", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const upload = await parseChatTranscriptionUpload(context.req.raw);
    const text = await startChatTranscriptionObservation(
      {
        requestId: context.get("requestId"),
        userId: requestContext.userId,
        source: upload.source,
        fileName: upload.file.name,
        mediaType: upload.file.type,
        fileSize: upload.file.size,
      },
      async (): Promise<string> => {
        if (requestContext.transport === "guest") {
          await assertGuestAiLimitAllowsTranscription(
            requestContext.userId,
            upload.file.size,
            new Date(),
          );
        }

        const transcribedText = await transcribeAudioFn(upload);

        if (requestContext.transport === "guest") {
          await recordGuestDictationUsage(
            requestContext.userId,
            upload.file.size,
            new Date(),
          );
        }

        return transcribedText;
      },
    );
    return context.json({ text });
  });

  return app;
}
