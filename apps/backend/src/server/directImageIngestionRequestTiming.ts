import { AsyncLocalStorage } from "node:async_hooks";

export const publicRestApiIntegrationTimeoutMs = 29_000;
export const directImageIngestionMaximumOnDemandInitMs = 10_000;
export const directImageIngestionLambdaInvokeTimeoutMs = 15_000;
export const directImageIngestionIntegrationEnvelopeMs =
  directImageIngestionMaximumOnDemandInitMs
  + directImageIngestionLambdaInvokeTimeoutMs;
export const directImageIngestionGatewayServiceHeadroomMs =
  publicRestApiIntegrationTimeoutMs
  - directImageIngestionIntegrationEnvelopeMs;
export const directImageIngestionResponseMarginMs = 2_000;
export const directImageIngestionRequestBudgetMs =
  directImageIngestionLambdaInvokeTimeoutMs
  - directImageIngestionResponseMarginMs;
export const directImageIngestionMinimumAcquisitionBudgetMs = 10_000;

export type DirectImageIngestionRequestTiming = Readonly<{
  ingressAtMs: number;
  integrationDeadlineAtMs: number;
  requestDeadlineAtMs: number;
  preprocessingDeadlineAtMs: number;
  lambdaDeadlineAtMs: number;
  getRemainingInvocationTimeMs: () => number;
}>;

type DirectImageIngestionRequestContext = Readonly<{
  requestId: string;
  timing: DirectImageIngestionRequestTiming;
}>;

const directImageIngestionRequestContextStorage =
  new AsyncLocalStorage<DirectImageIngestionRequestContext>();

export function createDirectImageIngestionRequestTiming(
  ingressAtMs: number,
  observedAtMs: number,
  getRemainingInvocationTimeMs: () => number,
): DirectImageIngestionRequestTiming {
  const remainingInvocationTimeMs = getRemainingInvocationTimeMs();
  if (
    !Number.isSafeInteger(ingressAtMs)
    || ingressAtMs < 1
    || ingressAtMs
      > Number.MAX_SAFE_INTEGER - directImageIngestionIntegrationEnvelopeMs
  ) {
    throw new RangeError(
      "Direct image ingestion ingress time must be a positive epoch-millisecond safe integer.",
    );
  }
  if (
    !Number.isSafeInteger(observedAtMs)
    || observedAtMs < 1
    || !Number.isSafeInteger(remainingInvocationTimeMs)
    || remainingInvocationTimeMs < 1
    || remainingInvocationTimeMs > directImageIngestionLambdaInvokeTimeoutMs
    || observedAtMs > Number.MAX_SAFE_INTEGER - remainingInvocationTimeMs
  ) {
    throw new RangeError(
      "Direct image ingestion Lambda timing must contain a valid observation time and remaining Invoke budget.",
    );
  }
  if (
    directImageIngestionIntegrationEnvelopeMs >= publicRestApiIntegrationTimeoutMs
    || directImageIngestionGatewayServiceHeadroomMs < 4_000
    || directImageIngestionRequestBudgetMs
      + directImageIngestionResponseMarginMs
      !== directImageIngestionLambdaInvokeTimeoutMs
    || directImageIngestionRequestBudgetMs >= directImageIngestionIntegrationEnvelopeMs
    || directImageIngestionMinimumAcquisitionBudgetMs >= directImageIngestionRequestBudgetMs
  ) {
    throw new Error("Direct image ingestion request timing margins are invalid.");
  }

  const lambdaDeadlineAtMs = observedAtMs + remainingInvocationTimeMs;
  const requestDeadlineAtMs = Math.min(
    ingressAtMs + directImageIngestionRequestBudgetMs,
    lambdaDeadlineAtMs - directImageIngestionResponseMarginMs,
  );
  return Object.freeze({
    ingressAtMs,
    integrationDeadlineAtMs:
      ingressAtMs + directImageIngestionIntegrationEnvelopeMs,
    requestDeadlineAtMs,
    preprocessingDeadlineAtMs:
      requestDeadlineAtMs - directImageIngestionMinimumAcquisitionBudgetMs,
    lambdaDeadlineAtMs,
    getRemainingInvocationTimeMs,
  });
}

export function createStandaloneDirectImageIngestionRequestTiming(
  ingressAtMs: number,
): DirectImageIngestionRequestTiming {
  return createDirectImageIngestionRequestTiming(
    ingressAtMs,
    ingressAtMs,
    () => directImageIngestionLambdaInvokeTimeoutMs,
  );
}

export function getDirectImageIngestionRemainingRequestTimeMs(
  timing: DirectImageIngestionRequestTiming,
  observedAtMs: number,
): number {
  const remainingInvocationTimeMs = timing.getRemainingInvocationTimeMs();
  if (
    !Number.isSafeInteger(remainingInvocationTimeMs)
    || remainingInvocationTimeMs < 0
    || remainingInvocationTimeMs > directImageIngestionLambdaInvokeTimeoutMs
  ) {
    return 0;
  }
  return Math.min(
    timing.requestDeadlineAtMs - observedAtMs,
    remainingInvocationTimeMs - directImageIngestionResponseMarginMs,
  );
}

export function runWithDirectImageIngestionRequestContext<Result>(
  requestId: string,
  timing: DirectImageIngestionRequestTiming,
  callback: () => Promise<Result>,
): Promise<Result> {
  return directImageIngestionRequestContextStorage.run(
    { requestId, timing },
    callback,
  );
}

export function getDirectImageIngestionRequestTiming():
DirectImageIngestionRequestTiming | null {
  return directImageIngestionRequestContextStorage.getStore()?.timing ?? null;
}

export function getDirectImageIngestionRequestId(): string | null {
  return directImageIngestionRequestContextStorage.getStore()?.requestId ?? null;
}
