import { createHash } from "node:crypto";
import type { CardTextSide } from "../../cards";
import {
  transactionWithWorkspaceScopeDeadline,
} from "../../database";
import { DatabaseCommitOutcomeUnknownError } from "../../database/transient";
import { normalizeImageBytesForCard } from "../../mediaAssets/ingestion/imageNormalization";
import {
  loadGeneratedMediaStagingObject,
  markGeneratedMediaProviderStartedObject,
  storeGeneratedMediaStagingObject,
  type GeneratedMediaStagingObject,
} from "../../mediaAssets/storage";
import {
  buildMediaBlobStorageKey,
  buildMediaUploadStagingStorageKey,
} from "../../mediaAssets/storageKeys";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../../mediaAssets/workspaceReplicas";
import { captureBackendWarning } from "../../observability/sentry";
import { appendAiUsageEvent } from "../../aiUsage";
import {
  expectNonEmptyString,
  expectUuidString,
  expectWorkspaceIdString,
} from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import { isLowercaseWorkspaceId } from "../../workspaces/identity";
import { isGeneratedImageOperationKey } from "../generatedImageOperationIdentity";
import {
  assertActiveChatRunClaimWithExecutor,
  InactiveChatRunClaimError,
} from "../runs/claimFence";
import {
  markGeneratedCardImageProviderStarted,
  type MarkGeneratedCardImageProviderStartedParams,
  type MarkGeneratedCardImageProviderStartedResult,
} from "../openai/tools/generatedImageAttemptBudget";
import { assertGeneratedCardImageGenerationBudgetAvailable } from "./generationBudget";
import {
  deriveGeneratedCardImageOperationMetadata,
  deriveRequestContentGeneratedCardImageOperationMetadata,
} from "./metadata";
import {
  createOpenAIGeneratedCardImageProvider,
  generatedCardImageModel,
  generatedCardImageQuality,
  generatedCardImageSize,
} from "./provider/openaiAdapter";
import { withGeneratedCardImageOperationLock } from "./operationLock";
import {
  enqueueGeneratedMediaPromotionJob,
  enqueueRunlessGeneratedMediaPromotionJob,
  GeneratedMediaPromotionJobConflictError,
  type EnqueueGeneratedMediaPromotionJobResult,
  type EnqueueRunlessGeneratedMediaPromotionJobInput,
} from "./promotion/jobs";
import {
  type GeneratedProviderImage,
  type OpenAIImageGenerationInput,
} from "./provider/providerTypes";
import {
  formatGeneratedCardImageOperationReference,
  GeneratedCardImageDeadlineExceededError,
  GeneratedCardImageProviderOutcomeUnknownError,
  GeneratedCardImageRequestConflictError,
  GeneratedCardImageStagingOutcomeUnknownError,
  type GeneratedCardImageOperationReference,
} from "./providerTypes";
import type {
  GeneratedCardImageInput,
  GeneratedCardImageOperationInput,
  GeneratedCardImageOperationMetadata,
  GeneratedCardImageResult,
  RunlessGeneratedCardImageInput,
} from "./types";
import {
  countUnicodeCodePoints,
  hasValidGeneratedImageAltTextCharactersAndLength,
  maximumGeneratedImageAltTextCodePoints,
  maximumGeneratedImagePromptCodePoints,
} from "./contract";

const maximumTimerDelayMs = 2_147_483_647;

export type PreparedGeneratedCardImage = GeneratedMediaStagingObject & Readonly<{ reused: boolean }>;

export type GeneratedCardImageOperationDependencies = Readonly<{
  assertPreconditionsFn: (input: GeneratedCardImageOperationInput) => Promise<void>;
  withOperationLockFn: typeof withGeneratedCardImageOperationLock;
  prepareStagedImageFn: (input: GeneratedCardImageOperationInput,
    operationMetadata: GeneratedCardImageOperationMetadata) => Promise<PreparedGeneratedCardImage>;
  enqueuePromotionJobFn: (
    input: GeneratedCardImageOperationInput, operationMetadata: GeneratedCardImageOperationMetadata,
    preparedImage: PreparedGeneratedCardImage,
  ) => Promise<EnqueueGeneratedMediaPromotionJobResult>;
}>;

