import type OpenAI from "openai";
import type { LangfuseObservation } from "@langfuse/tracing";
import {
  executeChatToolCall,
  type ExecutedChatToolCall,
} from "./tools";

type ToolTelemetryMetadata = Readonly<{
  toolName: string;
  toolCallId: string;
  argumentLength: number;
  hasArguments: boolean;
  durationMs: number | null;
  outputLength: number | null;
  ok: boolean | null;
  errorClass: string | null;
  errorMessage: string | null;
}>;

function getToolArgumentLength(argumentsJson: string): number {
  return argumentsJson.length;
}

function hasToolArguments(argumentsJson: string): boolean {
  return argumentsJson.trim().length > 0 && argumentsJson.trim() !== "{}";
}

function getErrorClass(error: unknown): string {
  return error instanceof Error ? error.name : "NonErrorThrow";
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return "tool execution failed";
  }

  if (error instanceof Error) {
    return "tool execution failed without message";
  }

  return "tool execution failed with non-error throw";
}

function buildToolTelemetryMetadata(
  params: Readonly<{
    toolName: string;
    toolCallId: string;
    argumentsJson: string;
    durationMs: number | null;
    outputLength: number | null;
    ok: boolean | null;
    errorClass: string | null;
    errorMessage: string | null;
  }>,
): ToolTelemetryMetadata {
  return {
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    argumentLength: getToolArgumentLength(params.argumentsJson),
    hasArguments: hasToolArguments(params.argumentsJson),
    durationMs: params.durationMs,
    outputLength: params.outputLength,
    ok: params.ok,
    errorClass: params.errorClass,
    errorMessage: params.errorMessage,
  };
}

/**
 * Executes one provider tool call and attaches a nested tool observation when Langfuse tracing is active.
 */
export async function runOneToolCall(
  params: Readonly<{
    item: OpenAI.Responses.ResponseFunctionToolCall;
    userId: string;
    workspaceId: string;
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
        ok: null,
        errorClass: null,
        errorMessage: null,
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
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
    );

    toolObservation?.updateOtelSpanAttributes({
      output: {
        ok: true,
        outputLength: result.output.length,
      },
      metadata: buildToolTelemetryMetadata({
        toolName: params.item.name,
        toolCallId: params.item.call_id,
        argumentsJson: params.item.arguments,
        durationMs: Date.now() - startedAt,
        outputLength: result.output.length,
        ok: true,
        errorClass: null,
        errorMessage: null,
      }),
    });
    toolObservation?.end();
    return result;
  } catch (error) {
    toolObservation?.updateOtelSpanAttributes({
      output: {
        ok: false,
      },
      metadata: buildToolTelemetryMetadata({
        toolName: params.item.name,
        toolCallId: params.item.call_id,
        argumentsJson: params.item.arguments,
        durationMs: Date.now() - startedAt,
        outputLength: null,
        ok: false,
        errorClass: getErrorClass(error),
        errorMessage: getSafeErrorMessage(error),
      }),
    });
    toolObservation?.end();
    throw error;
  }
}
