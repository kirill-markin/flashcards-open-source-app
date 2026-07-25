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
  operationDeadlineMs: number;
}>;

export class GeneratedCardImageDeadlineExceededError extends Error {
  readonly code = "GENERATED_CARD_IMAGE_DEADLINE_EXCEEDED";

  constructor(cause: unknown | null) {
    super("The generated card image operation exceeded its safe execution deadline.",
      cause === null ? undefined : { cause });
    this.name = "GeneratedCardImageDeadlineExceededError";
  }
}
