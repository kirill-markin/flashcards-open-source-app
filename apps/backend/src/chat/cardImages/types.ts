import type { CardTextSide } from "../../cards";
import type { ChatRunClaimToken } from "../runs";
import type { GeneratedCardImageObservationContext } from "./providerTypes";

export type GeneratedCardImageInput = Readonly<{
  runId: string;
  operationKey: string;
  sessionId: string;
  claimToken: ChatRunClaimToken;
  userId: string;
  workspaceId: string;
  cardId: string;
  targetSide: CardTextSide;
  imagePrompt: string;
  altText: string;
  replicaId: string;
  observationContext: GeneratedCardImageObservationContext;
  signal: AbortSignal;
  operationDeadlineMs: number;
}>;

export type GeneratedCardImageResult = Readonly<{
  status: "queued" | "already_queued";
  cardId: string;
  mediaAssetId: string;
  targetSide: CardTextSide;
  mediaRegistrationApplied: boolean;
  cardAppendApplied: boolean;
  placeholderApplied: boolean;
  reused: boolean;
  sourceUrl: null;
}>;

export type GeneratedCardImageOperationMetadata = Readonly<{
  operationId: string;
  mediaAssetId: string;
  mediaLastOperationId: string;
  cardLastOperationId: string;
}>;
