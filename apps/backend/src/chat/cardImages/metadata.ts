import { createHash } from "node:crypto";
import type { CardTextSide } from "../../cards";
import type { GeneratedCardImageOperationMetadata } from "./types";

const generatedCardImageOperationNamespace = "flashcards-open-source-app:generated-card-image:v1";
const generatedCardImageRequestBucketMs = 3_600_000;

export type GeneratedCardImageRequestContent = Readonly<{
  workspaceId: string;
  cardId: string;
  targetSide: CardTextSide;
  imagePrompt: string;
  altText: string;
  requestedAtMs: number;
}>;

function deterministicUuidFromOperationIdentity(
  purpose: "operation" | "media-asset",
  identity: ReadonlyArray<string | number>,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(
      [generatedCardImageOperationNamespace, purpose, ...identity],
    ))
    .digest();
  const uuidBytes = Buffer.from(digest.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

  const hex = uuidBytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function deriveOperationMetadataFromIdentity(
  identityKind: GeneratedCardImageOperationMetadata["identityKind"],
  identity: ReadonlyArray<string | number>,
): GeneratedCardImageOperationMetadata {
  const operationId = deterministicUuidFromOperationIdentity("operation", identity);
  return {
    identityKind,
    operationId,
    mediaAssetId: deterministicUuidFromOperationIdentity("media-asset", identity),
    mediaLastOperationId: `generated-card-image:${operationId}:media`,
    cardLastOperationId: `generated-card-image:${operationId}:card`,
  };
}

export function deriveGeneratedCardImageOperationMetadata(
  runId: string,
  operationKey: string,
): GeneratedCardImageOperationMetadata {
  return deriveOperationMetadataFromIdentity("chat_run", [runId.toLowerCase(), operationKey]);
}

/**
 * Identity for surfaces without a chat run. `requestedAtMs` is the backend clock at request
 * receipt, bucketed into epoch-aligned UTC hours: a literal repeat inside the hour is the same
 * operation, while a retry that lands in the next hour is a new, separately paid operation.
 */
export function deriveRequestContentGeneratedCardImageOperationMetadata(
  request: GeneratedCardImageRequestContent,
): GeneratedCardImageOperationMetadata {
  if (!Number.isSafeInteger(request.requestedAtMs) || request.requestedAtMs < 0) {
    throw new RangeError(
      "Generated card image requestedAtMs must be a non-negative epoch-millisecond safe integer.",
    );
  }
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify([request.imagePrompt, request.altText]))
    .digest("hex");
  return deriveOperationMetadataFromIdentity("request_content", [
    "request-content",
    request.workspaceId.toLowerCase(),
    request.cardId.toLowerCase(),
    request.targetSide,
    contentSha256,
    Math.floor(request.requestedAtMs / generatedCardImageRequestBucketMs),
  ]);
}
