import { cutHeadAtCodePoint } from "../shared/codePointCuts";
import { describeNetworkError, readNetworkErrorCode } from "./presignedTransfer";

/**
 * The HTTP transport the sandbox host shares between its bridges to the backend API (`./sqlBridge/`,
 * `./mediaBridge/`). The URL and the capability never reach a message: the command's code reads every
 * one of them.
 */

export const bridgeRetryDelaysMs: ReadonlyArray<number> = [500, 1_000, 2_000];
/** Outlives API Gateway's 29-second integration timeout, so a slow call ends in the gateway's own answer. */
const attemptTimeoutMs = 35_000;
/** Failures raised before the request left, so a write may repeat it without landing twice. */
const unsentRequestErrorCodes: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);
/** API Gateway's answers for a request the backend did not finish. */
const gatewayFailureStatuses: ReadonlySet<number> = new Set([502, 503, 504]);
const throttledStatus = 429;
const maximumFailureBodyChars = 1_000;

export type BridgeAttemptOutcome =
  | Readonly<{ answered: true; status: number; body: string }>
  | Readonly<{ answered: false; error: unknown }>;

export type BridgeRequest = Readonly<{
  url: string;
  method: "GET" | "POST";
  authorization: string;
  contentType: string | null;
  body: string | Uint8Array | null;
}>;

export function isUnsentRequestError(error: unknown): boolean {
  const code = readNetworkErrorCode(error);
  return code !== null && unsentRequestErrorCodes.has(code);
}

/**
 * Throttling, and a request that failed before it left, refuse a call before it runs; anything else is
 * repeated only for a call that changes nothing.
 */
export function isBridgeAttemptRetryable(readOnly: boolean, outcome: BridgeAttemptOutcome): boolean {
  if (outcome.answered) {
    return outcome.status === throttledStatus || (readOnly && gatewayFailureStatuses.has(outcome.status));
  }

  return readOnly || isUnsentRequestError(outcome.error);
}

export function describeBridgeOutcome(outcome: BridgeAttemptOutcome): string {
  return outcome.answered
    ? `HTTP ${outcome.status} ${cutHeadAtCodePoint(outcome.body, maximumFailureBodyChars)}`
    : describeNetworkError(outcome.error);
}

export async function sendBridgeAttempt(
  request: BridgeRequest,
  signal: AbortSignal | undefined,
): Promise<BridgeAttemptOutcome> {
  const timeout = AbortSignal.timeout(attemptTimeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.contentType === null
        ? { authorization: request.authorization }
        : { authorization: request.authorization, "content-type": request.contentType },
      ...(request.body === null ? {} : { body: request.body }),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    return { answered: true, status: response.status, body: await response.text() };
  } catch (error) {
    signal?.throwIfAborted();
    return { answered: false, error };
  }
}
