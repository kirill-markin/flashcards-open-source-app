/**
 * Pure-function content diffing for the SSE live handler.
 * Compares two snapshots of an in-progress assistant item's content array
 * and produces the SSE events representing new content since the last emission.
 */
import type { ChatLiveEventPayload } from "./contract";
import type { ContentPart } from "./types";

function getToolCallOutputIndex(part: Extract<ContentPart, { type: "tool_call" }>): number {
  return part.streamPosition?.outputIndex ?? 0;
}

function getToolCallId(
  part: Extract<ContentPart, { type: "tool_call" }>,
  messageItemId: string,
): string {
  if (part.id !== undefined && part.id !== "") {
    return part.id;
  }

  return `${messageItemId}:${String(getToolCallOutputIndex(part))}:${part.name}`;
}

function getReasoningId(part: Extract<ContentPart, { type: "reasoning_summary" }>): string {
  return part.streamPosition.itemId;
}

function getReasoningOutputIndex(part: Extract<ContentPart, { type: "reasoning_summary" }>): number {
  return part.streamPosition.outputIndex;
}

function hasLaterAssistantPart(
  content: ReadonlyArray<ContentPart>,
  currentIndex: number,
): boolean {
  for (let index = currentIndex + 1; index < content.length; index += 1) {
    const nextPart = content[index];
    if (
      nextPart?.type === "text"
      || nextPart?.type === "tool_call"
      || nextPart?.type === "reasoning_summary"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Produces SSE events representing new content in `current` that was not present in `previous`.
 * Text parts are diffed by suffix; tool calls are diffed by status/presence; reasoning summaries by presence.
 */
export function diffAssistantContent(
  previous: ReadonlyArray<ContentPart>,
  current: ReadonlyArray<ContentPart>,
  cursor: string,
  itemId: string,
): ReadonlyArray<Extract<ChatLiveEventPayload, Readonly<{ cursor: string }>>> {
  const events: Array<Extract<ChatLiveEventPayload, Readonly<{ cursor: string }>>> = [];

  for (let i = 0; i < current.length; i += 1) {
    const currentPart = current[i]!;

    if (currentPart.type === "text") {
      const previousPart = previous[i];
      const previousText = previousPart !== undefined && previousPart.type === "text"
        ? previousPart.text
        : "";
      if (currentPart.text.length > previousText.length && currentPart.text.startsWith(previousText)) {
        const delta = currentPart.text.slice(previousText.length);
        events.push({ type: "assistant_delta", text: delta, cursor, itemId });
      } else if (currentPart.text !== previousText) {
        events.push({ type: "assistant_delta", text: currentPart.text, cursor, itemId });
      }
      continue;
    }

    if (currentPart.type === "tool_call") {
      const previousPart = previous.find(
        (part) => part.type === "tool_call" && getToolCallId(part, itemId) === getToolCallId(currentPart, itemId),
      );
      const toolCallId = getToolCallId(currentPart, itemId);
      const outputIndex = getToolCallOutputIndex(currentPart);
      if (previousPart === undefined || previousPart.type !== "tool_call") {
        events.push({
          type: "assistant_tool_call",
          toolCallId,
          name: currentPart.name,
          status: "started",
          input: null,
          output: null,
          cursor,
          itemId,
          outputIndex,
        });
        if (currentPart.status === "completed") {
          events.push({
            type: "assistant_tool_call",
            toolCallId,
            name: currentPart.name,
            status: "completed",
            input: currentPart.input,
            output: currentPart.output,
            providerStatus: currentPart.providerStatus ?? null,
            cursor,
            itemId,
            outputIndex,
          });
        }
      } else if (
        previousPart.status !== currentPart.status
        || previousPart.output !== currentPart.output
        || previousPart.providerStatus !== currentPart.providerStatus
      ) {
        events.push({
          type: "assistant_tool_call",
          toolCallId,
          name: currentPart.name,
          status: currentPart.status,
          input: currentPart.status === "completed" ? currentPart.input : null,
          output: currentPart.output,
          providerStatus: currentPart.providerStatus ?? null,
          cursor,
          itemId,
          outputIndex,
        });
      }
      continue;
    }

    if (currentPart.type === "reasoning_summary") {
      const reasoningId = getReasoningId(currentPart);
      const outputIndex = getReasoningOutputIndex(currentPart);
      const previousPart = previous.find((part) =>
        part.type === "reasoning_summary"
        && getReasoningId(part) === reasoningId,
      );
      const previousSummary = previousPart?.type === "reasoning_summary"
        ? previousPart.summary
        : null;
      const currentCompleted = hasLaterAssistantPart(current, i);
      const previousIndex = previous.findIndex((part) =>
        part.type === "reasoning_summary"
        && getReasoningId(part) === reasoningId,
      );
      const previousCompleted = previousIndex >= 0
        ? hasLaterAssistantPart(previous, previousIndex)
        : false;

      if (previousPart === undefined) {
        events.push({
          type: "assistant_reasoning_started",
          reasoningId,
          cursor,
          itemId,
          outputIndex,
        });
      }

      if (currentPart.summary !== "" && previousSummary !== currentPart.summary) {
        events.push({
          type: "assistant_reasoning_summary",
          reasoningId,
          summary: currentPart.summary,
          cursor,
          itemId,
          outputIndex,
        });
      }

      if (currentCompleted && !previousCompleted) {
        events.push({
          type: "assistant_reasoning_done",
          reasoningId,
          cursor,
          itemId,
          outputIndex,
        });
      }
    }
  }

  return events;
}
