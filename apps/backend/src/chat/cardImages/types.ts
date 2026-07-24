import type { CardTextSide } from "../../cards";
import type { GeneratedCardImageObservationContext } from "./providerTypes";

export type GeneratedCardImageInput = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
  cardId: string;
  targetSide: CardTextSide;
  imagePrompt: string;
  altText: string;
  replicaId: string;
  observationContext: GeneratedCardImageObservationContext;
  signal: AbortSignal;
}>;

export type GeneratedCardImageResult = Readonly<{
  cardId: string;
  mediaAssetId: string;
  targetSide: CardTextSide;
  mediaRegistrationApplied: boolean;
  cardAppendApplied: boolean;
  reused: boolean;
  sourceUrl: null;
}>;

export type GeneratedCardImageOperationMetadata = Readonly<{
  operationId: string;
  mediaAssetId: string;
  mediaLastOperationId: string;
  cardLastOperationId: string;
}>;
