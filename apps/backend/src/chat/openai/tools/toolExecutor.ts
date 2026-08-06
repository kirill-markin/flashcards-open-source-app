import type OpenAI from "openai";
import type { LangfuseObservation, ObservationLevel } from "@langfuse/tracing";
import {
  createBackendObservationScope,
  getBackendErrorLogDetails,
} from "../../../observability/sentry";
import {
  executeChatToolCall,
  type ExecutedChatToolCall,
} from "./tools";
import type { ChatRunClaimToken } from "../../runs";

/**
 * A tool that returned an error envelope to the model and a tool that threw are different
 * operator situations, so the exported outcome keeps them apart instead of one boolean.
 */
type ToolCallOutcome = "success" | "tool_error" | "thrown";

type ToolTelemetryMetadata = Readonly<{
  toolName: string;
  toolCallId: string;
  argumentLength: number;
  hasArguments: boolean;
  durationMs: number | null;
  outputLength: number | null;
  outcome: ToolCallOutcome | null;
  errorClass: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  dialectReason: string | null;
  generatedImageAttempt: number | null;
  generatedImageStatus: string | null;
  sqlStatementType: string | null;
  sqlStatementCount: number | null;
  sqlRowOrAffectedCount: number | null;
  sqlDurationMs: number | null;
}>;

/** Upper bound for one exported error message so a long provider error cannot flood the span. */
const MAX_TELEMETRY_ERROR_MESSAGE_CHARS = 300 as const;

function getToolArgumentLength(argumentsJson: string): number {
  return argumentsJson.length;
}

function hasToolArguments(argumentsJson: string): boolean {
  return argumentsJson.trim().length > 0 && argumentsJson.trim() !== "{}";
}

function getErrorClass(error: unknown): string {
  return error instanceof Error ? error.name : "NonErrorThrow";
}

/**
 * Exports the real cause of a thrown tool call as one short line.
 * The Langfuse span processor masks the exported value with `sanitizeTelemetryValue`, and the
 * repository sanitizer already strips internal error text before it reaches this point.
 */
function getSanitizedErrorMessage(error: unknown): string | null {
  const firstLine = getBackendErrorLogDetails(error).errorMessage.split("\n", 1)[0]?.trim() ?? "";
  return firstLine === "" ? null : firstLine.slice(0, MAX_TELEMETRY_ERROR_MESSAGE_CHARS);
}

function buildToolTelemetryMetadata(
  params: Readonly<{
    toolName: string;
    toolCallId: string;
    argumentsJson: string;
    durationMs: number | null;
    outputLength: number | null;
    outcome: ToolCallOutcome | null;
    errorClass: string | null;
    errorMessage: string | null;
    result: ExecutedChatToolCall | null;
  }>,
): ToolTelemetryMetadata {
  const generatedImage = params.result?.generatedImageTelemetry ?? null;
  const sql = params.result?.sqlTelemetry ?? null;
  return {
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    argumentLength: getToolArgumentLength(params.argumentsJson),
    hasArguments: hasToolArguments(params.argumentsJson),
    durationMs: params.durationMs,
    outputLength: params.outputLength,
    outcome: params.outcome,
    errorClass: params.errorClass,
    errorMessage: params.errorMessage,
    errorCode: sql?.errorCode ?? null,
    dialectReason: sql?.dialectReason ?? null,
    generatedImageAttempt: generatedImage?.attempt ?? null,
    generatedImageStatus: generatedImage?.status ?? null,
    sqlStatementType: sql?.statementType ?? null,
    sqlStatementCount: sql?.statementCount ?? null,
    sqlRowOrAffectedCount: sql?.rowOrAffectedCount ?? null,
    sqlDurationMs: sql?.durationMs ?? null,
  };
}

/**
 * Builds the Langfuse `statusMessage` of a failed tool observation from the identifying
 * fields already exported as metadata, so the built-in error view names the cause.
 */
function buildToolStatusMessage(metadata: ToolTelemetryMetadata): string {
  const details = [
    metadata.errorClass,
    metadata.errorCode,
    metadata.dialectReason,
    metadata.errorMessage,
  ].filter((detail): detail is string => detail !== null && detail !== "");
  const outcome = metadata.outcome ?? "thrown";
  return details.length === 0 ? outcome : `${outcome}: ${details.join(" | ")}`;
}

