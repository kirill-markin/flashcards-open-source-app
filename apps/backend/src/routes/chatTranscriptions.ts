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
    if (requestContext.transport === "guest") {
      await assertGuestAiLimitAllowsTranscription(
        requestContext.userId,
        upload.file.size,
        new Date(),
      );
    }
    const text = await transcribeAudioFn(upload);
    if (requestContext.transport === "guest") {
      await recordGuestDictationUsage(
        requestContext.userId,
        upload.file.size,
        new Date(),
      );
    }
    return context.json({ text });
  });

  return app;
}
