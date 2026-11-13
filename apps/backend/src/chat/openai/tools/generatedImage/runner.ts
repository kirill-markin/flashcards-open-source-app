import type { resolveAiUsageTierForFacts } from "../../../../aiUsage";
import type { BrowserGuestTrialContext } from "../../../../aiUsage/browserGuestTrial/policy";
import type { hasCognitoIdentityMappingForUser } from "../../../../auth/userIdentities";
import { resolveAccountKindForSignedInAuth } from "../../../../billing/snapshot";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../../../database/transient";
import { GeneratedMediaPromotionStorageTransientError } from "../../../../mediaAssets/storage";
import { HttpError } from "../../../../shared/errors";
import type { ensureAIChatSyncReplicaWithDeadline } from "../../../../sync/identity/aiChatIdentity";
import type { generateCardImage, GeneratedCardImageObservationContext } from "../../../cardImages";
import { isOpenAIImageGenerationProviderError } from "../../../cardImages/provider/openaiAdapter";
import {
  GeneratedCardImageDeadlineExceededError,
  GeneratedCardImageGenerationLimitReachedError,
  GeneratedCardImageProviderOutcomeUnknownError,
  GeneratedCardImageStagingOutcomeUnknownError,
} from "../../../cardImages/providerTypes";
import { readOwnOpenAIKeyProviderErrorText } from "../../../providerFailure";
import { InactiveChatRunClaimError, type ChatRunClaimToken } from "../../../runs";
import type { UserOpenAIApiKey } from "../../../userOpenAIApiKey";
import {
  maximumGeneratedCardImageAttemptsPerRun,
  type bindGeneratedCardImageAttemptPayload,
  type reserveGeneratedCardImageAttempt,
} from "../generatedImageAttemptBudget";
import type { ExecutedChatToolCall } from "../tools";
import { GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR, GENERATED_IMAGE_TOOL_NAME } from "./contract";

export type GeneratedImageToolContext = Readonly<{
  aiConsentId?: string | null;
  runId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  claimToken: ChatRunClaimToken;
  operationKey: string;
  browserGuestTrial?: BrowserGuestTrialContext;
  generatedImageEligible: boolean;
  signal: AbortSignal | null;
  generatedImageOperationDeadlineMs: number;
  userOpenAIApiKey: UserOpenAIApiKey | null;
  generatedImageObservationContext: GeneratedCardImageObservationContext;
}>;

export type GeneratedImageToolDependencies = Readonly<{
  reserveGeneratedCardImageAttempt: typeof reserveGeneratedCardImageAttempt;
  bindGeneratedCardImageAttemptPayload: typeof bindGeneratedCardImageAttemptPayload;
  hasCognitoIdentityMappingForUser: typeof hasCognitoIdentityMappingForUser;
  resolveAiUsageTierForFacts: typeof resolveAiUsageTierForFacts;
  ensureAIChatSyncReplicaWithDeadline: typeof ensureAIChatSyncReplicaWithDeadline;
  generateCardImage: typeof generateCardImage;
}>;

type GeneratedImageToolSafeErrorCode = "MEDIA_ASSET_STORAGE_UNAVAILABLE";

function getGeneratedImageToolSafeErrorCode(
  error: unknown,
): GeneratedImageToolSafeErrorCode | null {
  return error instanceof GeneratedMediaPromotionStorageTransientError
    && error.constructor === GeneratedMediaPromotionStorageTransientError
    && error.code === "S3_TRANSIENT"
    ? "MEDIA_ASSET_STORAGE_UNAVAILABLE"
    : null;
}

type GeneratedImageExecutionState =
  Omit<
    ExecutedChatToolCall,
    "output" | "sqlTelemetry" | "toolErrorClass" | "modelContent"
  >;

function createGeneratedImageResult(
  payload: Readonly<Record<string, unknown>>,
  execution: GeneratedImageExecutionState,
): ExecutedChatToolCall {
  return {
    output: JSON.stringify({ tool: GENERATED_IMAGE_TOOL_NAME, ...payload }),
    ...execution,
    sqlTelemetry: null,
    toolErrorClass: null,
    modelContent: null,
  };
}

