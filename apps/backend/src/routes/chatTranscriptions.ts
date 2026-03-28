/**
 * Route factory for the shared backend-owned dictation endpoint.
 * The endpoint stays thin: it authenticates, enforces guest quota, and delegates upload parsing and transcription to the chat module.
 */
import { Hono } from "hono";
import { getRecoveredChatSessionSnapshot } from "../chat/runs";
import {
  parseChatTranscriptionUpload,
  transcribeChatAudioUpload,
  type ChatTranscriptionRequestContext,
  type ChatTranscriptionUpload,
} from "../chat/transcriptions";
import { ChatSessionNotFoundError } from "../chat/store";
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
  getRecoveredChatSessionSnapshotFn?: typeof getRecoveredChatSessionSnapshot;
  transcribeAudioFn?: (
    upload: ChatTranscriptionUpload,
    requestContext: ChatTranscriptionRequestContext,
  ) => Promise<string>;
}>;

type ChatTranscriptionRouteResponse = Readonly<{
  text: string;
  sessionId: string;
}>;

async function resolveChatTranscriptionSessionId(
  userId: string,
  workspaceId: string,
  requestedSessionId: string | undefined,
  getRecoveredChatSessionSnapshotFn: typeof getRecoveredChatSessionSnapshot,
): Promise<string> {
  try {
    return await getRecoveredChatSessionSnapshotFn(userId, workspaceId, requestedSessionId)
      .then((snapshot) => snapshot.sessionId);
  } catch (error) {
    if (requestedSessionId !== undefined && error instanceof ChatSessionNotFoundError) {
      return getRecoveredChatSessionSnapshotFn(userId, workspaceId)
        .then((snapshot) => snapshot.sessionId);
    }

    throw error;
  }
}

/**
 * Mounts the shared `/chat/transcriptions` endpoint used by web and mobile dictation flows.
 */
export function createChatTranscriptionsRoutes(options: ChatTranscriptionsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const getRecoveredChatSessionSnapshotFn = options.getRecoveredChatSessionSnapshotFn ?? getRecoveredChatSessionSnapshot;
  const transcribeAudioFn = options.transcribeAudioFn
    ?? (async (upload, requestContext) => transcribeChatAudioUpload(upload, requestContext));

  app.post("/chat/transcriptions", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const upload = await parseChatTranscriptionUpload(context.req.raw);
    const workspaceId = requestContext.selectedWorkspaceId;
    if (workspaceId === null) {
      throw new HttpError(403, "A workspace must be selected before using AI dictation.", "AI_WORKSPACE_REQUIRED");
    }
    const sessionId = await resolveChatTranscriptionSessionId(
      requestContext.userId,
      workspaceId,
      upload.sessionId,
      getRecoveredChatSessionSnapshotFn,
    );
    const text = await startChatTranscriptionObservation(
      {
        requestId: context.get("requestId"),
        userId: requestContext.userId,
        sessionId,
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

        const transcribedText = await transcribeAudioFn(upload, {
          requestId: context.get("requestId"),
          sessionId,
        });

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
    return context.json({
      text,
      sessionId,
    } satisfies ChatTranscriptionRouteResponse);
  });

  return app;
}
