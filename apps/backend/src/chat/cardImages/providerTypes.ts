import type { LangfuseObservation } from "@langfuse/tracing";
import type { BackendObservationScope } from "../../observability/sentry";

export type GeneratedCardImageObservationContext = Readonly<{
  scope: BackendObservationScope;
  rootObservation: LangfuseObservation | null;
}>;

export class GeneratedCardImageDeadlineExceededError extends Error {
  readonly code = "GENERATED_CARD_IMAGE_DEADLINE_EXCEEDED";

  constructor(cause: unknown | null) {
    super("The generated card image operation exceeded its safe execution deadline.",
      cause === null ? undefined : { cause });
    this.name = "GeneratedCardImageDeadlineExceededError";
  }
}

export class GeneratedCardImageProviderOutcomeUnknownError extends Error {
  readonly code = "GENERATED_CARD_IMAGE_PROVIDER_OUTCOME_UNKNOWN";

  constructor(runId: string, operationKey: string) {
    super(
      `OpenAI image generation may already have started, so it cannot be retried automatically. runId=${runId}; operationKey=${operationKey}`,
    );
    this.name = "GeneratedCardImageProviderOutcomeUnknownError";
  }
}

export class GeneratedCardImageStagingOutcomeUnknownError extends Error {
  readonly code = "GENERATED_CARD_IMAGE_STAGING_OUTCOME_UNKNOWN";

  constructor(runId: string, operationKey: string, cause: unknown) {
    super(
      `OpenAI returned generated image bytes, but managed-media staging did not confirm persistence, so this operation cannot be retried automatically. runId=${runId}; operationKey=${operationKey}`,
      { cause },
    );
    this.name = "GeneratedCardImageStagingOutcomeUnknownError";
  }
}
