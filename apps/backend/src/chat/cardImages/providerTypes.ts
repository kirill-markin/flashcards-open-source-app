import type { LangfuseObservation } from "@langfuse/tracing";
import type { BackendObservationScope } from "../../observability/sentry";
import type { GeneratedMediaPromotionJobConflictError } from "./promotion/jobs";

export type GeneratedCardImageObservationContext = Readonly<{
  scope: BackendObservationScope;
  rootObservation: LangfuseObservation | null;
}>;

export type GeneratedCardImageOperationReference =
  | Readonly<{ identityKind: "chat_run"; runId: string; operationKey: string }>
  | Readonly<{ identityKind: "request_content"; operationId: string }>;

export function formatGeneratedCardImageOperationReference(
  operation: GeneratedCardImageOperationReference,
): string {
  return operation.identityKind === "chat_run"
    ? `runId=${operation.runId}; operationKey=${operation.operationKey}`
    : `operationId=${operation.operationId}`;
}

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

  constructor(operation: GeneratedCardImageOperationReference) {
    super(
      `OpenAI image generation may already have started, so it cannot be retried automatically. ${formatGeneratedCardImageOperationReference(operation)}`,
    );
    this.name = "GeneratedCardImageProviderOutcomeUnknownError";
  }
}

export class GeneratedCardImageStagingOutcomeUnknownError extends Error {
  readonly code = "GENERATED_CARD_IMAGE_STAGING_OUTCOME_UNKNOWN";

  constructor(operation: GeneratedCardImageOperationReference, cause: unknown) {
    super(
      `OpenAI returned generated image bytes, but managed-media staging did not confirm persistence, so this operation cannot be retried automatically. ${formatGeneratedCardImageOperationReference(operation)}`,
      { cause },
    );
    this.name = "GeneratedCardImageStagingOutcomeUnknownError";
  }
}

export class GeneratedCardImageRequestConflictError extends Error {
  readonly code = "GENERATED_CARD_IMAGE_REQUEST_CONFLICT";

  constructor(operationId: string, cause: GeneratedMediaPromotionJobConflictError) {
    super(
      `A different user or sync replica already requested this image for the same card side, prompt, and alt text during the current UTC hour, so it cannot be queued again until the next hour or until the prompt or alt text changes. operationId=${operationId}`,
      { cause },
    );
    this.name = "GeneratedCardImageRequestConflictError";
  }
}
