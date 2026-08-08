import type { GeneratedCardImageObservationContext } from "../providerTypes";

export type GeneratedProviderImage = Readonly<{
  bytes: Buffer;
  providerRequestId: string | null;
}>;

export type OpenAIImageGenerationInput = Readonly<{
  userId: string;
  imagePrompt: string;
  observationContext: GeneratedCardImageObservationContext;
  signal: AbortSignal;
  operationDeadlineMs: number;
}>;
