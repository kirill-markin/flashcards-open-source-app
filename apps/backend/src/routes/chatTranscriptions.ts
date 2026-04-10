/**
 * Route factory for the shared backend-owned dictation endpoint.
 * The endpoint stays thin: it authenticates, enforces guest quota, and delegates upload parsing and transcription to the chat module.
 */
import { Hono } from "hono";
import { isChatSessionRequestedSessionIdConflictError } from "../chat/errors";
import { getRecoveredChatSessionSnapshot } from "../chat/runs";
import {
  parseChatTranscriptionUpload,
  transcribeChatAudioUpload,
  type ChatTranscriptionRequestContext,
  type ChatTranscriptionUpload,
} from "../chat/transcriptions";
import { HttpError } from "../errors";
import { startChatTranscriptionObservation } from "../telemetry/langfuse";
import {
  assertGuestAiLimitAllowsTranscription,
  recordGuestDictationUsage,
} from "../guestAiQuota";
import {
  loadRequestContextFromRequest,
  requireAccessibleSelectedWorkspaceIdForAiDictation,
} from "../server/requestContext";
import type { AppEnv } from "../app";

type ChatTranscriptionsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  getRecoveredChatSessionSnapshotFn?: typeof getRecoveredChatSessionSnapshot;
  requireAccessibleSelectedWorkspaceIdForAiDictationFn?: typeof requireAccessibleSelectedWorkspaceIdForAiDictation;
  transcribeAudioFn?: (
    upload: ChatTranscriptionUpload,
    requestContext: ChatTranscriptionRequestContext,
  ) => Promise<string>;
}>;

type ChatTranscriptionRouteResponse = Readonly<{
  text: string;
  sessionId: string;
}>;

const chatSessionIdConflictCode = "CHAT_SESSION_ID_CONFLICT";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveChatTranscriptionSessionId(
  userId: string,
  workspaceId: string,
  requestedSessionId: string | undefined,
  getRecoveredChatSessionSnapshotFn: typeof getRecoveredChatSessionSnapshot,
): Promise<string> {
  if (requestedSessionId !== undefined && !UUID_PATTERN.test(requestedSessionId)) {
    throw new HttpError(400, "sessionId must be a UUID", "CHAT_SESSION_ID_INVALID");
  }

  // First-party clients at 1.1.3 no longer omit sessionId here. Keep this
  // legacy session-less path temporarily for older released clients, then
  // remove it in a future legacy chat cleanup.
  try {
    const snapshot = await getRecoveredChatSessionSnapshotFn(userId, workspaceId, requestedSessionId);
    return snapshot.sessionId;
  } catch (error) {
    if (isChatSessionRequestedSessionIdConflictError(error)) {
      throw new HttpError(
        409,
        "Requested chat session id is already in use.",
        chatSessionIdConflictCode,
      );
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
  const requireAccessibleSelectedWorkspaceIdForAiDictationFn = options.requireAccessibleSelectedWorkspaceIdForAiDictationFn
    ?? (options.loadRequestContextFromRequestFn === undefined
      ? requireAccessibleSelectedWorkspaceIdForAiDictation
      : async (requestContext): Promise<string> => {
        // Route tests often stub request context directly and do not exercise
        // the real workspace access path, so keep a minimal local fallback.
        if (requestContext.selectedWorkspaceId === null) {
          throw new HttpError(403, "A workspace must be selected before using AI dictation.", "AI_WORKSPACE_REQUIRED");
        }

        return requestContext.selectedWorkspaceId;
      });
  const transcribeAudioFn = options.transcribeAudioFn
    ?? (async (upload, requestContext) => transcribeChatAudioUpload(upload, requestContext));

  app.post("/chat/transcriptions", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const upload = await parseChatTranscriptionUpload(context.req.raw);
    const workspaceId = await requireAccessibleSelectedWorkspaceIdForAiDictationFn(requestContext);
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
