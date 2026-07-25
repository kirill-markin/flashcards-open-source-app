import { createHash } from "node:crypto";
import type { CardTextSide } from "../../cards";
import { transactionWithWorkspaceScopeDeadline } from "../../database";
import { DatabaseCommitOutcomeUnknownError } from "../../database/transient";
import { normalizeImageBytesForCard } from "../../mediaAssets/ingestion/imageNormalization";
import {
  loadGeneratedMediaStagingObject,
  storeGeneratedMediaStagingObject,
  type GeneratedMediaStagingObject,
} from "../../mediaAssets/storage";
import {
  buildMediaBlobStorageKey,
  buildMediaUploadStagingStorageKey,
} from "../../mediaAssets/storageKeys";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../../mediaAssets/workspaceReplicas";
import { expectNonEmptyString, expectUuidString } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import { assertActiveChatRunClaimWithExecutor } from "../runs/claimFence";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
import { createOpenAIGeneratedCardImageProvider } from "./openaiAdapter";
import { withGeneratedCardImageOperationLock } from "./operationLock";
import { enqueueGeneratedMediaPromotionJob, type EnqueueGeneratedMediaPromotionJobResult } from "./promotionJobs";
import {
  GeneratedCardImageDeadlineExceededError,
  type GeneratedProviderImage,
  type OpenAIImageGenerationInput,
} from "./providerTypes";
import type {
  GeneratedCardImageInput,
  GeneratedCardImageOperationMetadata,
  GeneratedCardImageResult,
} from "./types";

const maximumGeneratedCardImagePromptCharacters = 32_000;
const maximumGeneratedCardImageAltTextCharacters = 2_000;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const maximumTimerDelayMs = 2_147_483_647;

export type PreparedGeneratedCardImage = GeneratedMediaStagingObject & Readonly<{ reused: boolean }>;

export type GeneratedCardImageOperationDependencies = Readonly<{
  assertPreconditionsFn: (input: GeneratedCardImageInput) => Promise<void>;
  withOperationLockFn: typeof withGeneratedCardImageOperationLock;
  prepareStagedImageFn: (input: GeneratedCardImageInput,
    operationMetadata: GeneratedCardImageOperationMetadata) => Promise<PreparedGeneratedCardImage>;
  enqueuePromotionJobFn: (
    input: GeneratedCardImageInput, operationMetadata: GeneratedCardImageOperationMetadata,
    preparedImage: PreparedGeneratedCardImage,
  ) => Promise<EnqueueGeneratedMediaPromotionJobResult>;
}>;

export type GeneratedCardImageExternalDependencies = Readonly<{
  generateProviderImageFn: (input: OpenAIImageGenerationInput) => Promise<GeneratedProviderImage>;
  normalizeImageBytesForCardFn: typeof normalizeImageBytesForCard;
  loadGeneratedMediaStagingObjectFn: typeof loadGeneratedMediaStagingObject;
  storeGeneratedMediaStagingObjectFn: typeof storeGeneratedMediaStagingObject;
  enqueueGeneratedMediaPromotionJobFn: typeof enqueueGeneratedMediaPromotionJob;
}>;

function normalizeTargetSide(targetSide: CardTextSide): CardTextSide {
  if (targetSide !== "front" && targetSide !== "back") {
    throw new HttpError(400, "targetSide must be either front or back");
  }
  return targetSide;
}

function normalizeGeneratedCardImageInput(input: GeneratedCardImageInput): GeneratedCardImageInput {
  const imagePrompt = expectNonEmptyString(input.imagePrompt, "imagePrompt");
  if (imagePrompt.length > maximumGeneratedCardImagePromptCharacters) {
    throw new HttpError(400,
      `imagePrompt must be at most ${maximumGeneratedCardImagePromptCharacters} characters`);
  }
  const altText = expectNonEmptyString(input.altText, "altText");
  if (
    altText.length > maximumGeneratedCardImageAltTextCharacters
    || controlCharacterPattern.test(altText)
  ) {
    throw new HttpError(400,
      `altText must be at most ${maximumGeneratedCardImageAltTextCharacters} characters without control characters`);
  }
  return {
    runId: expectUuidString(input.runId, "runId"),
    sessionId: expectUuidString(input.sessionId, "sessionId"),
    claimToken: expectNonEmptyString(input.claimToken, "claimToken"),
    userId: expectNonEmptyString(input.userId, "userId"),
    workspaceId: expectUuidString(input.workspaceId, "workspaceId"),
    cardId: expectUuidString(input.cardId, "cardId"),
    targetSide: normalizeTargetSide(input.targetSide),
    imagePrompt,
    altText,
    replicaId: expectUuidString(input.replicaId, "replicaId"),
    observationContext: input.observationContext,
    signal: input.signal,
    operationDeadlineMs: input.operationDeadlineMs,
  };
}

