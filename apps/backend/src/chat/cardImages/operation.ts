import { createHash } from "node:crypto";
import { appendManagedImageToCardSideInExecutor, getCard, type CardTextSide } from "../../cards";
import {
  queryWithWorkspaceScopeReadOnly, transactionWithWorkspaceScope, transactionWithWorkspaceScopeReadOnly,
} from "../../database";
import {
  MEDIA_ASSET_COLUMNS, MEDIA_ASSET_JOIN_CLAUSE, loadReusableImageMediaBlobForWorkspace, mapMediaAssetRow,
} from "../../mediaAssets";
import { normalizeImageBytesForCard } from "../../mediaAssets/ingestion/imageNormalization";
import {
  findMediaAssetRowForUpdateInExecutor, upsertMediaAssetSnapshotWithBlobNormalizationInExecutor,
} from "../../mediaAssets/persistence";
import { storeMediaAssetBlobBytesIfAbsent } from "../../mediaAssets/storage";
import { buildMediaBlobStorageKey } from "../../mediaAssets/storageKeys";
import {
  imageJpegCardMediaBlobMimeType, imageJpegCardMediaBlobNormalizationVersion, type MediaAsset,
  type MediaAssetRow, type NormalizedImageMediaAssetInput,
} from "../../mediaAssets/types";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../../mediaAssets/workspaceReplicas";
import { expectNonEmptyString, expectUuidString } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../../sync/replication/changes";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
import { createOpenAIGeneratedCardImageProvider } from "./openaiAdapter";
import { withGeneratedCardImageOperationLock } from "./operationLock";
import type { GeneratedProviderImage, OpenAIImageGenerationInput } from "./providerTypes";
import type { GeneratedCardImageInput, GeneratedCardImageOperationMetadata, GeneratedCardImageResult } from "./types";

const maximumGeneratedCardImagePromptCharacters = 32_000;

export type PreparedGeneratedCardImage = NormalizedImageMediaAssetInput;

type PersistedGeneratedCardImage =
  Pick<GeneratedCardImageResult, "mediaRegistrationApplied" | "cardAppendApplied" | "reused">;

export type GeneratedCardImageOperationDependencies = Readonly<{
  assertPreconditionsFn: (input: GeneratedCardImageInput) => Promise<void>;
  withOperationLockFn: typeof withGeneratedCardImageOperationLock;
  findMediaAssetFn: (userId: string, workspaceId: string, mediaAssetId: string) => Promise<MediaAsset | null>;
  prepareGeneratedImageFn: (
    input: GeneratedCardImageInput,
    operationMetadata: GeneratedCardImageOperationMetadata,
  ) => Promise<PreparedGeneratedCardImage>;
  persistGeneratedImageFn: (
    input: GeneratedCardImageInput,
    operationMetadata: GeneratedCardImageOperationMetadata,
    preparedImage: PreparedGeneratedCardImage | null,
    cardClientUpdatedAt: string,
  ) => Promise<PersistedGeneratedCardImage>;
}>;

export type GeneratedCardImageExternalDependencies = Readonly<{
  generateProviderImageFn: (input: OpenAIImageGenerationInput) => Promise<GeneratedProviderImage>;
  normalizeImageBytesForCardFn: typeof normalizeImageBytesForCard;
  storeMediaAssetBlobBytesIfAbsentFn: typeof storeMediaAssetBlobBytesIfAbsent;
  currentTimestampFn: () => string;
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
    throw new HttpError(400, `imagePrompt must be at most ${maximumGeneratedCardImagePromptCharacters} characters`);
  }

  return {
    runId: expectUuidString(input.runId, "runId"),
    userId: expectNonEmptyString(input.userId, "userId"),
    workspaceId: expectUuidString(input.workspaceId, "workspaceId"),
    cardId: expectUuidString(input.cardId, "cardId"),
    targetSide: normalizeTargetSide(input.targetSide),
    imagePrompt,
    altText: expectNonEmptyString(input.altText, "altText"),
    replicaId: expectUuidString(input.replicaId, "replicaId"),
    observationContext: input.observationContext,
    signal: input.signal,
  };
}

async function assertGeneratedCardImagePreconditions(input: GeneratedCardImageInput): Promise<void> {
  await Promise.all([
    getCard(input.userId, input.workspaceId, input.cardId),
    transactionWithWorkspaceScopeReadOnly(
      { userId: input.userId, workspaceId: input.workspaceId },
      async (executor) => assertReplicaBelongsToWorkspaceInExecutor(executor, input.workspaceId, input.replicaId),
    ),
  ]);
}