function createGeneratedImageErrorResult(
  code: string,
  retryable: boolean,
  attempt: number | null,
  shouldInvalidateMainContent: boolean,
  stopReason: ExecutedChatToolCall["stopReason"],
  details: Readonly<Record<string, unknown>>,
): ExecutedChatToolCall {
  return createGeneratedImageResult(
    { ok: false, code, retryable, ...(attempt === null ? {} : { attempt }), ...details },
    {
      succeeded: false,
      isMutating: false,
      shouldInvalidateMainContent,
      stopReason,
    },
  );
}

/**
 * What the model reads beside an error code to tell the user what happened and what to do next.
 * `run_inactive` and `deadline_reached` end the turn before the model sees the result, so they carry none.
 */
const generatedImageErrorMessages = {
  sign_in_required: "Generating card images needs a signed-in account; ask the user to sign in.",
  invalid_arguments: "The tool arguments did not match the tool's schema; correct them before calling again.",
  card_not_found: "The card no longer exists, possibly deleted after it was read; look it up again before retrying.",
  MEDIA_ASSET_STORAGE_UNAVAILABLE: "Image storage was briefly unavailable on our side; trying again later should work.",
  provider_unavailable: "OpenAI's image service stayed unavailable or rate-limited through our retries; this is temporary, so the user can try again later.",
  moderation_blocked: "OpenAI's safety system blocked this image; rephrase the image idea so it avoids the flagged categories.",
  provider_permission_denied: "Image generation hit a permission problem on our side; it is not the user's fault and not something they can fix, so they can only try again later.",
  provider_failed: "OpenAI could not generate this image; the user can try again later or with a different image idea.",
} as const;

const generatedImageAttemptLimitMessage = `This reply has used all ${maximumGeneratedCardImageAttemptsPerRun} image attempts, failed ones included. The user's next message starts a new set of attempts.`;

function createGenerationLimitMessage(
  error: GeneratedCardImageGenerationLimitReachedError,
  userOpenAIApiKey: UserOpenAIApiKey | null,
): string {
  if (userOpenAIApiKey !== null) {
    return `This workspace's monthly limit of ${error.limit} generated card images, which applies when the user's own OpenAI key is used, is used up; it resets at ${error.resetsAt}.`;
  }
  const exhaustedLimit = error.ceiling === "daily"
    ? `The daily limit of ${error.limit} generated card images`
    : `This workspace's monthly limit of ${error.limit} generated card images`;
  return `${exhaustedLimit} is used up; it resets at ${error.resetsAt}. Adding the user's own OpenAI key in Settings raises the image limit.`;
}

type GeneratedImageOperationSignals = Readonly<{
  operation: AbortSignal;
  deadline: AbortSignal;
}>;

function createOperationSignals(
  runSignal: AbortSignal | null,
  operationDeadlineMs: number,
): GeneratedImageOperationSignals {
  const remainingMs = operationDeadlineMs - Date.now();
  const deadlineSignal = remainingMs <= 0
    ? AbortSignal.abort(new GeneratedCardImageDeadlineExceededError(null))
    : AbortSignal.timeout(remainingMs);
  return {
    operation: runSignal === null
      ? deadlineSignal
      : AbortSignal.any([runSignal, deadlineSignal]),
    deadline: deadlineSignal,
  };
}

/**
 * An expected product outcome comes back as an `{ ok: false, code }` result, so the turn stays alive
 * and the model can recover; a non-null `stopReason` ends the turn before the model sees the result
 * (`executeToolCalls` in `apps/backend/src/chat/openai/loop/modelCall.ts`), and a rethrow ends the run.
 */
