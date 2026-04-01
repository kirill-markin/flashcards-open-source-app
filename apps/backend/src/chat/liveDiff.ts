/**
 * Pure-function content diffing for the SSE live handler.
 * Compares two snapshots of an in-progress assistant item's content array
 * and produces the SSE events representing new content since the last emission.
 */
import type { ContentPart, LiveSSEEvent } from "./types";

/**
 * Produces SSE events representing new content in `current` that was not present in `previous`.
 * Text parts are diffed by suffix; tool calls are diffed by status/presence; reasoning summaries by presence.
 */
export function diffAssistantContent(
  previous: ReadonlyArray<ContentPart>,
  current: ReadonlyArray<ContentPart>,
  cursor: string,
  itemId: string,
): ReadonlyArray<LiveSSEEvent> {
  const events: LiveSSEEvent[] = [];

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
        (p) => p.type === "tool_call" && p.id === currentPart.id,
      );
      if (previousPart === undefined || previousPart.type !== "tool_call") {
        events.push({
          type: "assistant_tool_call",
          name: currentPart.name,
          status: currentPart.status,
          input: currentPart.input,
          output: currentPart.output,
          cursor,
          itemId,
        });
      } else if (previousPart.status !== currentPart.status || previousPart.output !== currentPart.output) {
        events.push({
          type: "assistant_tool_call",
          name: currentPart.name,
          status: currentPart.status,
          input: currentPart.input,
          output: currentPart.output,
          cursor,
          itemId,
        });
      }
      continue;
    }

    if (currentPart.type === "reasoning_summary") {
      const previousPart = previous.find((part) => part.type === "reasoning_summary");
      const previousSummary = previousPart?.type === "reasoning_summary"
        ? previousPart.summary
        : null;
      if (previousSummary !== currentPart.summary) {
        events.push({
          type: "assistant_reasoning_summary",
          summary: currentPart.summary,
          cursor,
          itemId,
        });
      }
    }
  }

  return events;
}
