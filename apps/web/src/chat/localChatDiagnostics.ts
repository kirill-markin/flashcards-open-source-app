/**
 * Browser-local chat diagnostics helpers.
 *
 * The runtime emits best-effort telemetry so SSE decoding failures and backend
 * stream anomalies can be correlated with API Gateway and backend logs without
 * interrupting the user flow when diagnostic delivery fails.
 */
import { sendLocalChatDiagnostics as postLocalChatDiagnostics } from "../api";
import type { LocalChatDiagnosticsPayload } from "../types";

export type ChatResponseMetadata = Readonly<{
  statusCode: number | null;
  responseRequestId: string | null;
  responseContentType: string | null;
  responseContentLength: string | null;
  responseContentEncoding: string | null;
  responseCacheControl: string | null;
  responseAmznRequestId: string | null;
  responseApiGatewayId: string | null;
  responseBodyMissing: boolean;
}>;

/**
 * Normalizes exposed response headers so diagnostics can distinguish missing
 * headers from empty string values returned by intermediaries.
 */
function readResponseHeader(response: Response, headerName: string): string | null {
  const value = response.headers.get(headerName);
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

/**
 * Captures the response metadata that is useful for diagnosing browser stream
 * behavior without forcing callers to inspect raw headers.
 */
export function buildChatResponseMetadata(response: Response | null): ChatResponseMetadata {
  if (response === null) {
    return {
      statusCode: null,
      responseRequestId: null,
      responseContentType: null,
      responseContentLength: null,
      responseContentEncoding: null,
      responseCacheControl: null,
      responseAmznRequestId: null,
      responseApiGatewayId: null,
      responseBodyMissing: true,
    };
  }

  return {
    statusCode: response.status,
    responseRequestId: readResponseHeader(response, "x-chat-request-id"),
    responseContentType: readResponseHeader(response, "content-type"),
    responseContentLength: readResponseHeader(response, "content-length"),
    responseContentEncoding: readResponseHeader(response, "content-encoding"),
    responseCacheControl: readResponseHeader(response, "cache-control"),
    responseAmznRequestId: readResponseHeader(response, "x-amzn-requestid"),
    responseApiGatewayId: readResponseHeader(response, "x-amz-apigw-id"),
    responseBodyMissing: response.body === null,
  };
}

/**
 * Sends frontend chat diagnostics without surfacing delivery failures to the
 * user-facing runtime flow.
 */
export async function reportLocalChatDiagnostics(payload: LocalChatDiagnosticsPayload): Promise<void> {
  const localAction = payload.kind === "latency"
    ? "chat_local_latency"
    : "chat_local_frontend_diagnostics";
  console.info(localAction, payload);

  try {
    await postLocalChatDiagnostics(payload);
  } catch (error) {
    console.error("chat_local_frontend_diagnostics_failed", {
      kind: payload.kind,
      clientRequestId: payload.clientRequestId,
      backendRequestId: payload.backendRequestId,
      stage: payload.kind === "failure" ? payload.stage : payload.result,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
