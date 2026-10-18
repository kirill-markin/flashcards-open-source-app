import { transactionWithUserScope } from "../database";
import { createBrowserGuestTrialOperation, reserveNewBrowserGuestTrialOperation,
  resolveFundedBrowserGuestTrial, startBrowserGuestTrialProvider } from "../aiUsage/browserGuestTrial/admission";
import { readGuestPcmAudio } from "../chat/guestPcmAudio";
import { Hono } from "hono";
import { assertGuestRequestSupportsProduct } from "../guestAuth/webPlatform";
import { assertAiConsentReceiptActive } from "../aiConsent";
import { readAiConsentIdHeader } from "../aiConsent/input";
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
import { readUserOpenAIApiKeyHeader } from "../chat/userOpenAIApiKey";
import { HttpError } from "../shared/errors";
import {
  appendAiUsageEvent,
  resolveAiUsageTierForFacts,
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
  resolveAiUsageTierForFactsFn?: typeof resolveAiUsageTierForFacts;
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
  const resolveAiUsageTierForFactsFn = options.resolveAiUsageTierForFactsFn ?? resolveAiUsageTierForFacts;
  const appendAiUsageEventFn = options.appendAiUsageEventFn ?? appendAiUsageEvent;

  app.post("/chat/transcriptions", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const userOpenAIApiKey = readUserOpenAIApiKeyHeader(context.req.raw);
    assertGuestRequestSupportsProduct(requestContext);
    const browserGuestTrial = resolveFundedBrowserGuestTrial(requestContext, userOpenAIApiKey !== null);
    const aiConsentId = readAiConsentIdHeader(context.req.raw);
    await assertAiConsentReceiptActive(requestContext.userId, aiConsentId);
    const upload = await parseChatTranscriptionUpload(context.req.raw);
    const workspaceId = await resolveAccessibleAiDictationWorkspaceIdFn(requestContext, upload.workspaceId);
    const sessionId = await resolveChatTranscriptionSessionId(
      requestContext.userId,
      workspaceId,
      upload.sessionId,
      getRecoveredChatSessionSnapshotFn,
    );
    const tierAtCall = await resolveAiUsageTierForFactsFn(
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
        tierAtCall,
        counters,
        imageCount: null,
        imageSize: null,
        imageQuality: null,
        userSuppliedKey: userOpenAIApiKey !== null,
      });
    };

    const trialOperation = browserGuestTrial === undefined ? undefined : await (async () => {
      if (upload.operationId === undefined || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(upload.operationId)) {
        throw new HttpError(400, "Guest dictation requires a lowercase UUID operationId.", "BROWSER_GUEST_AI_TRIAL_OPERATION_ID_INVALID");
      }
      const audio = await readGuestPcmAudio(upload.file);
      const operation = createBrowserGuestTrialOperation("dictation", upload.operationId, audio.seconds, audio.bytes);
      await transactionWithUserScope({ userId: requestContext.userId }, async (executor) => {
        await reserveNewBrowserGuestTrialOperation(executor, browserGuestTrial, operation);
      });
      return operation;
    })();
    let transcription: ChatTranscriptionResult;
    try {
      await assertAiConsentReceiptActive(requestContext.userId, aiConsentId);
      transcription = await transcribeAudioFn(upload, {
        aiConsent: { userId: requestContext.userId, eventId: aiConsentId },
        beforeProviderCall: browserGuestTrial === undefined || trialOperation === undefined ? undefined
          : async () => startBrowserGuestTrialProvider(browserGuestTrial, trialOperation),
        requestId: context.get("requestId"),
        sessionId,
        userOpenAIApiKey,
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

    return context.json({
      text: transcription.text,
      sessionId,
    } satisfies ChatTranscriptionRouteResponse);
  });

  return app;
}