export type GeneratedCardImageExternalDependencies = Readonly<{
  assertGenerationBudgetAvailableFn: typeof assertGeneratedCardImageGenerationBudgetAvailable;
  markProviderStartedFn: (
    params: MarkGeneratedCardImageProviderStartedParams,
  ) => Promise<MarkGeneratedCardImageProviderStartedResult>;
  markGeneratedMediaProviderStartedObjectFn: typeof markGeneratedMediaProviderStartedObject;
  generateProviderImageFn: (input: OpenAIImageGenerationInput) => Promise<GeneratedProviderImage>;
  appendAiUsageEventFn: typeof appendAiUsageEvent;
  normalizeImageBytesForCardFn: typeof normalizeImageBytesForCard;
  loadGeneratedMediaStagingObjectFn: typeof loadGeneratedMediaStagingObject;
  storeGeneratedMediaStagingObjectFn: typeof storeGeneratedMediaStagingObject;
  enqueueGeneratedMediaPromotionJobFn: typeof enqueueGeneratedMediaPromotionJob;
  enqueueRunlessGeneratedMediaPromotionJobFn: typeof enqueueRunlessGeneratedMediaPromotionJob;
}>;

function normalizeTargetSide(targetSide: CardTextSide): CardTextSide {
  if (targetSide !== "front" && targetSide !== "back") {
    throw new HttpError(400, "targetSide must be either front or back");
  }
  return targetSide;
}

function normalizeGeneratedCardImageAltText(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "altText must be a string");
  }
  if (!hasValidGeneratedImageAltTextCharactersAndLength(value)) {
    throw new HttpError(
      400,
      `altText must be at most ${maximumGeneratedImageAltTextCodePoints} characters without control characters`,
    );
  }
  return expectNonEmptyString(value, "altText");
}

function normalizeGeneratedCardImageWorkspaceId(value: unknown): string {
  const workspaceId = expectWorkspaceIdString(value, "workspaceId");
  if (!isLowercaseWorkspaceId(workspaceId)) {
    throw new HttpError(400, "workspaceId must be a UUID");
  }

  return workspaceId;
}

function normalizeGeneratedCardImagePrompt(value: unknown): string {
  const imagePrompt = expectNonEmptyString(value, "imagePrompt");
  if (countUnicodeCodePoints(imagePrompt) > maximumGeneratedImagePromptCodePoints) {
    throw new HttpError(400,
      `imagePrompt must be at most ${maximumGeneratedImagePromptCodePoints} characters`);
  }
  return imagePrompt;
}

function normalizeGeneratedCardImageInput(input: GeneratedCardImageInput): GeneratedCardImageInput {
  const operationKey = expectNonEmptyString(input.operationKey, "operationKey");
  if (!isGeneratedImageOperationKey(operationKey)) {
    throw new HttpError(
      400,
      "operationKey must identify a positive run-scoped generated-image ordinal",
    );
  }
  const imagePrompt = normalizeGeneratedCardImagePrompt(input.imagePrompt);
  const altText = normalizeGeneratedCardImageAltText(input.altText);
  return {
    runId: expectUuidString(input.runId, "runId"),
    operationKey,
    sessionId: expectUuidString(input.sessionId, "sessionId"),
    claimToken: expectNonEmptyString(input.claimToken, "claimToken"),
    userId: expectNonEmptyString(input.userId, "userId"),
    workspaceId: normalizeGeneratedCardImageWorkspaceId(input.workspaceId),
    cardId: expectUuidString(input.cardId, "cardId"),
    targetSide: normalizeTargetSide(input.targetSide),
    imagePrompt,
    altText,
    replicaId: expectUuidString(input.replicaId, "replicaId"),
    tierAtCall: input.tierAtCall,
    observationContext: input.observationContext,
    signal: input.signal,
    operationDeadlineMs: input.operationDeadlineMs,
  };
}

function normalizeRunlessGeneratedCardImageInput(
  input: RunlessGeneratedCardImageInput,
): RunlessGeneratedCardImageInput {
  const imagePrompt = normalizeGeneratedCardImagePrompt(input.imagePrompt);
  const altText = normalizeGeneratedCardImageAltText(input.altText);
  return {
    userId: expectNonEmptyString(input.userId, "userId"),
    workspaceId: normalizeGeneratedCardImageWorkspaceId(input.workspaceId),
    cardId: expectUuidString(input.cardId, "cardId"),
    targetSide: normalizeTargetSide(input.targetSide),
    imagePrompt,
    altText,
    replicaId: expectUuidString(input.replicaId, "replicaId"),
    tierAtCall: input.tierAtCall,
    observationContext: input.observationContext,
    signal: input.signal,
    operationDeadlineMs: input.operationDeadlineMs,
  };
}

