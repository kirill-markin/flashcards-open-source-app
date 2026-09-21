/**
 * Per-request telemetry plumbing for the MCP surface: the normalizer every
 * client-controlled label goes through, the tool name a `tools/call` body
 * carries, and the request id that joins the `mcp_request` record with the
 * `agent_sql` records emitted underneath it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const MAX_MCP_TELEMETRY_VALUE_CHARS = 120;

type McpRequestTelemetryContext = Readonly<{
  requestId: string;
}>;

const mcpRequestTelemetryStorage = new AsyncLocalStorage<McpRequestTelemetryContext>();

/**
 * Normalizes a client-controlled value -- a header, or the tool name a
 * `tools/call` body carries -- into what a telemetry record may hold: trimmed,
 * capped, and null when absent or empty. Purely observational, so a missing or
 * unexpected value is recorded as null and never rejected.
 */
export function normalizeMcpTelemetryValue(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return null;
  }

  return trimmedValue.length <= MAX_MCP_TELEMETRY_VALUE_CHARS
    ? trimmedValue
    : trimmedValue.slice(0, MAX_MCP_TELEMETRY_VALUE_CHARS);
}

function readCallToolName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const message = payload as Readonly<{ method?: unknown; params?: unknown }>;
  if (message.method !== "tools/call") {
    return null;
  }

  const params = message.params;
  if (typeof params !== "object" || params === null) {
    return null;
  }

  const toolName = (params as Readonly<{ name?: unknown }>).name;
  return normalizeMcpTelemetryValue(typeof toolName === "string" ? toolName : null);
}

/**
 * The tool a `tools/call` body names, so a call the SDK refuses before any
 * handler runs -- an unknown tool, or arguments its input schema rejects -- is
 * still recorded as an attempt on that tool rather than as a nameless request.
 * Only `params.name` is read; the arguments carry flashcard content and are
 * never touched. A batch reports its last `tools/call`, the rule the in-process
 * tool name already follows.
 *
 * Purely observational, like the normalizer above: a body this cannot read is
 * null and never an error, and it reads a clone, so the body the transport
 * consumes afterwards is untouched.
 */
export async function readCallToolNameFromRequestBody(request: Request): Promise<string | null> {
  try {
    const payload: unknown = await request.clone().json();
    if (Array.isArray(payload)) {
      const messages: ReadonlyArray<unknown> = payload;
      return messages.reduce<string | null>(
        (lastToolName, message) => readCallToolName(message) ?? lastToolName,
        null,
      );
    }

    return readCallToolName(payload);
  } catch {
    return null;
  }
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
