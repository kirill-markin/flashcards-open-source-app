import { parseContentPartArray } from "../apiContracts";
import { webAppVersion } from "../clientIdentity";
import type { ChatLiveStream, ContentPart } from "../types";

type ChatRunTerminalOutcome = "completed" | "stopped" | "error" | "reset_required";

type ChatLiveEventMetadata<CursorValue extends string | null> = Readonly<{
  sessionId: string;
  conversationScopeId: string;
  runId: string;
  cursor: CursorValue;
  sequenceNumber: number;
  streamEpoch: string;
}>;

export type ChatLiveEvent =
  | (ChatLiveEventMetadata<string> & Readonly<{ type: "assistant_delta"; text: string; itemId: string }>)
  | (ChatLiveEventMetadata<string> & Readonly<{
    type: "assistant_tool_call";
    toolCallId: string;
    name: string;
    status: "started" | "completed";
    input: string | null;
    output: string | null;
    providerStatus?: string | null;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata<string> & Readonly<{
    type: "assistant_reasoning_started";
    reasoningId: string;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata<string> & Readonly<{
    type: "assistant_reasoning_summary";
    reasoningId: string;
    summary: string;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata<string> & Readonly<{
    type: "assistant_reasoning_done";
    reasoningId: string;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata<string> & Readonly<{
    type: "assistant_message_done";
    itemId: string;
    content: ReadonlyArray<ContentPart>;
    isError: boolean;
    isStopped: boolean;
  }>)
  | (ChatLiveEventMetadata<string | null> & Readonly<{
    type: "repair_status";
    message: string;
    attempt: number;
    maxAttempts: number;
    toolName: string | null;
  }>)
  | (ChatLiveEventMetadata<string | null> & Readonly<{
    type: "run_terminal";
    outcome: ChatRunTerminalOutcome;
    message?: string;
    assistantItemId?: string;
    isError?: boolean;
    isStopped?: boolean;
  }>);

type ConsumeChatLiveStreamParams = Readonly<{
  liveStream: ChatLiveStream;
  sessionId: string;
  runId: string;
  afterCursor: string | null;
  resumeAttemptId: number | null;
  signal: AbortSignal;
  onEvent: (event: ChatLiveEvent) => void;
}>;

type JsonObject = Readonly<Record<string, unknown>>;

export class ChatLiveContractError extends Error {
  readonly eventType: string | null;
  readonly payloadSnippet: string;

  constructor(message: string, eventType: string | null, payload: string) {
    super(message);
    this.name = "ChatLiveContractError";
    this.eventType = eventType;
    this.payloadSnippet = payload.trim().slice(0, 240);
  }
}

function parseJsonObject(value: string): JsonObject | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed as JsonObject;
  } catch {
    return null;
  }
}

function readStringField(objectValue: JsonObject, key: string): string | null {
  const value = objectValue[key];
  return typeof value === "string" ? value : null;
}

function readNullableStringField(objectValue: JsonObject, key: string): string | null | undefined {
  const value = objectValue[key];
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}

function readBooleanField(objectValue: JsonObject, key: string): boolean | null {
  const value = objectValue[key];
  return typeof value === "boolean" ? value : null;
}

function requireStringField(
  objectValue: JsonObject,
  key: string,
  eventType: string | null,
  payload: string,
): string {
  const value = readStringField(objectValue, key);
  if (value === null) {
    throw new ChatLiveContractError(
      `AI live stream event is invalid: ${key} must be a string.`,
      eventType,
      payload,
    );
  }

  return value;
}

function requireNullableStringField(
  objectValue: JsonObject,
  key: string,
  eventType: string | null,
  payload: string,
): string | null {
  const value = readNullableStringField(objectValue, key);
  if (value === undefined) {
    throw new ChatLiveContractError(
      `AI live stream event is invalid: ${key} must be a string or null.`,
      eventType,
      payload,
    );
  }

  return value;
}

function requireBooleanField(
  objectValue: JsonObject,
  key: string,
  eventType: string | null,
  payload: string,
): boolean {
  const value = readBooleanField(objectValue, key);
  if (value === null) {
    throw new ChatLiveContractError(
      `AI live stream event is invalid: ${key} must be a boolean.`,
      eventType,
      payload,
    );
  }

  return value;
}

function requireNumberField(
  objectValue: JsonObject,
  key: string,
  eventType: string | null,
  payload: string,
): number {
  const value = objectValue[key];
  if (typeof value !== "number") {
    throw new ChatLiveContractError(
      `AI live stream event is invalid: ${key} must be a number.`,
      eventType,
      payload,
    );
  }

  return value;
}

function requireType(
  value: string | null,
  eventType: string | null,
  payload: string,
): string {
  if (value === null) {
    throw new ChatLiveContractError(
      "AI live stream event is invalid: type must be a string.",
      eventType,
      payload,
    );
  }

  return value;
}

function parseEventMetadata(
  objectValue: JsonObject,
  eventType: string | null,
  payload: string,
): ChatLiveEventMetadata<string | null> {
  return {
    sessionId: requireStringField(objectValue, "sessionId", eventType, payload),
    conversationScopeId: requireStringField(objectValue, "conversationScopeId", eventType, payload),
    runId: requireStringField(objectValue, "runId", eventType, payload),
    cursor: requireNullableStringField(objectValue, "cursor", eventType, payload),
    sequenceNumber: requireNumberField(objectValue, "sequenceNumber", eventType, payload),
    streamEpoch: requireStringField(objectValue, "streamEpoch", eventType, payload),
  };
}

function requireCursor(metadata: ChatLiveEventMetadata<string | null>, eventType: string | null, payload: string): ChatLiveEventMetadata<string> {
  if (metadata.cursor === null) {
    throw new ChatLiveContractError(
      "AI live stream event is invalid: cursor must be a string.",
      eventType,
      payload,
    );
  }

  return metadata as ChatLiveEventMetadata<string>;
}

/**
 * Validates one SSE payload against the browser live-stream contract and
 * returns the typed event expected by the chat lifecycle layer.
 */
export function parseChatLiveEvent(
  eventType: string | null,
  payload: string,
): ChatLiveEvent {
  const objectValue = parseJsonObject(payload);
  if (objectValue === null) {
    throw new ChatLiveContractError(
      "AI live stream event is invalid: payload must be a JSON object.",
      eventType,
      payload,
    );
  }

  const type = requireType(eventType ?? readStringField(objectValue, "type"), eventType, payload);
  const metadata = parseEventMetadata(objectValue, type, payload);

  if (type === "assistant_delta") {
    return {
      ...requireCursor(metadata, type, payload),
      type,
      text: requireStringField(objectValue, "text", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
    };
  }

  if (type === "assistant_tool_call") {
    const status = requireStringField(objectValue, "status", type, payload);
    if (status !== "started" && status !== "completed") {
      throw new ChatLiveContractError(
        `AI live stream event is invalid: unsupported tool status "${status}".`,
        type,
        payload,
      );
    }

    return {
      ...requireCursor(metadata, type, payload),
      type,
      toolCallId: requireStringField(objectValue, "toolCallId", type, payload),
      name: requireStringField(objectValue, "name", type, payload),
      status,
      input: readNullableStringField(objectValue, "input") ?? null,
      output: readNullableStringField(objectValue, "output") ?? null,
      providerStatus: readNullableStringField(objectValue, "providerStatus") ?? null,
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_reasoning_started") {
    return {
      ...requireCursor(metadata, type, payload),
      type,
      reasoningId: requireStringField(objectValue, "reasoningId", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_reasoning_summary") {
    return {
      ...requireCursor(metadata, type, payload),
      type,
      reasoningId: requireStringField(objectValue, "reasoningId", type, payload),
      summary: requireStringField(objectValue, "summary", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_reasoning_done") {
    return {
      ...requireCursor(metadata, type, payload),
      type,
      reasoningId: requireStringField(objectValue, "reasoningId", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_message_done") {
    return {
      ...requireCursor(metadata, type, payload),
      type,
      itemId: requireStringField(objectValue, "itemId", type, payload),
      content: parseContentPartArray(objectValue.content, type, "content"),
      isError: requireBooleanField(objectValue, "isError", type, payload),
      isStopped: requireBooleanField(objectValue, "isStopped", type, payload),
    };
  }

  if (type === "repair_status") {
    return {
      ...metadata,
      type,
      message: requireStringField(objectValue, "message", type, payload),
      attempt: requireNumberField(objectValue, "attempt", type, payload),
      maxAttempts: requireNumberField(objectValue, "maxAttempts", type, payload),
      toolName: readNullableStringField(objectValue, "toolName") ?? null,
    };
  }

  if (type === "run_terminal") {
    const outcome = requireStringField(objectValue, "outcome", type, payload);
    if (
      outcome !== "completed"
      && outcome !== "stopped"
      && outcome !== "error"
      && outcome !== "reset_required"
    ) {
      throw new ChatLiveContractError(
        `AI live stream event is invalid: unsupported terminal outcome "${outcome}".`,
        type,
        payload,
      );
    }

    return {
      ...metadata,
      type,
      outcome,
      ...(readStringField(objectValue, "message") === null ? {} : { message: readStringField(objectValue, "message") as string }),
      ...(readStringField(objectValue, "assistantItemId") === null ? {} : { assistantItemId: readStringField(objectValue, "assistantItemId") as string }),
      ...(readBooleanField(objectValue, "isError") === null ? {} : { isError: readBooleanField(objectValue, "isError") as boolean }),
      ...(readBooleanField(objectValue, "isStopped") === null ? {} : { isStopped: readBooleanField(objectValue, "isStopped") as boolean }),
    };
  }

  throw new ChatLiveContractError(
    `AI live stream event is invalid: unsupported event type "${type}".`,
    type,
    payload,
  );
}

function buildLiveStreamUrl(
  liveStream: ChatLiveStream,
  sessionId: string,
  runId: string,
  afterCursor: string | null,
): string {
  const url = new URL(liveStream.url);
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("runId", runId);
  if (afterCursor !== null && afterCursor !== "") {
    url.searchParams.set("afterCursor", afterCursor);
  } else {
    url.searchParams.delete("afterCursor");
  }

  return url.toString();
}

function buildLiveStreamHttpErrorMessage(statusCode: number, responseText: string): string {
  const payload = parseJsonObject(responseText);
  const backendMessage = payload === null
    ? responseText.trim()
    : readStringField(payload, "error");
  const requestId = payload === null
    ? null
    : readStringField(payload, "requestId");
  const baseMessage = backendMessage !== null && backendMessage !== ""
    ? backendMessage
    : `Request failed with status ${String(statusCode)}`;

  return requestId === null || requestId === ""
    ? `AI live stream failed with status ${String(statusCode)}: ${baseMessage}`
    : `AI live stream failed with status ${String(statusCode)}: ${baseMessage} (requestId: ${requestId})`;
}

function consumeSSEBlock(
  eventType: string | null,
  dataLines: ReadonlyArray<string>,
  onEvent: (event: ChatLiveEvent) => void,
): void {
  if (dataLines.length === 0) {
    return;
  }

  onEvent(parseChatLiveEvent(eventType, dataLines.join("\n")));
}

/**
 * Opens the backend SSE endpoint for one live chat run, validates the wire
 * contract, and forwards typed events to the caller.
 */
export async function consumeChatLiveStream(
  params: ConsumeChatLiveStreamParams,
): Promise<void> {
  const headers = new Headers({
    Accept: "text/event-stream",
    Authorization: params.liveStream.authorization,
  });
  if (params.resumeAttemptId !== null) {
    headers.set("X-Chat-Resume-Attempt-Id", String(params.resumeAttemptId));
    headers.set("X-Client-Platform", "web");
    headers.set("X-Client-Version", webAppVersion);
  }

  const response = await fetch(buildLiveStreamUrl(
    params.liveStream,
    params.sessionId,
    params.runId,
    params.afterCursor,
  ), {
    method: "GET",
    credentials: "omit",
    headers,
    signal: params.signal,
  });

  if (response.ok === false) {
    throw new Error(buildLiveStreamHttpErrorMessage(
      response.status,
      await response.text(),
    ));
  }

  if (response.body === null) {
    throw new Error("AI live stream response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType: string | null = null;
  let currentDataLines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEventType = line.slice(7);
        continue;
      }

      if (line.startsWith("data: ")) {
        currentDataLines.push(line.slice(6));
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      if (line === "") {
        consumeSSEBlock(currentEventType, currentDataLines, params.onEvent);
        currentEventType = null;
        currentDataLines = [];
      }
    }
  }

  buffer += decoder.decode();
  if (buffer !== "") {
    const trailingLines = buffer.split(/\r?\n/);
    for (const line of trailingLines) {
      if (line.startsWith("event: ")) {
        currentEventType = line.slice(7);
        continue;
      }

      if (line.startsWith("data: ")) {
        currentDataLines.push(line.slice(6));
      }
    }
  }

  consumeSSEBlock(currentEventType, currentDataLines, params.onEvent);
}
