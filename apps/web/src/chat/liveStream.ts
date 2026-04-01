import type { ChatLiveStream } from "../types";

export type ChatLiveEvent =
  | Readonly<{ type: "run_state"; runState: "idle" | "running" | "interrupted"; sessionId: string }>
  | Readonly<{ type: "assistant_delta"; text: string; cursor: string; itemId: string }>
  | Readonly<{ type: "assistant_tool_call"; name: string; status: "started" | "completed"; input: string | null; output: string | null; cursor: string; itemId: string }>
  | Readonly<{ type: "assistant_reasoning_summary"; summary: string; cursor: string; itemId: string }>
  | Readonly<{ type: "assistant_message_done"; cursor: string; itemId: string; isError: boolean; isStopped: boolean }>
  | Readonly<{ type: "error"; message: string }>
  | Readonly<{ type: "reset_required" }>;

type ConsumeChatLiveStreamParams = Readonly<{
  liveStream: ChatLiveStream;
  sessionId: string;
  afterCursor: string | null;
  signal: AbortSignal;
  onEvent: (event: ChatLiveEvent) => void;
}>;

type JsonObject = Readonly<Record<string, unknown>>;

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

function parseChatLiveEvent(
  eventType: string | null,
  payload: string,
): ChatLiveEvent | null {
  const objectValue = parseJsonObject(payload);
  if (objectValue === null) {
    return null;
  }

  const type = eventType ?? readStringField(objectValue, "type");
  if (type === null) {
    return null;
  }

  if (type === "run_state") {
    const runState = readStringField(objectValue, "runState");
    const sessionId = readStringField(objectValue, "sessionId");
    if (
      sessionId === null
      || (runState !== "idle" && runState !== "running" && runState !== "interrupted")
    ) {
      return null;
    }

    return { type, runState, sessionId };
  }

  if (type === "assistant_delta") {
    const text = readStringField(objectValue, "text");
    const cursor = readStringField(objectValue, "cursor");
    const itemId = readStringField(objectValue, "itemId");
    if (text === null || cursor === null || itemId === null) {
      return null;
    }

    return { type, text, cursor, itemId };
  }

  if (type === "assistant_tool_call") {
    const name = readStringField(objectValue, "name");
    const status = readStringField(objectValue, "status");
    const cursor = readStringField(objectValue, "cursor");
    const itemId = readStringField(objectValue, "itemId");
    if (
      name === null
      || cursor === null
      || itemId === null
      || (status !== "started" && status !== "completed")
    ) {
      return null;
    }

    return {
      type,
      name,
      status,
      input: readStringField(objectValue, "input"),
      output: readStringField(objectValue, "output"),
      cursor,
      itemId,
    };
  }

  if (type === "assistant_reasoning_summary") {
    const summary = readStringField(objectValue, "summary");
    const cursor = readStringField(objectValue, "cursor");
    const itemId = readStringField(objectValue, "itemId");
    if (summary === null || cursor === null || itemId === null) {
      return null;
    }

    return { type, summary, cursor, itemId };
  }

  if (type === "assistant_message_done") {
    const cursor = readStringField(objectValue, "cursor");
    const itemId = readStringField(objectValue, "itemId");
    const isError = readBooleanField(objectValue, "isError");
    const isStopped = readBooleanField(objectValue, "isStopped");
    if (cursor === null || itemId === null || isError === null || isStopped === null) {
      return null;
    }

    return { type, cursor, itemId, isError, isStopped };
  }

  if (type === "error") {
    const message = readStringField(objectValue, "message");
    return message === null ? null : { type, message };
  }

  if (type === "reset_required") {
    return { type };
  }

  return null;
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

  const event = parseChatLiveEvent(eventType, dataLines.join("\n"));
  if (event !== null) {
    onEvent(event);
  }
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
