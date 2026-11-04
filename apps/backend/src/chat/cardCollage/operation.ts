import { randomUUID } from "node:crypto";
import { appendManagedImageToCardSideInExecutor, getCard } from "../../cards";
import type { CardTextSide } from "../../cards/types";
import { transactionWithWorkspaceScope } from "../../database";
import { loadMediaAssetWithBlobForWorkspace } from "../../mediaAssets";
import { ingestImageMediaAsset } from "../../mediaAssets/ingestion";
import { loadMediaAssetObjectBytes } from "../../mediaAssets/storage";
import type { MediaBlob } from "../../mediaAssets/types";
import type { BackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import { ensureAIChatSyncReplica } from "../../sync/identity/aiChatIdentity";
import { extractManagedMediaImageReferenceSources } from "../../workspacePackages/markdownMedia";
import { composeCardCollage, type CardCollageSourceImage } from "./compose";
import { CardCollageError } from "./errors";

export type AddImageCollageToCardInput = Readonly<{
  userId: string;
  workspaceId: string;
  cardId: string;
  targetSide: CardTextSide;
  /** Lowercase ids, in collage order. */
  sourceMediaAssetIds: ReadonlyArray<string>;
  altText: string;
  observationScope: BackendObservationScope;
  signal: AbortSignal | null;
}>;

export type AddImageCollageToCardResult = Readonly<{
  cardId: string;
  targetSide: CardTextSide;
  mediaAssetId: string;
  sourceMediaAssetIds: ReadonlyArray<string>;
}>;

/** Card images are stored normalized far below this; it only bounds an unnormalized original. */
const maximumCollageSourceImageBytes = 16_000_000;

function createCardNotFoundError(cardId: string): CardCollageError {
  return new CardCollageError(
    "card_not_found",
    `Card ${cardId} does not exist in the workspace the user has open, or was deleted. Look it up again with sql_query before retrying.`,
  );
}

/** `getCard` and the append both report a missing card as an uncoded 404. */
function isCardNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.statusCode === 404 && error.code === null;
}

async function loadCardSideText(input: AddImageCollageToCardInput): Promise<string> {
  try {
    const card = await getCard(input.userId, input.workspaceId, input.cardId);
    return input.targetSide === "front" ? card.frontText : card.backText;
  } catch (error) {
    if (isCardNotFoundError(error)) {
      throw createCardNotFoundError(input.cardId);
    }
    throw error;
  }
}

function assertSourcesAreReadyOnSide(input: AddImageCollageToCardInput, sideText: string): void {
  const references = extractManagedMediaImageReferenceSources(sideText);
  for (const mediaAssetId of input.sourceMediaAssetIds) {
    const states = references
      .filter((reference) => reference.mediaAssetId.toLowerCase() === mediaAssetId)
      .map((reference) => reference.state);
    if (states.length === 0) {
      throw new CardCollageError(
        "image_not_on_card_side",
        `Image ${mediaAssetId} is not on the ${input.targetSide} of card ${input.cardId}. Read that side again with sql_query and pass only ids from its fcasset: image destinations.`,
      );
    }
    if (!states.includes("ready")) {
      throw new CardCollageError(
        "image_not_ready",
        `Image ${mediaAssetId} on the ${input.targetSide} of card ${input.cardId} is ${states[0]}, not ready. Leave it out, or wait until it is ready.`,
      );
    }
  }
}

async function loadSourceMediaBlob(
  input: AddImageCollageToCardInput,
  mediaAssetId: string,
): Promise<MediaBlob> {
  try {
    const { mediaBlob } = await loadMediaAssetWithBlobForWorkspace(
      input.userId,
      input.workspaceId,
      mediaAssetId,
    );
    return mediaBlob;
  } catch (error) {
    if (error instanceof HttpError && error.code === "MEDIA_ASSET_NOT_FOUND") {
      throw new CardCollageError(
        "image_unavailable",
        `Image ${mediaAssetId} is referenced on the card but its file no longer exists. Call again without it.`,
      );
    }
    throw error;
  }
}

async function loadSourceImage(
  input: AddImageCollageToCardInput,
  mediaAssetId: string,
): Promise<CardCollageSourceImage> {
  const mediaBlob = await loadSourceMediaBlob(input, mediaAssetId);
  if (mediaBlob.sizeBytes > maximumCollageSourceImageBytes) {
    throw new CardCollageError(
      "image_too_large",
      `Image ${mediaAssetId} is ${mediaBlob.sizeBytes} bytes; a collage source can be at most ${maximumCollageSourceImageBytes}. Call again without it.`,
    );
  }
  const loaded = await loadMediaAssetObjectBytes({
    workspaceId: input.workspaceId,
    mediaAssetId,
    storageKey: mediaBlob.storageKey,
    mimeType: mediaBlob.mimeType,
    sizeBytes: mediaBlob.sizeBytes,
    sha256: mediaBlob.sha256,
    maxByteSize: maximumCollageSourceImageBytes,
    observationScope: input.observationScope,
  });
  return { mediaAssetId, bytes: loaded.bytes };
}

/**
 * Composes the side's chosen images into one new managed image and appends it to that side; the
 * originals stay. The append is an ordinary server-side card edit by the workspace's AI-chat
 * replica, so clients receive it through sync like a `sql_execute` write.
 */
export async function addImageCollageToCard(
  input: AddImageCollageToCardInput,
): Promise<AddImageCollageToCardResult> {
  const sideText = await loadCardSideText(input);
  assertSourcesAreReadyOnSide(input, sideText);

  const sources: Array<CardCollageSourceImage> = [];
  for (const mediaAssetId of input.sourceMediaAssetIds) {
    input.signal?.throwIfAborted();
    sources.push(await loadSourceImage(input, mediaAssetId));
  }
  input.signal?.throwIfAborted();
  const collageBytes = await composeCardCollage(sources);

  input.signal?.throwIfAborted();
  const replicaId = await ensureAIChatSyncReplica(
    input.workspaceId,
    input.userId,
    "web",
    input.signal,
  );
  const mediaAssetId = randomUUID().toLowerCase();
  const mutationMetadata = {
    clientUpdatedAt: new Date().toISOString(),
    lastModifiedByReplicaId: replicaId,
    lastOperationId: `card-collage:${mediaAssetId}`,
  };
  input.signal?.throwIfAborted();
  await ingestImageMediaAsset({
    userId: input.userId,
    workspaceId: input.workspaceId,
    metadata: {
      ...mutationMetadata,
      mediaAssetId,
      sourceUrl: null,
      createdAt: mutationMetadata.clientUpdatedAt,
    },
    imageBytes: collageBytes,
    observationScope: input.observationScope,
  });

  try {
    await transactionWithWorkspaceScope(
      { userId: input.userId, workspaceId: input.workspaceId },
      async (executor) => appendManagedImageToCardSideInExecutor(
        executor,
        input.workspaceId,
        {
          cardId: input.cardId,
          targetSide: input.targetSide,
          mediaAssetId,
          altText: input.altText,
        },
        mutationMetadata,
      ),
    );
  } catch (error) {
    if (isCardNotFoundError(error)) {
      throw createCardNotFoundError(input.cardId);
    }
    throw error;
  }

  return {
    cardId: input.cardId,
    targetSide: input.targetSide,
    mediaAssetId,
    sourceMediaAssetIds: input.sourceMediaAssetIds,
  };
}
