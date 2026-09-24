import type { AiUsageCounters } from "../../../aiUsage";
import type { GeneratedCardImageObservationContext } from "../providerTypes";

export type GeneratedProviderImage = Readonly<{
  bytes: Buffer;
  providerRequestId: string | null;
  /** What the provider reported for the attempt that produced these bytes, or null if it reported none. */
  usageCounters: AiUsageCounters | null;
}>;

export type OpenAIImageGenerationInput = Readonly<{
  userId: string;
  imagePrompt: string;
  observationContext: GeneratedCardImageObservationContext;
  signal: AbortSignal;
  operationDeadlineMs: number;
}>;
