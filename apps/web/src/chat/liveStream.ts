import type { ChatLiveStream } from "../types";

export type ChatLiveEvent =
  | Readonly<{ type: "run_state"; runState: "idle" | "running" | "interrupted"; sessionId: string }>
  | Readonly<{ type: "assistant_delta"; text: string; cursor: string; itemId: string }>
  | Readonly<{
    type: "assistant_tool_call";
    toolCallId: string;
    name: string;
    status: "started" | "completed";
    input: string | null;
    output: string | null;
    providerStatus?: string | null;
    cursor: string;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{ type: "assistant_reasoning_started"; reasoningId: string; cursor: string; itemId: string; outputIndex: number }>
  | Readonly<{ type: "assistant_reasoning_summary"; reasoningId: string; summary: string; cursor: string; itemId: string; outputIndex: number }>
  | Readonly<{ type: "assistant_reasoning_done"; reasoningId: string; cursor: string; itemId: string; outputIndex: number }>
  | Readonly<{ type: "assistant_message_done"; cursor: string; itemId: string; isError: boolean; isStopped: boolean }>
  | Readonly<{ type: "repair_status"; message: string; attempt: number; maxAttempts: number; toolName: string | null }>
  | Readonly<{ type: "error"; message: string }>
  | Readonly<{ type: "stop_ack"; sessionId: string }>
  | Readonly<{ type: "reset_required" }>;

type ConsumeChatLiveStreamParams = Readonly<{
  liveStream: ChatLiveStream;
  sessionId: string;
  afterCursor: string | null;
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

  if (type === "run_state") {
    const runState = requireStringField(objectValue, "runState", type, payload);
    const sessionId = requireStringField(objectValue, "sessionId", type, payload);
    if (runState !== "idle" && runState !== "running" && runState !== "interrupted") {
      throw new ChatLiveContractError(
        `AI live stream event is invalid: unsupported runState "${runState}".`,
        type,
        payload,
      );
    }

    return { type, runState, sessionId };
  }

  if (type === "assistant_delta") {
    return {
      type,
      text: requireStringField(objectValue, "text", type, payload),
      cursor: requireStringField(objectValue, "cursor", type, payload),
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
      type,
      toolCallId: requireStringField(objectValue, "toolCallId", type, payload),
      name: requireStringField(objectValue, "name", type, payload),
      status,
      input: readStringField(objectValue, "input"),
      output: readStringField(objectValue, "output"),
      providerStatus: readStringField(objectValue, "providerStatus"),
      cursor: requireStringField(objectValue, "cursor", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_reasoning_started") {
    return {
      type,
      reasoningId: requireStringField(objectValue, "reasoningId", type, payload),
      cursor: requireStringField(objectValue, "cursor", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_reasoning_summary") {
    return {
      type,
      reasoningId: requireStringField(objectValue, "reasoningId", type, payload),
      summary: requireStringField(objectValue, "summary", type, payload),
      cursor: requireStringField(objectValue, "cursor", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_reasoning_done") {
    return {
      type,
      reasoningId: requireStringField(objectValue, "reasoningId", type, payload),
      cursor: requireStringField(objectValue, "cursor", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      outputIndex: requireNumberField(objectValue, "outputIndex", type, payload),
    };
  }

  if (type === "assistant_message_done") {
    return {
      type,
      cursor: requireStringField(objectValue, "cursor", type, payload),
      itemId: requireStringField(objectValue, "itemId", type, payload),
      isError: requireBooleanField(objectValue, "isError", type, payload),
      isStopped: requireBooleanField(objectValue, "isStopped", type, payload),
    };
  }

  if (type === "repair_status") {
    return {
      type,
      message: requireStringField(objectValue, "message", type, payload),
      attempt: requireNumberField(objectValue, "attempt", type, payload),
      maxAttempts: requireNumberField(objectValue, "maxAttempts", type, payload),
      toolName: readStringField(objectValue, "toolName"),
    };
  }

  if (type === "error") {
    return { type, message: requireStringField(objectValue, "message", type, payload) };
  }

  if (type === "stop_ack") {
    return {
      type,
      sessionId: requireStringField(objectValue, "sessionId", type, payload),
    };
  }

  if (type === "reset_required") {
    return { type };
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
  afterCursor: string | null,
): string {
  const url = new URL(liveStream.url);
  url.searchParams.set("sessionId", sessionId);
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

export async function consumeChatLiveStream(
  params: ConsumeChatLiveStreamParams,
): Promise<void> {
  const response = await fetch(buildLiveStreamUrl(
    params.liveStream,
    params.sessionId,
    params.afterCursor,
  ), {
    method: "GET",
    credentials: "omit",
    headers: {
      Accept: "text/event-stream",
      Authorization: params.liveStream.authorization,
    },
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
