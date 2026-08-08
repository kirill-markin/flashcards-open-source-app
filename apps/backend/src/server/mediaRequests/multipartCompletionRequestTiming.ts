import { AsyncLocalStorage } from "node:async_hooks";
import { publicRestApiIntegrationTimeoutMs } from "./directImageIngestionRequestTiming";

export const multipartCompletionRequestBudgetMs = 25_000;
export const multipartCompletionResponseHeadroomMs = 2_000;
export const multipartCompletionResolutionReserveMs = 4_000;
export const multipartCompletionMinimumOperationBudgetMs = 10_000;
export const multipartCompletionMinimumLeaseBoundaryMarginMs = 500;

export type MultipartCompletionRequestTiming = Readonly<{
  ingressAtMs: number;
  integrationDeadlineAtMs: number;
  requestDeadlineAtMs: number;
  operationDeadlineAtMs: number;
  writerLeaseTargetAtMs: number;
  acquisitionDeadlineAtMs: number;
  lambdaDeadlineAtMs: number;
}>;

type MultipartCompletionRequestContext = Readonly<{
  timing: MultipartCompletionRequestTiming | null;
}>;

const multipartCompletionRequestContextStorage =
  new AsyncLocalStorage<MultipartCompletionRequestContext>();

function toRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function parseIngressAtMs(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1
    ? value as number
    : null;
}

export function readMultipartCompletionIngressAtMs(
  event: unknown,
): number | null {
  const eventRecord = toRecord(event);
  const requestContext = toRecord(eventRecord?.requestContext);
  if (eventRecord === null || requestContext === null) return null;
  return eventRecord.version === "2.0"
    ? parseIngressAtMs(requestContext.timeEpoch)
    : parseIngressAtMs(requestContext.requestTimeEpoch);
}

export function createMultipartCompletionRequestTiming(
  ingressAtMs: number,
  observedAtMs: number,
  remainingInvocationTimeMs: number,
): MultipartCompletionRequestTiming {
  if (
    !Number.isSafeInteger(ingressAtMs)
    || ingressAtMs < 1
    || ingressAtMs
      > Number.MAX_SAFE_INTEGER - publicRestApiIntegrationTimeoutMs
  ) {
    throw new RangeError(
      "Multipart completion ingress time must be a positive epoch-millisecond safe integer.",
    );
  }
  if (
    !Number.isSafeInteger(observedAtMs)
    || observedAtMs < 1
    || !Number.isSafeInteger(remainingInvocationTimeMs)
    || remainingInvocationTimeMs < 1
    || observedAtMs > Number.MAX_SAFE_INTEGER - remainingInvocationTimeMs
  ) {
    throw new RangeError(
      "Multipart completion Lambda timing must contain a valid observation time and remaining invocation budget.",
    );
  }
  if (
    multipartCompletionRequestBudgetMs
      > publicRestApiIntegrationTimeoutMs
        - multipartCompletionResponseHeadroomMs
    || multipartCompletionResolutionReserveMs
      >= multipartCompletionRequestBudgetMs
    || multipartCompletionMinimumOperationBudgetMs
      >= multipartCompletionRequestBudgetMs
        - multipartCompletionResolutionReserveMs
    || multipartCompletionResolutionReserveMs
      < multipartCompletionMinimumLeaseBoundaryMarginMs * 2
  ) {
    throw new Error("Multipart completion request timing margins are invalid.");
  }

  const integrationDeadlineAtMs =
    ingressAtMs + publicRestApiIntegrationTimeoutMs;
  const lambdaDeadlineAtMs = observedAtMs + remainingInvocationTimeMs;
  const requestDeadlineAtMs = Math.min(
    ingressAtMs + multipartCompletionRequestBudgetMs,
    integrationDeadlineAtMs - multipartCompletionResponseHeadroomMs,
    lambdaDeadlineAtMs - multipartCompletionResponseHeadroomMs,
  );
  const operationDeadlineAtMs =
    requestDeadlineAtMs - multipartCompletionResolutionReserveMs;
  const writerLeaseTargetAtMs = createMultipartCompletionWriterLeaseTargetAtMs(
    operationDeadlineAtMs,
    requestDeadlineAtMs,
  );

  return Object.freeze({
    ingressAtMs,
    integrationDeadlineAtMs,
    requestDeadlineAtMs,
    operationDeadlineAtMs,
    writerLeaseTargetAtMs,
    acquisitionDeadlineAtMs:
      operationDeadlineAtMs - multipartCompletionMinimumOperationBudgetMs,
    lambdaDeadlineAtMs,
  });
}

export function createMultipartCompletionWriterLeaseTargetAtMs(
  operationDeadlineAtMs: number,
  requestDeadlineAtMs: number,
): number {
  if (
    !Number.isSafeInteger(operationDeadlineAtMs)
    || !Number.isSafeInteger(requestDeadlineAtMs)
    || operationDeadlineAtMs < 1
    || requestDeadlineAtMs < 1
  ) {
    throw new RangeError(
      "Multipart completion lease timing deadlines must be positive epoch-millisecond safe integers.",
    );
  }
  const resolutionWindowMs = requestDeadlineAtMs - operationDeadlineAtMs;
  if (
    resolutionWindowMs
      < multipartCompletionMinimumLeaseBoundaryMarginMs * 2
  ) {
    throw new RangeError(
      "Multipart completion resolution window is too short to separate storage abort, lease expiry, and exact resolution.",
    );
  }
  const writerLeaseTargetAtMs =
    operationDeadlineAtMs + Math.floor(resolutionWindowMs / 2);
  if (
    writerLeaseTargetAtMs - operationDeadlineAtMs
      < multipartCompletionMinimumLeaseBoundaryMarginMs
    || requestDeadlineAtMs - writerLeaseTargetAtMs
      < multipartCompletionMinimumLeaseBoundaryMarginMs
  ) {
    throw new Error(
      "Multipart completion writer lease target does not preserve its required timing margins.",
    );
  }
  return writerLeaseTargetAtMs;
}

export function createStandaloneMultipartCompletionRequestTiming(
  ingressAtMs: number,
): MultipartCompletionRequestTiming {
  return createMultipartCompletionRequestTiming(
    ingressAtMs,
    ingressAtMs,
    publicRestApiIntegrationTimeoutMs,
  );
}

export function runWithMultipartCompletionRequestTiming<Result>(
  timing: MultipartCompletionRequestTiming | null,
  callback: () => Promise<Result>,
): Promise<Result> {
  return multipartCompletionRequestContextStorage.run(
    { timing },
    callback,
  );
}

export function getMultipartCompletionRequestTimingContext():
MultipartCompletionRequestContext | null {
  return multipartCompletionRequestContextStorage.getStore() ?? null;
}