function isChatRunGeneratedCardImageInput(
  input: GeneratedCardImageOperationInput,
): input is GeneratedCardImageInput {
  return "runId" in input;
}

function toGeneratedCardImageOperationReference(
  input: GeneratedCardImageOperationInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
): GeneratedCardImageOperationReference {
  return isChatRunGeneratedCardImageInput(input)
    ? { identityKind: "chat_run", runId: input.runId, operationKey: input.operationKey }
    : { identityKind: "request_content", operationId: operationMetadata.operationId };
}

function assertGeneratedCardImageOperationActive(input: GeneratedCardImageOperationInput): void {
  input.signal.throwIfAborted();
  if (!Number.isSafeInteger(input.operationDeadlineMs) || input.operationDeadlineMs < 1) {
    throw new RangeError(
      "Generated card image operation deadline must be a positive absolute epoch-millisecond safe integer.",
    );
  }
  if (input.operationDeadlineMs <= Date.now()) {
    throw new GeneratedCardImageDeadlineExceededError(null);
  }
}

async function withGeneratedCardImageDeadline<Result>(
  input: GeneratedCardImageOperationInput,
  run: (deadlineInput: GeneratedCardImageOperationInput) => Promise<Result>,
): Promise<Result> {
  assertGeneratedCardImageOperationActive(input);
  const deadlineController = new AbortController();
  const deadlineError = new GeneratedCardImageDeadlineExceededError(null);
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(deadlineError),
    Math.min(input.operationDeadlineMs - Date.now(), maximumTimerDelayMs),
  );
  const deadlineInput = {
    ...input, signal: AbortSignal.any([input.signal, deadlineController.signal]),
  };
  try {
    return await run(deadlineInput);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

async function assertGeneratedCardImagePreconditions(
  input: GeneratedCardImageOperationInput,
): Promise<void> {
  await transactionWithWorkspaceScopeDeadline(
    { userId: input.userId, workspaceId: input.workspaceId },
    input.operationDeadlineMs,
    async (executor) => {
      if (isChatRunGeneratedCardImageInput(input)) {
        await assertActiveChatRunClaimWithExecutor(executor, input);
      }
      const cardResult = await executor.query<{ card_id: string }>(
        `SELECT card_id FROM content.cards
         WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [input.workspaceId, input.cardId],
      );
      if (cardResult.rows[0] === undefined) {
        // Coded so the chat tool can single this pre-generation 404 out: the identical 404 raised
        // after the provider was paid carries no code and must keep failing the run.
        throw new HttpError(404, "Card not found", "GENERATED_CARD_IMAGE_CARD_NOT_FOUND");
      }
      await assertReplicaBelongsToWorkspaceInExecutor(
        executor, input.workspaceId, input.replicaId,
      );
    },
  );
}

async function prepareStagedGeneratedCardImage(
  input: GeneratedCardImageOperationInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  dependencies: GeneratedCardImageExternalDependencies,
): Promise<PreparedGeneratedCardImage> {
  const stagingStorageKey = buildMediaUploadStagingStorageKey(
    input.workspaceId, operationMetadata.mediaAssetId, operationMetadata.operationId);
  const stagingInput = {
    workspaceId: input.workspaceId, mediaAssetId: operationMetadata.mediaAssetId,
    operationId: operationMetadata.operationId, stagingStorageKey,
    observationScope: input.observationContext.scope, signal: input.signal,
  };
  const existing = await dependencies.loadGeneratedMediaStagingObjectFn(stagingInput);
  if (existing !== null) return { ...existing, reused: true };
  // Checked before the provider-start fence: a refusal after it would leave previously_started
  // behind, so every identical retry would fail as outcome-unknown instead of as this refusal. An
  // exhausted budget therefore also refuses a replay whose provider start is already recorded.
  await dependencies.assertGenerationBudgetAvailableFn(input);
  // A fence written after the caller gave up makes every identical retry read previously_started
  // and fail as outcome-unknown, although nothing was ever paid.
  input.signal.throwIfAborted();
  // The chat flag is set in the same transaction that asserts the run claim; a request-content
  // operation has no run, so its create-if-absent storage marker fences the paid call instead.
  const providerStart = isChatRunGeneratedCardImageInput(input)
    ? await dependencies.markProviderStartedFn({
      userId: input.userId,
      workspaceId: input.workspaceId,
      runId: input.runId,
      sessionId: input.sessionId,
      claimToken: input.claimToken,
      operationKey: input.operationKey,
      databaseDeadlineAtMs: input.operationDeadlineMs,
    })
    : await dependencies.markGeneratedMediaProviderStartedObjectFn(stagingInput);
  const operation = toGeneratedCardImageOperationReference(input, operationMetadata);
  if (providerStart.status === "previously_started") {
    // A paid generation that never reached staging cannot be told apart here from a lost reply on
    // the chat flag commit or on the run-less marker PUT: each leaves previously_started and no
    // staging object, and neither fence records whether the provider was ever called.
    captureBackendWarning({
      action: "generated_card_image_provider_outcome_unknown",
      message: "Generated card image provider start was already recorded without staged bytes, so a paid generation may never have landed.",
      scope: input.observationContext.scope,
      details: {
        identityKind: operation.identityKind,
        runId: operation.identityKind === "chat_run" ? operation.runId : null,
        operationKey: operation.identityKind === "chat_run" ? operation.operationKey : null,
        operationId: operationMetadata.operationId,
        mediaAssetId: operationMetadata.mediaAssetId,
      },
    });
    throw new GeneratedCardImageProviderOutcomeUnknownError(operation);
  }
  if (providerStart.status !== "first_started") {
    throw new Error(
      `Generated card image provider start returned an invalid result. ${formatGeneratedCardImageOperationReference(operation)}`,
    );
  }
  input.signal.throwIfAborted();
  const generatedImage = await dependencies.generateProviderImageFn({
    userId: input.userId, imagePrompt: input.imagePrompt,
    observationContext: input.observationContext,
    signal: input.signal, operationDeadlineMs: input.operationDeadlineMs,
  });
  // Appended before the bytes are normalized and staged: the provider has been paid by now, and the
  // steps after this one can still fail. The size and the quality are stored because the same single
  // image costs different money at each of them, and the count is one because the adapter refuses any
  // response that does not carry exactly one image.
  await dependencies.appendAiUsageEventFn({
    userId: input.userId,
    workspaceId: input.workspaceId,
    occurredAt: new Date(),
    surface: "card_image",
    provider: "openai",
    modelId: generatedCardImageModel,
    requestId: input.observationContext.scope.requestId,
    tierAtCall: input.tierAtCall,
    counters: generatedImage.usageCounters,
    imageCount: 1,
    imageSize: generatedCardImageSize,
    imageQuality: generatedCardImageQuality,
    userSuppliedKey: false,
  });
  input.signal.throwIfAborted();
  const normalizedImage = await dependencies.normalizeImageBytesForCardFn(generatedImage.bytes);
  input.signal.throwIfAborted();
  let staged: GeneratedMediaStagingObject;
  try {
    staged = await dependencies.storeGeneratedMediaStagingObjectFn({
      ...stagingInput,
      mimeType: normalizedImage.mimeType,
      sizeBytes: normalizedImage.sizeBytes,
      sha256: createHash("sha256").update(normalizedImage.bytes).digest("hex"),
      bytes: normalizedImage.bytes,
    });
  } catch (error) {
    if (input.signal.aborted && error === input.signal.reason) {
      throw error;
    }
    throw new GeneratedCardImageStagingOutcomeUnknownError(operation, error);
  }
  input.signal.throwIfAborted();
  return { ...staged, reused: false };
}

async function enqueueGeneratedCardImagePromotion(
  input: GeneratedCardImageOperationInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  preparedImage: PreparedGeneratedCardImage,
  dependencies: GeneratedCardImageExternalDependencies,
): Promise<EnqueueGeneratedMediaPromotionJobResult> {
  input.signal.throwIfAborted();
  const job: EnqueueRunlessGeneratedMediaPromotionJobInput = {
    userId: input.userId, workspaceId: input.workspaceId,
    deadlineAtMs: input.operationDeadlineMs,
    jobId: operationMetadata.operationId, operationId: operationMetadata.operationId,
    cardId: input.cardId, targetSide: input.targetSide, altText: input.altText,
    mediaAssetId: operationMetadata.mediaAssetId, replicaId: input.replicaId,
    stagingStorageKey: preparedImage.stagingStorageKey,
    blobStorageKey: buildMediaBlobStorageKey(preparedImage.sha256),
    sha256: preparedImage.sha256, mimeType: preparedImage.mimeType,
    sizeBytes: preparedImage.sizeBytes,
  };
  return isChatRunGeneratedCardImageInput(input)
    ? dependencies.enqueueGeneratedMediaPromotionJobFn({
      ...job, sessionId: input.sessionId, runId: input.runId, claimToken: input.claimToken,
    })
    : dependencies.enqueueRunlessGeneratedMediaPromotionJobFn(job);
}

function isConfirmedPromotionEnqueueResult(
  result: unknown,
  expectedJobId: string,
): result is EnqueueGeneratedMediaPromotionJobResult {
  return typeof result === "object"
    && result !== null
    && "outcome" in result
    && (result.outcome === "created" || result.outcome === "existing")
    && "jobId" in result
    && result.jobId === expectedJobId
    && "placeholderApplied" in result
    && typeof result.placeholderApplied === "boolean";
}

async function enqueueGeneratedCardImagePromotionWithCommitReconciliation(
  input: GeneratedCardImageOperationInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  preparedImage: PreparedGeneratedCardImage,
  enqueuePromotionJobFn: GeneratedCardImageOperationDependencies["enqueuePromotionJobFn"],
): Promise<EnqueueGeneratedMediaPromotionJobResult> {
  try {
    return await enqueuePromotionJobFn(input, operationMetadata, preparedImage);
  } catch (error) {
    if (!(error instanceof DatabaseCommitOutcomeUnknownError)) {
      throw error;
    }
    if (input.signal.aborted || input.operationDeadlineMs <= Date.now()) {
      throw error;
    }
    let reconciliationResult: EnqueueGeneratedMediaPromotionJobResult;
    try {
      reconciliationResult = await enqueuePromotionJobFn(
        input,
        operationMetadata,
        preparedImage,
      );
    } catch {
      throw error;
    }
    if (
      !isConfirmedPromotionEnqueueResult(
        reconciliationResult,
        operationMetadata.operationId,
      )
    ) {
      throw error;
    }
    return reconciliationResult;
  }
}

export function createGeneratedCardImageOperationDependencies(
  externalDependencies: GeneratedCardImageExternalDependencies,
): GeneratedCardImageOperationDependencies {
  return {
    assertPreconditionsFn: assertGeneratedCardImagePreconditions,
    withOperationLockFn: withGeneratedCardImageOperationLock,
    prepareStagedImageFn: async (input, metadata) => prepareStagedGeneratedCardImage(
      input, metadata, externalDependencies,
    ),
    enqueuePromotionJobFn: async (input, metadata, preparedImage) =>
      enqueueGeneratedCardImagePromotion(input, metadata, preparedImage, externalDependencies),
  };
}

async function runGeneratedCardImageOperation(
  normalizedInput: GeneratedCardImageOperationInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  dependencies: GeneratedCardImageOperationDependencies,
): Promise<GeneratedCardImageResult> {
  await dependencies.assertPreconditionsFn(normalizedInput);
  assertGeneratedCardImageOperationActive(normalizedInput);
  return withGeneratedCardImageDeadline(
    normalizedInput,
    async (deadlineInput) => dependencies.withOperationLockFn(
      {
        workspaceId: deadlineInput.workspaceId, mediaAssetId: operationMetadata.mediaAssetId,
        signal: deadlineInput.signal,
      },
      async (lockSignal) => {
        const lockedInput = { ...deadlineInput, signal: lockSignal };
        const preparedImage = await dependencies.prepareStagedImageFn(
          lockedInput, operationMetadata,
        );
        assertGeneratedCardImageOperationActive(lockedInput);
        const enqueueResult = await enqueueGeneratedCardImagePromotionWithCommitReconciliation(
          lockedInput, operationMetadata, preparedImage, dependencies.enqueuePromotionJobFn,
        );
        return {
          status: enqueueResult.outcome === "created" ? "queued" : "already_queued",
          cardId: lockedInput.cardId,
          mediaAssetId: operationMetadata.mediaAssetId,
          targetSide: lockedInput.targetSide,
          mediaRegistrationApplied: false,
          cardAppendApplied: false,
          placeholderApplied: enqueueResult.placeholderApplied,
          reused: preparedImage.reused || enqueueResult.outcome === "existing",
          sourceUrl: null,
        };
      },
    ),
  );
}

export async function generateCardImageWithDependencies(
  input: GeneratedCardImageInput,
  dependencies: GeneratedCardImageOperationDependencies,
): Promise<GeneratedCardImageResult> {
  const normalizedInput = normalizeGeneratedCardImageInput(input);
  assertGeneratedCardImageOperationActive(normalizedInput);
  const operationMetadata = deriveGeneratedCardImageOperationMetadata(
    normalizedInput.runId, normalizedInput.operationKey,
  );
  return runGeneratedCardImageOperation(normalizedInput, operationMetadata, dependencies);
}

/**
 * Entry for a surface without a chat run. Its identity comes from the normalized content and the
 * server clock at receipt and excludes the user and replica, so a different user or replica sending
 * the same request within that hour fails with GeneratedCardImageRequestConflictError.
 */
export async function generateRunlessCardImageWithDependencies(
  input: RunlessGeneratedCardImageInput,
  dependencies: GeneratedCardImageOperationDependencies,
): Promise<GeneratedCardImageResult> {
  const requestedAtMs = Date.now();
  const normalizedInput = normalizeRunlessGeneratedCardImageInput(input);
  assertGeneratedCardImageOperationActive(normalizedInput);
  const operationMetadata = deriveRequestContentGeneratedCardImageOperationMetadata({
    workspaceId: normalizedInput.workspaceId,
    cardId: normalizedInput.cardId,
    targetSide: normalizedInput.targetSide,
    imagePrompt: normalizedInput.imagePrompt,
    altText: normalizedInput.altText,
    requestedAtMs,
  });
  try {
    return await runGeneratedCardImageOperation(normalizedInput, operationMetadata, dependencies);
  } catch (error) {
    if (error instanceof GeneratedMediaPromotionJobConflictError) {
      throw new GeneratedCardImageRequestConflictError(operationMetadata.operationId, error);
    }
    throw error;
  }
}

const defaultExternalDependencies: GeneratedCardImageExternalDependencies = {
  assertGenerationBudgetAvailableFn: assertGeneratedCardImageGenerationBudgetAvailable,
  markProviderStartedFn: markGeneratedCardImageProviderStarted,
  markGeneratedMediaProviderStartedObjectFn: markGeneratedMediaProviderStartedObject,
  generateProviderImageFn: async (input) => createOpenAIGeneratedCardImageProvider().generate(input),
  appendAiUsageEventFn: appendAiUsageEvent,
  normalizeImageBytesForCardFn: normalizeImageBytesForCard,
  loadGeneratedMediaStagingObjectFn: loadGeneratedMediaStagingObject,
  storeGeneratedMediaStagingObjectFn: storeGeneratedMediaStagingObject,
  enqueueGeneratedMediaPromotionJobFn: enqueueGeneratedMediaPromotionJob,
  enqueueRunlessGeneratedMediaPromotionJobFn: enqueueRunlessGeneratedMediaPromotionJob,
};

export async function generateCardImage(input: GeneratedCardImageInput): Promise<GeneratedCardImageResult> {
  return generateCardImageWithDependencies(
    input,
    createGeneratedCardImageOperationDependencies(defaultExternalDependencies),
  );
}

/**
 * TODO(external-image-surface): The planned external image surface (MCP and the Agent REST API).
 * Nothing calls it today, by decision: image generation stays chat-only until the open choice
 * between a synchronous call that accepts a timeout tail inside the MCP gateway's 29-second
 * integration timeout and an asynchronous worker is settled, on the measured provider latency
 * recorded in `docs/agent-tool-surfaces.md`.
 */
export async function generateRunlessCardImage(
  input: RunlessGeneratedCardImageInput,
): Promise<GeneratedCardImageResult> {
  return generateRunlessCardImageWithDependencies(
    input,
    createGeneratedCardImageOperationDependencies(defaultExternalDependencies),
  );
}
