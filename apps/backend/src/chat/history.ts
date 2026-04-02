/**
 * Content-ordering helpers for backend-owned assistant messages.
 * These functions keep streamed text, tool calls, and reasoning summaries stable inside persisted chat items.
 */
import type {
  ContentPart,
  ReasoningSummaryContentPart,
  StreamPosition,
  TextContentPart,
  ToolCallContentPart,
} from "./types";

export type StoredMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
  isStopped: boolean;
  cursor: string | null;
  itemId: string | null;
}>;

type OrderedAssistantPart = TextContentPart | ToolCallContentPart | ReasoningSummaryContentPart;
export type OrderedAssistantContentPart = OrderedAssistantPart & Readonly<{ streamPosition: StreamPosition }>;

type AppendAssistantTextParams = Readonly<{
  text: string;
  streamPosition: StreamPosition;
}>;

const isOrderedAssistantPart = (
  part: ContentPart,
): part is OrderedAssistantContentPart =>
  (part.type === "text" || part.type === "tool_call" || part.type === "reasoning_summary")
  && part.streamPosition !== undefined;
export { isOrderedAssistantPart };

const isLegacyAssistantPart = (
  part: ContentPart,
): boolean =>
  (part.type === "text" || part.type === "tool_call")
  && part.streamPosition === undefined;

const formatStreamPosition = (
  streamPosition: StreamPosition,
): string =>
  `itemId=${streamPosition.itemId} responseIndex=${String(streamPosition.responseIndex ?? 0)} outputIndex=${String(streamPosition.outputIndex)} contentIndex=${String(streamPosition.contentIndex)} sequenceNumber=${String(streamPosition.sequenceNumber)}`;

const normalizeResponseIndex = (
  responseIndex: number | undefined,
): number =>
  responseIndex ?? 0;

/**
 * Rejects assistant content that still uses the pre-stream-position format.
 */
const assertSupportedAssistantContent = (
  content: ReadonlyArray<ContentPart>,
): void => {
  if (content.some(isLegacyAssistantPart)) {
    throw new Error(
      "Assistant content uses an unsupported legacy format without streamPosition metadata",
    );
  }
};

const normalizeContentIndex = (
  contentIndex: number | null,
): number =>
  contentIndex === null ? Number.MAX_SAFE_INTEGER : contentIndex;

const normalizeSequenceNumber = (
  sequenceNumber: number | null,
): number =>
  sequenceNumber === null ? Number.MAX_SAFE_INTEGER : sequenceNumber;

/**
 * Orders streamed assistant parts so persisted content can be rebuilt deterministically across reconnects.
 */
export const compareStreamPosition = (
  left: StreamPosition,
  right: StreamPosition,
): number => {
  const leftResponseIndex = normalizeResponseIndex(left.responseIndex);
  const rightResponseIndex = normalizeResponseIndex(right.responseIndex);
  if (leftResponseIndex !== rightResponseIndex) {
    return leftResponseIndex - rightResponseIndex;
  }

  if (left.outputIndex === right.outputIndex) {
    const leftContentIndex = normalizeContentIndex(left.contentIndex);
    const rightContentIndex = normalizeContentIndex(right.contentIndex);
    if (leftContentIndex !== rightContentIndex) {
      return leftContentIndex - rightContentIndex;
    }
  }

  const leftSequenceNumber = normalizeSequenceNumber(left.sequenceNumber);
  const rightSequenceNumber = normalizeSequenceNumber(right.sequenceNumber);
  if (leftSequenceNumber !== rightSequenceNumber) {
    return leftSequenceNumber - rightSequenceNumber;
  }

  if (left.outputIndex !== right.outputIndex) {
    return left.outputIndex - right.outputIndex;
  }

  const leftContentIndex = normalizeContentIndex(left.contentIndex);
  const rightContentIndex = normalizeContentIndex(right.contentIndex);
  if (leftContentIndex !== rightContentIndex) {
    return leftContentIndex - rightContentIndex;
  }

  return left.itemId.localeCompare(right.itemId);
};