/**
 * Marks a failed tool observation with Langfuse own error semantics so operators can filter
 * failed tool calls in the UI instead of parsing full generations.
 *
 * A tool call that threw always qualifies. A tool call that returned an error envelope only
 * qualifies when it carries SQL telemetry, because a SQL envelope always reports a real failure,
 * while the generated-image tool reports expected product outcomes such as `limit_reached` the
 * same way and its genuine provider failures already own the provider observation. Both keep
 * exporting `outcome` as metadata either way.
 */
function buildFailureObservationAttributes(
  metadata: ToolTelemetryMetadata,
  result: ExecutedChatToolCall | null,
): Readonly<{ level?: ObservationLevel; statusMessage?: string }> {
  const failed = metadata.outcome === "thrown"
    || (metadata.outcome === "tool_error" && (result?.sqlTelemetry ?? null) !== null);
  return failed
    ? { level: "ERROR", statusMessage: buildToolStatusMessage(metadata) }
    : {};
}

/**
 * Executes one provider tool call and attaches a nested tool observation when Langfuse tracing is active.
 */
export async function runOneToolCall(
  params: Readonly<{
    item: OpenAI.Responses.ResponseFunctionToolCall;
    requestId: string;
    runId: string;
    sessionId: string;
    operationKey: string;
    generatedImageEligible: boolean;
    claimToken: ChatRunClaimToken;
    userId: string;
    workspaceId: string;
    signal: AbortSignal | null;
    generatedImageOperationDeadlineMs: number;
    rootObservation: LangfuseObservation | null;
  }>,
): Promise<ExecutedChatToolCall> {
  const toolObservation = params.rootObservation?.startObservation(
    params.item.name,
    {
      input: {
        argumentLength: getToolArgumentLength(params.item.arguments),
        hasArguments: hasToolArguments(params.item.arguments),
      },
      metadata: buildToolTelemetryMetadata({
        toolName: params.item.name,
        toolCallId: params.item.call_id,
        argumentsJson: params.item.arguments,
        durationMs: null,
        outputLength: null,
        outcome: null,
        errorClass: null,
        errorMessage: null,
        result: null,
      }),
    },
    {
      asType: "tool",
    },
  ) ?? null;

  const startedAt = Date.now();

  try {
    const result = await executeChatToolCall(
      params.item.name,
      params.item.arguments,
      {
        runId: params.runId,
        sessionId: params.sessionId,
        operationKey: params.operationKey,
        generatedImageEligible: params.generatedImageEligible,
        userId: params.userId,
        workspaceId: params.workspaceId,
        claimToken: params.claimToken,
        signal: params.signal,
        generatedImageOperationDeadlineMs: params.generatedImageOperationDeadlineMs,
        generatedImageObservationContext: {
          scope: createBackendObservationScope(
            "chat-worker", null, null, null, params.userId, params.workspaceId,
            params.requestId, params.runId, params.sessionId, null, null,
          ),
          rootObservation: params.rootObservation,
        },
      },
    );

    const outcome: ToolCallOutcome = result.succeeded ? "success" : "tool_error";
    const metadata = buildToolTelemetryMetadata({
      toolName: params.item.name,
      toolCallId: params.item.call_id,
      argumentsJson: params.item.arguments,
      durationMs: Date.now() - startedAt,
      outputLength: result.output.length,
      outcome,
      errorClass: result.sqlTelemetry?.errorClass ?? null,
      errorMessage: null,
      result,
    });
    toolObservation?.updateOtelSpanAttributes({
      output: {
        outcome,
        outputLength: result.output.length,
      },
      metadata,
      ...buildFailureObservationAttributes(metadata, result),
    });
    toolObservation?.end();
    return result;
  } catch (error) {
    const metadata = buildToolTelemetryMetadata({
      toolName: params.item.name,
      toolCallId: params.item.call_id,
      argumentsJson: params.item.arguments,
      durationMs: Date.now() - startedAt,
      outputLength: null,
      outcome: "thrown",
      errorClass: getErrorClass(error),
      errorMessage: getSanitizedErrorMessage(error),
      result: null,
    });
    toolObservation?.updateOtelSpanAttributes({
      output: {
        outcome: "thrown",
      },
      metadata,
      ...buildFailureObservationAttributes(metadata, null),
    });
    toolObservation?.end();
    throw error;
  }
}
