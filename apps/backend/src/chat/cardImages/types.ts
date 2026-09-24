import type { CardTextSide } from "../../cards";
import type { EntitlementTier } from "../../billing/tiers";
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
  /** The tier the appended usage fact is attributed to, resolved by the caller that checked the cap. */
  tierAtCall: EntitlementTier;
  observationContext: GeneratedCardImageObservationContext;
  signal: AbortSignal;
  operationDeadlineMs: number;
}>;

/** Input for a surface without a chat run; its operation identity is derived from the request content. */
export type RunlessGeneratedCardImageInput = Omit<
  GeneratedCardImageInput, "runId" | "operationKey" | "sessionId" | "claimToken"
>;

export type GeneratedCardImageOperationInput = GeneratedCardImageInput | RunlessGeneratedCardImageInput;

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
