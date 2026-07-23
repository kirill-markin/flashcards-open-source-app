import type { LangfuseObservation } from "@langfuse/tracing";
import type { BackendObservationScope } from "../../observability/sentry";

export type GeneratedCardImageObservationContext = Readonly<{
  scope: BackendObservationScope;
  rootObservation: LangfuseObservation | null;
}>;

export type GeneratedProviderImage = Readonly<{
  bytes: Buffer;
  providerRequestId: string | null;
}>;

export type OpenAIImageGenerationInput = Readonly<{
  userId: string;
  imagePrompt: string;
  observationContext: GeneratedCardImageObservationContext;
  signal: AbortSignal;
}>;
