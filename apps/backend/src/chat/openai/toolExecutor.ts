import type OpenAI from "openai";
import type { LangfuseObservation } from "@langfuse/tracing";
import {
  executeChatToolCall,
  type ExecutedChatToolCall,
} from "./tools";

function sanitizeToolOutputForTelemetry(output: string): string {
  return output.length <= 4_000
    ? output
    : `${output.slice(0, 4_000)}...`;
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
        arguments: params.item.arguments,
      },
      metadata: {
        toolName: params.item.name,
        toolCallId: params.item.call_id,
      },
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
        output: sanitizeToolOutputForTelemetry(result.output),
      },
      metadata: {
        toolName: params.item.name,
        toolCallId: params.item.call_id,
        durationMs: String(Date.now() - startedAt),
      },
    });
    toolObservation?.end();
    return result;
  } catch (error) {
    toolObservation?.updateOtelSpanAttributes({
      output: {
        error: error instanceof Error ? error.message : String(error),
      },
      metadata: {
        toolName: params.item.name,
        toolCallId: params.item.call_id,
        durationMs: String(Date.now() - startedAt),
      },
    });
    toolObservation?.end();
    throw error;
  }
}