function assertGeneratedCardImageOperationActive(input: GeneratedCardImageInput): void {
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
  input: GeneratedCardImageInput,
  run: (deadlineInput: GeneratedCardImageInput) => Promise<Result>,
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
  } catch (error) {
    if (deadlineController.signal.aborted) throw deadlineError;
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

async function assertGeneratedCardImagePreconditions(input: GeneratedCardImageInput): Promise<void> {
  await transactionWithWorkspaceScopeDeadline(
    { userId: input.userId, workspaceId: input.workspaceId },
    input.operationDeadlineMs,
    async (executor) => {
      await assertActiveChatRunClaimWithExecutor(executor, input);
      const cardResult = await executor.query<{ card_id: string }>(
        `SELECT card_id FROM content.cards
         WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [input.workspaceId, input.cardId],
      );
      if (cardResult.rows[0] === undefined) {
        throw new HttpError(404, "Card not found");
      }
      await assertReplicaBelongsToWorkspaceInExecutor(
        executor, input.workspaceId, input.replicaId,
      );
    },
  );
}

async function prepareStagedGeneratedCardImage(
  input: GeneratedCardImageInput,
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
  const generatedImage = await dependencies.generateProviderImageFn({
    userId: input.userId, imagePrompt: input.imagePrompt,
    observationContext: input.observationContext,
    signal: input.signal, operationDeadlineMs: input.operationDeadlineMs,
  });
  input.signal.throwIfAborted();
  const normalizedImage = await dependencies.normalizeImageBytesForCardFn(generatedImage.bytes);
  input.signal.throwIfAborted();
  const staged = await dependencies.storeGeneratedMediaStagingObjectFn({
    ...stagingInput,
    mimeType: normalizedImage.mimeType,
    sizeBytes: normalizedImage.sizeBytes,
    sha256: createHash("sha256").update(normalizedImage.bytes).digest("hex"),
    bytes: normalizedImage.bytes,
  });
  input.signal.throwIfAborted();
  return { ...staged, reused: false };
}

async function enqueueGeneratedCardImagePromotion(
  input: GeneratedCardImageInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  preparedImage: PreparedGeneratedCardImage,
  dependencies: GeneratedCardImageExternalDependencies,
): Promise<EnqueueGeneratedMediaPromotionJobResult> {
  input.signal.throwIfAborted();
  return dependencies.enqueueGeneratedMediaPromotionJobFn({
    userId: input.userId, workspaceId: input.workspaceId,
    sessionId: input.sessionId, runId: input.runId, claimToken: input.claimToken,
    deadlineAtMs: input.operationDeadlineMs,
    jobId: operationMetadata.operationId, operationId: operationMetadata.operationId,
    cardId: input.cardId, targetSide: input.targetSide, altText: input.altText,
    mediaAssetId: operationMetadata.mediaAssetId, replicaId: input.replicaId,
    stagingStorageKey: preparedImage.stagingStorageKey,
    blobStorageKey: buildMediaBlobStorageKey(preparedImage.sha256),
    sha256: preparedImage.sha256, mimeType: preparedImage.mimeType,
    sizeBytes: preparedImage.sizeBytes,
  });
}

async function enqueueGeneratedCardImagePromotionWithCommitReconciliation(
  input: GeneratedCardImageInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  preparedImage: PreparedGeneratedCardImage,
  enqueuePromotionJobFn: GeneratedCardImageOperationDependencies["enqueuePromotionJobFn"],
): Promise<EnqueueGeneratedMediaPromotionJobResult> {
  try {
    return await enqueuePromotionJobFn(input, operationMetadata, preparedImage);
  } catch (error) {
    if (!(error instanceof DatabaseCommitOutcomeUnknownError)) throw error;
    assertGeneratedCardImageOperationActive(input);
    return enqueuePromotionJobFn(input, operationMetadata, preparedImage);
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

export async function generateCardImageWithDependencies(
  input: GeneratedCardImageInput,
  dependencies: GeneratedCardImageOperationDependencies,
): Promise<GeneratedCardImageResult> {
  const normalizedInput = normalizeGeneratedCardImageInput(input);
  assertGeneratedCardImageOperationActive(normalizedInput);
  const operationMetadata = deriveGeneratedCardImageOperationMetadata(
    normalizedInput.runId, normalizedInput.cardId, normalizedInput.targetSide,
  );
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
          reused: preparedImage.reused || enqueueResult.outcome === "existing",
          sourceUrl: null,
        };
      },
    ),
  );
}

const defaultExternalDependencies: GeneratedCardImageExternalDependencies = {
  generateProviderImageFn: async (input) => createOpenAIGeneratedCardImageProvider().generate(input),
  normalizeImageBytesForCardFn: normalizeImageBytesForCard,
  loadGeneratedMediaStagingObjectFn: loadGeneratedMediaStagingObject,
  storeGeneratedMediaStagingObjectFn: storeGeneratedMediaStagingObject,
  enqueueGeneratedMediaPromotionJobFn: enqueueGeneratedMediaPromotionJob,
};

export async function generateCardImage(input: GeneratedCardImageInput): Promise<GeneratedCardImageResult> {
  return generateCardImageWithDependencies(
    input,
    createGeneratedCardImageOperationDependencies(defaultExternalDependencies),
  );
}
