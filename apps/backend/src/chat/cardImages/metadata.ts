import { createHash } from "node:crypto";
import type { CardTextSide } from "../../cards";
import type { GeneratedCardImageOperationMetadata } from "./types";

const generatedCardImageOperationNamespace = "flashcards-open-source-app:generated-card-image:v1";

function deterministicUuidFromOperationIdentity(
  purpose: "operation" | "media-asset",
  runId: string,
  cardId: string,
  targetSide: CardTextSide,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(
      [generatedCardImageOperationNamespace, purpose, runId.toLowerCase(), cardId.toLowerCase(), targetSide],
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

export function deriveGeneratedCardImageOperationMetadata(
  runId: string,
  cardId: string,
  targetSide: CardTextSide,
): GeneratedCardImageOperationMetadata {
  const operationId = deterministicUuidFromOperationIdentity("operation", runId, cardId, targetSide);
  return {
    operationId,
    mediaAssetId: deterministicUuidFromOperationIdentity("media-asset", runId, cardId, targetSide),
    mediaLastOperationId: `generated-card-image:${operationId}:media`,
    cardLastOperationId: `generated-card-image:${operationId}:card`,
  };
}