async function findGeneratedCardImageMediaAsset(
  userId: string, workspaceId: string, mediaAssetId: string,
): Promise<MediaAsset | null> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetRow>(
    { userId, workspaceId },
    `SELECT ${MEDIA_ASSET_COLUMNS}
       FROM ${MEDIA_ASSET_JOIN_CLAUSE}
       WHERE media_assets.workspace_id = $1 AND media_assets.media_asset_id = $2
       LIMIT 1`,
    [workspaceId, mediaAssetId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapMediaAssetRow(row);
}

function assertReusableGeneratedMediaAsset(
  mediaAsset: MediaAsset, operationMetadata: GeneratedCardImageOperationMetadata,
): void {
  if (mediaAsset.lastOperationId !== operationMetadata.mediaLastOperationId
      || mediaAsset.sourceUrl !== null) {
    throw new HttpError(409,
      `The deterministic generated media asset id belongs to another operation. mediaAssetId=${operationMetadata.mediaAssetId}`,
      "GENERATED_CARD_IMAGE_MEDIA_ID_CONFLICT");
  }
  if (mediaAsset.deletedAt !== null) {
    throw new HttpError(409, `The generated media asset was deleted. mediaAssetId=${operationMetadata.mediaAssetId}`,
      "GENERATED_CARD_IMAGE_MEDIA_DELETED");
  }
}

async function prepareGeneratedCardImage(
  input: GeneratedCardImageInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  dependencies: GeneratedCardImageExternalDependencies,
): Promise<PreparedGeneratedCardImage> {
  const generatedImage = await dependencies.generateProviderImageFn({
    userId: input.userId,
    imagePrompt: input.imagePrompt,
    observationContext: input.observationContext,
    signal: input.signal,
  });
  input.signal.throwIfAborted();

  const normalizedImage = await dependencies.normalizeImageBytesForCardFn(generatedImage.bytes);
  input.signal.throwIfAborted();

  const timestamp = dependencies.currentTimestampFn();
  const mediaAssetInput: NormalizedImageMediaAssetInput = {
    mediaAssetId: operationMetadata.mediaAssetId,
    sourceUrl: null,
    createdAt: timestamp,
    clientUpdatedAt: timestamp,
    lastModifiedByReplicaId: input.replicaId,
    lastOperationId: operationMetadata.mediaLastOperationId,
    sizeBytes: normalizedImage.sizeBytes,
    sha256: createHash("sha256").update(normalizedImage.bytes).digest("hex"),
  };
  const reusableBlob = await loadReusableImageMediaBlobForWorkspace(
    input.userId, input.workspaceId, mediaAssetInput,
  );
  input.signal.throwIfAborted();

  if (reusableBlob === null) {
    await dependencies.storeMediaAssetBlobBytesIfAbsentFn({
      workspaceId: input.workspaceId,
      mediaAssetId: operationMetadata.mediaAssetId,
      storageKey: buildMediaBlobStorageKey(mediaAssetInput.sha256),
      mimeType: normalizedImage.mimeType,
      sha256: mediaAssetInput.sha256,
      lastOperationId: operationMetadata.mediaLastOperationId,
      bytes: normalizedImage.bytes,
      observationScope: input.observationContext.scope,
    });
  }
  input.signal.throwIfAborted();
  return mediaAssetInput;
}

async function persistGeneratedCardImage(
  input: GeneratedCardImageInput,
  operationMetadata: GeneratedCardImageOperationMetadata,
  preparedImage: PreparedGeneratedCardImage | null,
  cardClientUpdatedAt: string,
): Promise<PersistedGeneratedCardImage> {
  input.signal.throwIfAborted();

  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    async (executor) => {
      await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, input.workspaceId);
      await assertReplicaBelongsToWorkspaceInExecutor(executor, input.workspaceId, input.replicaId);
      input.signal.throwIfAborted();

      const existingRow = await findMediaAssetRowForUpdateInExecutor(
        executor, input.workspaceId, operationMetadata.mediaAssetId,
      );
      let mediaRegistrationApplied = false;
      let reused = preparedImage === null || existingRow !== null;
      if (existingRow === null) {
        if (preparedImage === null) {
          throw new HttpError(409,
            `The generated media asset disappeared. mediaAssetId=${operationMetadata.mediaAssetId}`,
            "GENERATED_CARD_IMAGE_MEDIA_MISSING");
        }
        const mediaResult = await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
          executor,
          input.workspaceId,
          {
            mediaAssetId: preparedImage.mediaAssetId,
            mimeType: imageJpegCardMediaBlobMimeType,
            sizeBytes: preparedImage.sizeBytes,
            sha256: preparedImage.sha256,
            sourceUrl: null,
            createdAt: preparedImage.createdAt,
            deletedAt: null,
          },
          {
            clientUpdatedAt: preparedImage.clientUpdatedAt,
            lastModifiedByReplicaId: input.replicaId,
            lastOperationId: operationMetadata.mediaLastOperationId,
          },
          imageJpegCardMediaBlobNormalizationVersion,
        );
        assertReusableGeneratedMediaAsset(mediaResult.mediaAsset, operationMetadata);
        mediaRegistrationApplied = true;
        reused = false;
      } else {
        assertReusableGeneratedMediaAsset(mapMediaAssetRow(existingRow), operationMetadata);
      }

      input.signal.throwIfAborted();
      const cardResult = await appendManagedImageToCardSideInExecutor(
        executor,
        input.workspaceId,
        {
          cardId: input.cardId,
          targetSide: input.targetSide,
          mediaAssetId: operationMetadata.mediaAssetId,
          altText: input.altText,
        },
        {
          clientUpdatedAt: cardClientUpdatedAt,
          lastModifiedByReplicaId: input.replicaId,
          lastOperationId: operationMetadata.cardLastOperationId,
        },
      );
      input.signal.throwIfAborted();
      return { mediaRegistrationApplied, cardAppendApplied: cardResult.applied, reused };
    },
  );
}

