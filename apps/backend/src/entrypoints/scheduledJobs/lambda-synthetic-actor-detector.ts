import type { Handler } from "aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";
import type { SyntheticActorDetectorResult } from "../../productAnalytics/syntheticActorDetector";

initializeBackendSentry("synthetic-actor-detector");

type SyntheticActorDetectorResponse = SyntheticActorDetectorResult & Readonly<{ ok: true }>;

const syntheticActorDetectorHandler: Handler<
  Record<string, never>,
  SyntheticActorDetectorResponse
> = async (_event, context) => {
  const scope = createBackendObservationScope(
    "synthetic-actor-detector",
    context.awsRequestId ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  try {
    const { excludeSyntheticActors } = await import("../../productAnalytics/syntheticActorDetector");
    const result = await excludeSyntheticActors(scope);
    return { ok: true, ...result };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "synthetic_actor_detector_failed",
      scope,
      error: normalizedError,
      details: { message: normalizedError.message },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(syntheticActorDetectorHandler);