const mergeChronologyPosition = (
  existing: StreamPosition,
  incoming: StreamPosition,
): StreamPosition => ({
  ...incoming,
  sequenceNumber: existing.sequenceNumber === null
    ? incoming.sequenceNumber
    : incoming.sequenceNumber === null
      ? existing.sequenceNumber
      : Math.min(existing.sequenceNumber, incoming.sequenceNumber),
});

const insertOrderedAssistantPart = (
  content: ReadonlyArray<ContentPart>,
  nextPart: OrderedAssistantContentPart,
): ReadonlyArray<ContentPart> => {
  let insertIndex = content.length;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    if (current === undefined || !isOrderedAssistantPart(current)) {
      continue;
    }

    if (compareStreamPosition(nextPart.streamPosition, current.streamPosition) < 0) {
      insertIndex = index;
      break;
    }
  }

  return [...content.slice(0, insertIndex), nextPart, ...content.slice(insertIndex)];
};

const findTextPartIndex = (
  content: ReadonlyArray<ContentPart>,
  streamPosition: StreamPosition,
): number =>
  content.findIndex((part) =>
    part.type === "text"
    && part.streamPosition !== undefined
    && part.streamPosition.itemId === streamPosition.itemId
    && part.streamPosition.contentIndex === streamPosition.contentIndex,
  );

const isSameToolCall = (
  existing: ToolCallContentPart,
  incoming: ToolCallContentPart & Readonly<{ streamPosition: StreamPosition }>,
): boolean => {
  if (existing.id !== undefined && incoming.id !== undefined) {
    return existing.id === incoming.id;
  }

  return existing.streamPosition !== undefined
    && existing.streamPosition.itemId === incoming.streamPosition.itemId;
};

const isSameReasoningSummary = (
  existing: ReasoningSummaryContentPart,
  incoming: ReasoningSummaryContentPart,
): boolean =>
  existing.streamPosition.itemId === incoming.streamPosition.itemId;

/**
 * Appends streamed assistant text while preserving deterministic part ordering.
 */
export const appendAssistantTextContent = (
  content: ReadonlyArray<ContentPart>,
  params: AppendAssistantTextParams,
): ReadonlyArray<ContentPart> => {
  assertSupportedAssistantContent(content);

  const existingIndex = findTextPartIndex(content, params.streamPosition);
  if (existingIndex >= 0) {
    const existing = content[existingIndex];
    if (existing === undefined || existing.type !== "text" || existing.streamPosition === undefined) {
      throw new Error(`Assistant text update matched an invalid content part at index ${String(existingIndex)}`);
    }

    const updatedPart: TextContentPart = {
      ...existing,
      text: existing.text + params.text,
      streamPosition: mergeChronologyPosition(existing.streamPosition, params.streamPosition),
    };

    return [...content.slice(0, existingIndex), updatedPart, ...content.slice(existingIndex + 1)];
  }

  return insertOrderedAssistantPart(content, {
    type: "text",
    text: params.text,
    streamPosition: params.streamPosition,
  });
};

/**
 * Upserts one tool-call snapshot into persisted assistant content.
 */
