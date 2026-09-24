/**
 * Route factory for the shared backend-owned dictation endpoint.
 * The endpoint stays thin: it authenticates, enforces the caller's monthly AI allowance, meters the provider call, and delegates upload parsing and transcription to the chat module.
 */
import { Hono } from "hono";
import { isChatSessionRequestedSessionIdConflictError } from "../chat/errors";
import { getRecoveredChatSessionSnapshot } from "../chat/runs";
import {
  CHAT_TRANSCRIPTION_MODEL,
  ChatTranscriptionEmptyTranscriptError,
  parseChatTranscriptionUpload,
  transcribeChatAudioUpload,
  type ChatTranscriptionRequestContext,
  type ChatTranscriptionResult,
  type ChatTranscriptionUpload,
} from "../chat/transcriptions";
import { HttpError } from "../shared/errors";
import { startChatTranscriptionObservation } from "../telemetry/langfuse";
import {
  appendAiUsageEvent,
  requireAiUsageAllowance,
  type AiUsageCounters,
} from "../aiUsage";
import { resolveAccountKindForTransport } from "../billing/snapshot";
import {
  loadRequestContextFromRequest,
  resolveAccessibleAiDictationWorkspaceId,
  type WorkspaceRequestContext,
} from "../server/requestContext";
import type { AppEnv } from "../server/app";

type ChatTranscriptionsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  getRecoveredChatSessionSnapshotFn?: typeof getRecoveredChatSessionSnapshot;
  resolveAccessibleAiDictationWorkspaceIdFn?: typeof resolveAccessibleAiDictationWorkspaceId;
  transcribeAudioFn?: (
    upload: ChatTranscriptionUpload,
    requestContext: ChatTranscriptionRequestContext,
  ) => Promise<ChatTranscriptionResult>;
  requireAiUsageAllowanceFn?: typeof requireAiUsageAllowance;
  appendAiUsageEventFn?: typeof appendAiUsageEvent;
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

  // First-party clients at >1.5.0 no longer omit sessionId here. Keep this
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
  const resolveAccessibleAiDictationWorkspaceIdFn = options.resolveAccessibleAiDictationWorkspaceIdFn
    ?? (options.loadRequestContextFromRequestFn === undefined
      ? resolveAccessibleAiDictationWorkspaceId
      : async (requestContext: WorkspaceRequestContext, explicitWorkspaceId): Promise<string> => {
        if (explicitWorkspaceId !== undefined) {
          return explicitWorkspaceId;
        }

        // Route tests often stub request context directly and do not exercise
        // the real workspace access path, so keep a minimal local fallback.
        // Legacy fallback for released AI clients that still omit workspaceId.
        // TODO: Remove this fallback once every supported AI client sends workspaceId.
        if (requestContext.selectedWorkspaceId === null) {
          throw new HttpError(403, "A workspace must be selected before using AI dictation.", "AI_WORKSPACE_REQUIRED");
        }

        return requestContext.selectedWorkspaceId;
      });
  const transcribeAudioFn = options.transcribeAudioFn
    ?? (async (upload, requestContext) => transcribeChatAudioUpload(upload, requestContext));
  const requireAiUsageAllowanceFn = options.requireAiUsageAllowanceFn ?? requireAiUsageAllowance;
  const appendAiUsageEventFn = options.appendAiUsageEventFn ?? appendAiUsageEvent;

  app.post("/chat/transcriptions", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const upload = await parseChatTranscriptionUpload(context.req.raw);
    const workspaceId = await resolveAccessibleAiDictationWorkspaceIdFn(requestContext, upload.workspaceId);
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
        // Checked for every caller, with no branch on who they are: the resolved allowance decides,
        // and an uncapped one admits the call without a count to compare.
        const allowance = await requireAiUsageAllowanceFn(
          requestContext.userId,
          resolveAccountKindForTransport(requestContext.transport),
          new Date(),
        );

        const appendDictationUsageFact = async (
          counters: AiUsageCounters | null,
        ): Promise<void> => {
          await appendAiUsageEventFn({
            userId: requestContext.userId,
            workspaceId,
            occurredAt: new Date(),
            surface: "dictation",
            provider: "openai",
            modelId: CHAT_TRANSCRIPTION_MODEL,
            requestId: context.get("requestId"),
            tierAtCall: allowance.tier,
            counters,
            imageCount: null,
            imageSize: null,
            imageQuality: null,
          });
        };

        let transcription: ChatTranscriptionResult;
        try {
          transcription = await transcribeAudioFn(upload, {
            requestId: context.get("requestId"),
            sessionId,
          });
        } catch (error) {
          // A transcript that came back empty is still a call the provider was paid for, and it carries
          // its counters out with it, so the fact is appended here exactly once and the failure is
          // re-raised with the status, message and code it already had.
          if (error instanceof ChatTranscriptionEmptyTranscriptError) {
            await appendDictationUsageFact(error.usageCounters);
          }

          throw error;
        }

        await appendDictationUsageFact(transcription.usageCounters);

        return transcription.text;
      },
    );
    return context.json({
      text,
      sessionId,
    } satisfies ChatTranscriptionRouteResponse);
  });

  return app;
}
