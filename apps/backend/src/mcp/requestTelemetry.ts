/**
 * Per-request telemetry plumbing for the MCP surface: the normalizer every
 * client-controlled label goes through, and the request id that joins the
 * `mcp_request` record with the `agent_sql` records emitted underneath it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const MAX_MCP_TELEMETRY_HEADER_CHARS = 120;

type McpRequestTelemetryContext = Readonly<{
  requestId: string;
}>;

const mcpRequestTelemetryStorage = new AsyncLocalStorage<McpRequestTelemetryContext>();

/**
 * Normalizes a client-controlled header value into what a telemetry record may
 * carry: trimmed, capped, and null when absent or empty. Purely observational,
 * so a missing or unexpected value is recorded as null and never rejected.
 */
export function normalizeMcpTelemetryHeader(headerValue: string | null): string | null {
  if (headerValue === null) {
    return null;
  }

  const trimmedValue = headerValue.trim();
  if (trimmedValue === "") {
    return null;
  }

  return trimmedValue.length <= MAX_MCP_TELEMETRY_HEADER_CHARS
    ? trimmedValue
    : trimmedValue.slice(0, MAX_MCP_TELEMETRY_HEADER_CHARS);
}

/**
 * Publishes the MCP request id for the duration of one transport request, so
 * everything the request runs underneath -- the SQL telemetry and the MCP tool
 * layer's Sentry captures alike -- records the same id. The SQL executors are
 * shared with the REST and chat surfaces, so their telemetry cannot take an
 * MCP-specific argument; the id travels out of band instead, the way the
 * repository already carries per-request context (see
 * apps/backend/src/server/mediaRequests/multipartCompletionRequestTiming.ts).
 */
export function runWithMcpRequestId<Result>(
  requestId: string,
  callback: () => Promise<Result>,
): Promise<Result> {
  return mcpRequestTelemetryStorage.run({ requestId }, callback);
}

/**
 * The MCP request id of the request currently being served, or null outside the
 * MCP transport.
 */
export function getMcpRequestId(): string | null {
  return mcpRequestTelemetryStorage.getStore()?.requestId ?? null;
}