export async function executeGeneratedImageToolCall(
  rawArguments: string,
  context: GeneratedImageToolContext,
  dependencies: GeneratedImageToolDependencies,
): Promise<ExecutedChatToolCall> {
  context.signal?.throwIfAborted();
  if (context.generatedImageEligible === false) {
    return createGeneratedImageErrorResult(
      "sign_in_required",
      false,
      null,
      false,
      null,
      { message: generatedImageErrorMessages.sign_in_required },
    );
  }
  const operationSignals = createOperationSignals(
    context.signal,
    context.generatedImageOperationDeadlineMs,
  );
  const operationSignal = operationSignals.operation;
  let attempt: number | null = null;
  try {
    operationSignal.throwIfAborted();
    const reservation = await dependencies.reserveGeneratedCardImageAttempt({
      userId: context.userId,
      workspaceId: context.workspaceId,
      runId: context.runId,
      sessionId: context.sessionId,
      claimToken: context.claimToken,
      operationKey: context.operationKey,
      databaseDeadlineAtMs: context.generatedImageOperationDeadlineMs,
    });
    operationSignal.throwIfAborted();
    if (reservation.status === "run_inactive") {
      return createGeneratedImageErrorResult("run_inactive", false, null, false, "run_inactive", {});
    }
    if (reservation.status === "limit_reached") {
      return createGeneratedImageErrorResult("limit_reached", false, null, false, null, {
        limit: maximumGeneratedCardImageAttemptsPerRun,
        message: generatedImageAttemptLimitMessage,
      });
    }
    attempt = reservation.attempt;

    let immutablePayload = reservation.payload;
    if (immutablePayload === null) {
      let rawArgumentsValue: unknown;
      try {
        rawArgumentsValue = JSON.parse(rawArguments);
      } catch {
        return createGeneratedImageErrorResult(
          "invalid_arguments",
          reservation.attempt < maximumGeneratedCardImageAttemptsPerRun,
          reservation.attempt,
          false,
          null,
          { message: generatedImageErrorMessages.invalid_arguments },
        );
      }
      const parsed = GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR.safeParse(rawArgumentsValue);
      if (parsed.success === false) {
        return createGeneratedImageErrorResult(
          "invalid_arguments",
          reservation.attempt < maximumGeneratedCardImageAttemptsPerRun,
          reservation.attempt,
          false,
          null,
          { message: generatedImageErrorMessages.invalid_arguments },
        );
      }
      immutablePayload = await dependencies.bindGeneratedCardImageAttemptPayload({
        userId: context.userId,
        workspaceId: context.workspaceId,
        runId: context.runId,
        sessionId: context.sessionId,
        claimToken: context.claimToken,
        operationKey: context.operationKey,
        attempt: reservation.attempt,
        payload: parsed.data,
        databaseDeadlineAtMs: context.generatedImageOperationDeadlineMs,
      });
      operationSignal.throwIfAborted();
    }

    const signedIn = await dependencies.hasCognitoIdentityMappingForUser(
      context.userId, context.generatedImageOperationDeadlineMs,
    );
    operationSignal.throwIfAborted();
    if (signedIn === false && context.userOpenAIApiKey === null && context.browserGuestTrial === undefined) {
      return createGeneratedImageErrorResult(
        "sign_in_required",
        false,
        reservation.attempt,
        false,
        null,
        { message: generatedImageErrorMessages.sign_in_required },
      );
    }

    // The tier is resolved for usage attribution. The account kind is refreshed before spending
    // because a guest may have signed in since the run started.
    const tierAtCall = await dependencies.resolveAiUsageTierForFacts(
      context.userId,
      resolveAccountKindForSignedInAuth(signedIn),
      new Date(),
    );
    operationSignal.throwIfAborted();

    const replicaId = await dependencies.ensureAIChatSyncReplicaWithDeadline(
      context.workspaceId,
      context.userId,
      "web",
      operationSignal,
      context.generatedImageOperationDeadlineMs,
    );
    operationSignal.throwIfAborted();
    const result = await dependencies.generateCardImage({
      browserGuestTrial: context.browserGuestTrial,
      runId: context.runId,
      sessionId: context.sessionId,
      claimToken: context.claimToken,
      operationKey: context.operationKey,
      userId: context.userId,
      workspaceId: context.workspaceId,
      cardId: immutablePayload.cardId,
      targetSide: immutablePayload.targetSide,
      imagePrompt: immutablePayload.imagePrompt,
      altText: immutablePayload.altText,
      replicaId,
      tierAtCall,
      userOpenAIApiKey: context.userOpenAIApiKey,
      aiConsentId: context.aiConsentId ?? null,
      observationContext: context.generatedImageObservationContext,
      signal: operationSignal,
      operationDeadlineMs: context.generatedImageOperationDeadlineMs,
    });
    const mutated = result.status === "queued";
    return createGeneratedImageResult(
      {
        ok: true,
        status: result.status,
        retryable: false,
        attempt: reservation.attempt,
        cardId: result.cardId,
        targetSide: result.targetSide,
        mediaAssetId: result.mediaAssetId,
        placeholderApplied: result.placeholderApplied,
      },
      {
        succeeded: true,
        isMutating: mutated,
        shouldInvalidateMainContent: result.placeholderApplied,
        stopReason: null,
      },
    );
  } catch (error) {
    if (
      error instanceof DatabaseCommitOutcomeUnknownError
      || error instanceof InactiveChatRunClaimError
      || error instanceof GeneratedCardImageProviderOutcomeUnknownError
      || error instanceof GeneratedCardImageStagingOutcomeUnknownError
    ) {
      throw error;
    }
    // Below the outcome-unknown rethrows, whose errors carry an outcome the run must not lose even
    // when aborted, and above the deadline branch, so that when both signals have aborted the run
    // ends by its own abort reason: a user cancellation stays cancelled instead of becoming a
    // deadline interruption (`apps/backend/src/chat/runtime/executor.ts`).
    context.signal?.throwIfAborted();
    if (error instanceof TransientDatabaseHttpError) {
      throw error;
    }
    if (
      operationSignals.deadline.aborted
      && error === operationSignals.deadline.reason
    ) {
      return createGeneratedImageErrorResult(
        "deadline_reached",
        false,
        attempt,
        false,
        "deadline_reached",
        {},
      );
    }
    if (error instanceof HttpError && error.code === "BROWSER_GUEST_AI_TRIAL_QUOTA_REACHED") {
      return createGeneratedImageResult(
        { ok: false, code: error.code, details: error.details, retryable: false },
        { succeeded: false, isMutating: false, shouldInvalidateMainContent: false, stopReason: null },
      );
    }
    if (error instanceof GeneratedCardImageGenerationLimitReachedError) {
      const code = error.ceiling === "daily"
        ? "daily_generation_limit_reached"
        : "monthly_generation_limit_reached";
      return createGeneratedImageErrorResult(code, false, attempt, false, null, {
        limit: error.limit,
        resetsAt: error.resetsAt,
        message: createGenerationLimitMessage(error, context.userOpenAIApiKey),
      });
    }
    // Only the code is matched: the same 404 status and wording are also raised after the provider
    // was paid, and that one must keep failing the run instead of becoming a tool result.
    if (
      error instanceof HttpError
      && error.code === "GENERATED_CARD_IMAGE_CARD_NOT_FOUND"
    ) {
      return createGeneratedImageErrorResult(
        "card_not_found",
        attempt !== null && attempt < maximumGeneratedCardImageAttemptsPerRun,
        attempt,
        false,
        null,
        { message: generatedImageErrorMessages.card_not_found },
      );
    }
    const safeErrorCode = getGeneratedImageToolSafeErrorCode(error);
    if (safeErrorCode !== null) {
      const retryable = attempt !== null
        && attempt < maximumGeneratedCardImageAttemptsPerRun;
      return createGeneratedImageErrorResult(
        safeErrorCode,
        retryable,
        attempt,
        false,
        null,
        { message: generatedImageErrorMessages[safeErrorCode] },
      );
    }
    if (isOpenAIImageGenerationProviderError(error)) {
      const providerStatus = error.status;
      const code = error.code === "moderation_blocked"
        ? "moderation_blocked"
        : providerStatus === 401 || providerStatus === 403
          ? "provider_permission_denied"
          : providerStatus === 429
            || (providerStatus !== null && providerStatus >= 500 && providerStatus <= 599)
            ? "provider_unavailable"
            : "provider_failed";
      const retryable = code === "provider_unavailable"
        && attempt !== null
        && attempt < maximumGeneratedCardImageAttemptsPerRun;
      // OpenAI's own reason for refusing a call made with the person's own key goes to the model, so the
      // assistant can relay what only that person can fix; a platform-key result never quotes OpenAI's
      // message, only our explanation and OpenAI's error type, code, and moderation categories.
      const providerMessage = context.userOpenAIApiKey === null
        ? null
        : readOwnOpenAIKeyProviderErrorText(error.cause);
      if (providerMessage === null) {
        return createGeneratedImageErrorResult(code, retryable, attempt, false, null, {
          message: generatedImageErrorMessages[code],
          providerErrorType: error.type,
          providerErrorCode: error.code,
          ...(code === "moderation_blocked" ? { moderationCategories: error.moderationCategories } : {}),
        });
      }
      return createGeneratedImageResult(
        { ok: false, code, retryable, ...(attempt === null ? {} : { attempt }), providerMessage },
        {
          succeeded: false,
          isMutating: false,
          shouldInvalidateMainContent: false,
          stopReason: null,
        },
      );
    }
    throw error;
  }
}