export const upsertToolCallContent = (
  content: ReadonlyArray<ContentPart>,
  toolCall: ToolCallContentPart,
): ReadonlyArray<ContentPart> => {
  assertSupportedAssistantContent(content);

  if (toolCall.streamPosition === undefined) {
    throw new Error(
      `Tool call update is missing required streamPosition metadata: id=${toolCall.id ?? "unknown"} name=${toolCall.name}`,
    );
  }
  const streamPosition = toolCall.streamPosition;

  const existingIndex = content.findIndex((part) =>
    part.type === "tool_call"
    && isSameToolCall(part, {
      ...toolCall,
      streamPosition,
    }),
  );

  if (existingIndex >= 0) {
    const existing = content[existingIndex];
    if (existing === undefined || existing.type !== "tool_call") {
      throw new Error(`Tool call update matched an invalid content part at index ${String(existingIndex)}`);
    }
    if (existing.streamPosition === undefined) {
      throw new Error(
        `Tool call update encountered a legacy assistant part without streamPosition: id=${existing.id ?? "unknown"}`,
      );
    }
    if (existing.streamPosition.itemId !== streamPosition.itemId) {
      throw new Error(
        `Tool call update changed itemId for id=${toolCall.id ?? "unknown"} from ${formatStreamPosition(existing.streamPosition)} to ${formatStreamPosition(streamPosition)}`,
      );
    }
    if (existing.streamPosition.outputIndex !== streamPosition.outputIndex) {
      throw new Error(
        `Tool call update changed outputIndex for id=${toolCall.id ?? "unknown"} from ${formatStreamPosition(existing.streamPosition)} to ${formatStreamPosition(streamPosition)}`,
      );
    }

    const updatedPart: ToolCallContentPart = {
      ...existing,
      name: toolCall.name,
      status: toolCall.status,
      providerStatus: toolCall.providerStatus,
      input: toolCall.input,
      output: toolCall.output,
      streamPosition: mergeChronologyPosition(existing.streamPosition, streamPosition),
    };

    return [...content.slice(0, existingIndex), updatedPart, ...content.slice(existingIndex + 1)];
  }

  return insertOrderedAssistantPart(content, {
    ...toolCall,
    streamPosition,
  });
};

/**
 * Upserts one reasoning summary snapshot into persisted assistant content.
 */
export const upsertReasoningSummaryContent = (
  content: ReadonlyArray<ContentPart>,
  reasoningSummary: ReasoningSummaryContentPart,
): ReadonlyArray<ContentPart> => {
  assertSupportedAssistantContent(content);

  const existingIndex = content.findIndex((part) =>
    part.type === "reasoning_summary" && isSameReasoningSummary(part, reasoningSummary),
  );

  if (existingIndex >= 0) {
    const existing = content[existingIndex];
    if (existing === undefined || existing.type !== "reasoning_summary") {
      throw new Error(`Reasoning summary update matched an invalid content part at index ${String(existingIndex)}`);
    }
    if (existing.streamPosition.outputIndex !== reasoningSummary.streamPosition.outputIndex) {
      throw new Error(
        `Reasoning summary update changed outputIndex from ${formatStreamPosition(existing.streamPosition)} to ${formatStreamPosition(reasoningSummary.streamPosition)}`,
      );
    }

    const updatedPart: ReasoningSummaryContentPart = {
      ...existing,
      summary: reasoningSummary.summary,
      streamPosition: mergeChronologyPosition(existing.streamPosition, reasoningSummary.streamPosition),
    };

    return [...content.slice(0, existingIndex), updatedPart, ...content.slice(existingIndex + 1)];
  }

  return insertOrderedAssistantPart(content, reasoningSummary);
};

/**
 * Marks any still-open tool calls as completed when a run stops before provider output arrives.
 */
export const finalizePendingToolCallContent = (
  content: ReadonlyArray<ContentPart>,
  providerStatus: string,
  output: string,
): ReadonlyArray<ContentPart> =>
  content.map((part) => {
    if (part.type !== "tool_call" || part.status !== "started") {
      return part;
    }

    return {
      ...part,
      status: "completed",
      providerStatus,
      output: part.output ?? output,
    };
  });

/**
 * Applies a terminal assistant error to the stored message list without losing earlier successful content.
 */
export const applyAssistantError = (
  messages: ReadonlyArray<StoredMessage>,
  errorText: string,
  timestamp: number,
): ReadonlyArray<StoredMessage> => {
  if (messages.length === 0) {
    return messages;
  }

  const errorMessage: StoredMessage = {
    role: "assistant",
    content: [{ type: "text", text: errorText }],
    timestamp,
    isError: true,
    isStopped: false,
    cursor: null,
    itemId: null,
  };

  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== "assistant") {
    return [...messages, errorMessage];
  }

  if (last.content.length === 0) {
    const updated: StoredMessage = {
      ...last,
      content: errorMessage.content,
      isError: true,
      isStopped: false,
    };
    return [...messages.slice(0, -1), updated];
  }

  return [...messages, errorMessage];
};