export function createGeneratedCardImageOperationDependencies(
  externalDependencies: GeneratedCardImageExternalDependencies,
): GeneratedCardImageOperationDependencies {
  return {
    assertPreconditionsFn: assertGeneratedCardImagePreconditions,
    withOperationLockFn: withGeneratedCardImageOperationLock,
    findMediaAssetFn: findGeneratedCardImageMediaAsset,
    prepareGeneratedImageFn: async (input, metadata) => prepareGeneratedCardImage(
      input, metadata, externalDependencies,
    ),
    persistGeneratedImageFn: persistGeneratedCardImage,
  };
}

function toGeneratedCardImageResult(
  input: GeneratedCardImageInput, operationMetadata: GeneratedCardImageOperationMetadata,
  persisted: PersistedGeneratedCardImage,
): GeneratedCardImageResult {
  return {
    cardId: input.cardId,
    mediaAssetId: operationMetadata.mediaAssetId,
    targetSide: input.targetSide,
    mediaRegistrationApplied: persisted.mediaRegistrationApplied,
    cardAppendApplied: persisted.cardAppendApplied,
    reused: persisted.reused,
    sourceUrl: null,
  };
}

export async function generateCardImageWithDependencies(
  input: GeneratedCardImageInput,
  dependencies: GeneratedCardImageOperationDependencies,
): Promise<GeneratedCardImageResult> {
  const normalizedInput = normalizeGeneratedCardImageInput(input);
  normalizedInput.signal.throwIfAborted();
  const operationMetadata = deriveGeneratedCardImageOperationMetadata(
    normalizedInput.runId, normalizedInput.cardId, normalizedInput.targetSide,
  );

  await dependencies.assertPreconditionsFn(normalizedInput);
  normalizedInput.signal.throwIfAborted();
  return dependencies.withOperationLockFn(
    {
      workspaceId: normalizedInput.workspaceId, mediaAssetId: operationMetadata.mediaAssetId,
      signal: normalizedInput.signal,
    },
    async (lockSignal) => {
      const lockedInput: GeneratedCardImageInput = { ...normalizedInput, signal: lockSignal };
      lockedInput.signal.throwIfAborted();
      const existingMediaAsset = await dependencies.findMediaAssetFn(
        lockedInput.userId, lockedInput.workspaceId, operationMetadata.mediaAssetId,
      );
      lockedInput.signal.throwIfAborted();

      if (existingMediaAsset !== null) {
        assertReusableGeneratedMediaAsset(existingMediaAsset, operationMetadata);
        const persisted = await dependencies.persistGeneratedImageFn(
          lockedInput, operationMetadata, null, new Date().toISOString(),
        );
        return toGeneratedCardImageResult(lockedInput, operationMetadata, persisted);
      }

      const preparedImage = await dependencies.prepareGeneratedImageFn(lockedInput, operationMetadata);
      const persisted = await dependencies.persistGeneratedImageFn(
        lockedInput, operationMetadata, preparedImage, preparedImage.clientUpdatedAt,
      );
      return toGeneratedCardImageResult(lockedInput, operationMetadata, persisted);
    },
  );
}

const defaultExternalDependencies: GeneratedCardImageExternalDependencies = {
  generateProviderImageFn: async (input) => createOpenAIGeneratedCardImageProvider().generate(input),
  normalizeImageBytesForCardFn: normalizeImageBytesForCard,
  storeMediaAssetBlobBytesIfAbsentFn: storeMediaAssetBlobBytesIfAbsent,
  currentTimestampFn: () => new Date().toISOString(),
};

export async function generateCardImage(input: GeneratedCardImageInput): Promise<GeneratedCardImageResult> {
  return generateCardImageWithDependencies(input,
    createGeneratedCardImageOperationDependencies(defaultExternalDependencies));
}
