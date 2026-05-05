import type {
  ChatComposerSuggestion,
  ChatConfig,
  ChatLiveStream,
  ChatSessionHistoryMessage,
  ChatSessionSnapshot,
  ChatTranscriptionResponse,
  ContentPart,
  NewChatSessionResponse,
  StartChatRunResponse,
  StopChatRunResponse,
} from "../types";
import {
  ApiContractError,
  joinPath,
  parseArray,
  parseBoolean,
  parseEnum,
  parseLiteral,
  parseNullableNumber,
  parseNullableString,
  parseNumber,
  parseObject,
  parseOptionalField,
  parseRequiredField,
  parseString,
  parseStringArray,
} from "./core";
import { parseEffortLevel } from "./studyData";

function parseChatConfig(value: unknown, endpoint: string, path: string): ChatConfig {
  const objectValue = parseObject(value, endpoint, path);
  const providerValue = parseRequiredField(objectValue, "provider", endpoint, path, parseObject);
  const modelValue = parseRequiredField(objectValue, "model", endpoint, path, parseObject);
  const reasoningValue = parseRequiredField(objectValue, "reasoning", endpoint, path, parseObject);
  const featuresValue = parseRequiredField(objectValue, "features", endpoint, path, parseObject);

  return {
    provider: {
      id: parseLiteral(
        parseRequiredField(providerValue, "id", endpoint, joinPath(path, "provider"), parseString),
        endpoint,
        joinPath(joinPath(path, "provider"), "id"),
        "openai",
      ),
      label: parseRequiredField(providerValue, "label", endpoint, joinPath(path, "provider"), parseString),
    },
    model: {
      id: parseRequiredField(modelValue, "id", endpoint, joinPath(path, "model"), parseString),
      label: parseRequiredField(modelValue, "label", endpoint, joinPath(path, "model"), parseString),
      badgeLabel: parseRequiredField(modelValue, "badgeLabel", endpoint, joinPath(path, "model"), parseString),
    },
    reasoning: {
      effort: parseRequiredField(reasoningValue, "effort", endpoint, joinPath(path, "reasoning"), parseReasoningEffort),
      label: parseRequiredField(reasoningValue, "label", endpoint, joinPath(path, "reasoning"), parseString),
    },
    features: {
      modelPickerEnabled: parseRequiredField(featuresValue, "modelPickerEnabled", endpoint, joinPath(path, "features"), parseBoolean),
      dictationEnabled: parseRequiredField(featuresValue, "dictationEnabled", endpoint, joinPath(path, "features"), parseBoolean),
      attachmentsEnabled: parseRequiredField(featuresValue, "attachmentsEnabled", endpoint, joinPath(path, "features"), parseBoolean),
    },
  };
}

function parseChatLiveStream(value: unknown, endpoint: string, path: string): ChatLiveStream {
  const objectValue = parseObject(value, endpoint, path);
  return {
    url: parseRequiredField(objectValue, "url", endpoint, path, parseString),
    authorization: parseRequiredField(objectValue, "authorization", endpoint, path, parseString),
    expiresAt: parseRequiredField(objectValue, "expiresAt", endpoint, path, parseNumber),
  };
}

function parseNullableChatLiveStream(
  value: unknown,
  endpoint: string,
  path: string,
): ChatLiveStream | null {
  if (value === null) {
    return null;
  }

  return parseChatLiveStream(value, endpoint, path);
}

function parseChatConversation(value: unknown, endpoint: string, path: string): ChatSessionSnapshot["conversation"] {
  const objectValue = parseObject(value, endpoint, path);

  return {
    messages: parseRequiredField(objectValue, "messages", endpoint, path, parseChatSessionHistoryMessageArray),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseNumber),
    mainContentInvalidationVersion: parseRequiredField(
      objectValue,
      "mainContentInvalidationVersion",
      endpoint,
      path,
      parseNumber,
    ),
    hasOlder: parseOptionalField(objectValue, "hasOlder", endpoint, path, parseBoolean),
    oldestCursor: parseOptionalField(objectValue, "oldestCursor", endpoint, path, parseNullableString),
  };
}

function parseChatComposerSuggestion(
  value: unknown,
  endpoint: string,
  path: string,
): ChatComposerSuggestion {
  const objectValue = parseObject(value, endpoint, path);
  const source = parseRequiredField(objectValue, "source", endpoint, path, parseString);
  if (source !== "initial" && source !== "assistant_follow_up") {
    throw new ApiContractError(endpoint, joinPath(path, "source"), "a known composer suggestion source");
  }

  return {
    id: parseRequiredField(objectValue, "id", endpoint, path, parseString),
    text: parseRequiredField(objectValue, "text", endpoint, path, parseString),
    source,
    assistantItemId: parseRequiredField(objectValue, "assistantItemId", endpoint, path, parseNullableString),
  };
}

export function parseChatComposerSuggestionArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<ChatComposerSuggestion> {
  return parseArray(value, endpoint, path, parseChatComposerSuggestion);
}

function parseChatActiveRun(value: unknown, endpoint: string, path: string): NonNullable<ChatSessionSnapshot["activeRun"]> {
  const objectValue = parseObject(value, endpoint, path);
  const liveValue = parseRequiredField(objectValue, "live", endpoint, path, parseObject);

  return {
    runId: parseRequiredField(objectValue, "runId", endpoint, path, parseString),
    status: parseLiteral(
      parseRequiredField(objectValue, "status", endpoint, path, parseString),
      endpoint,
      joinPath(path, "status"),
      "running",
    ),
    live: {
      cursor: parseRequiredField(liveValue, "cursor", endpoint, joinPath(path, "live"), parseNullableString),
      stream: parseRequiredField(liveValue, "stream", endpoint, joinPath(path, "live"), parseChatLiveStream),
    },
    lastHeartbeatAt: parseOptionalField(objectValue, "lastHeartbeatAt", endpoint, path, parseNumber),
  };
}

function parseNullableChatActiveRun(
  value: unknown,
  endpoint: string,
  path: string,
): ChatSessionSnapshot["activeRun"] {
  if (value === null) {
    return null;
  }

  return parseChatActiveRun(value, endpoint, path);
}

function parseChatStreamPosition(value: unknown, endpoint: string, path: string): Readonly<{
  itemId: string;
  responseIndex?: number;
  outputIndex: number;
  contentIndex: number | null;
  sequenceNumber: number | null;
}> {
  const objectValue = parseObject(value, endpoint, path);
  const responseIndex = parseOptionalField(objectValue, "responseIndex", endpoint, path, parseNumber);

  return {
    itemId: parseRequiredField(objectValue, "itemId", endpoint, path, parseString),
    responseIndex,
    outputIndex: parseRequiredField(objectValue, "outputIndex", endpoint, path, parseNumber),
    contentIndex: parseRequiredField(objectValue, "contentIndex", endpoint, path, parseNullableNumber),
    sequenceNumber: parseRequiredField(objectValue, "sequenceNumber", endpoint, path, parseNullableNumber),
  };
}

function parseContentPart(value: unknown, endpoint: string, path: string): ContentPart {
  const objectValue = parseObject(value, endpoint, path);
  const type = parseRequiredField(objectValue, "type", endpoint, path, parseContentPartType);

  if (type === "text") {
    return {
      type,
      text: parseRequiredField(objectValue, "text", endpoint, path, parseString),
    };
  }

  if (type === "image") {
    return {
      type,
      mediaType: parseRequiredField(objectValue, "mediaType", endpoint, path, parseString),
      base64Data: parseRequiredField(objectValue, "base64Data", endpoint, path, parseString),
    };
  }

  if (type === "file") {
    return {
      type,
      mediaType: parseRequiredField(objectValue, "mediaType", endpoint, path, parseString),
      base64Data: parseRequiredField(objectValue, "base64Data", endpoint, path, parseString),
      fileName: parseRequiredField(objectValue, "fileName", endpoint, path, parseString),
    };
  }

  if (type === "card") {
    return {
      type,
      cardId: parseRequiredField(objectValue, "cardId", endpoint, path, parseString),
      frontText: parseRequiredField(objectValue, "frontText", endpoint, path, parseString),
      backText: parseRequiredField(objectValue, "backText", endpoint, path, parseString),
      tags: parseRequiredField(objectValue, "tags", endpoint, path, parseStringArray),
      effortLevel: parseRequiredField(objectValue, "effortLevel", endpoint, path, parseEffortLevel),
    };
  }

  if (type === "tool_call") {
    return {
      type,
      id: parseOptionalField(objectValue, "id", endpoint, path, parseString),
      name: parseRequiredField(objectValue, "name", endpoint, path, parseString),
      status: parseRequiredField(objectValue, "status", endpoint, path, parseToolCallStatus),
      providerStatus: parseOptionalField(objectValue, "providerStatus", endpoint, path, parseNullableString),
      input: parseRequiredField(objectValue, "input", endpoint, path, parseNullableString),
      output: parseRequiredField(objectValue, "output", endpoint, path, parseNullableString),
      streamPosition: parseOptionalField(objectValue, "streamPosition", endpoint, path, parseChatStreamPosition),
    };
  }

  return {
    type,
    summary: parseRequiredField(objectValue, "summary", endpoint, path, parseString),
    streamPosition: parseOptionalField(objectValue, "streamPosition", endpoint, path, parseChatStreamPosition),
  };
}

function parseChatSessionHistoryMessage(
  value: unknown,
  endpoint: string,
  path: string,
): ChatSessionHistoryMessage {
  const objectValue = parseObject(value, endpoint, path);
  return {
    role: parseRequiredField(objectValue, "role", endpoint, path, parseChatRole),
    content: parseRequiredField(objectValue, "content", endpoint, path, parseContentPartArray),
    timestamp: parseRequiredField(objectValue, "timestamp", endpoint, path, parseNumber),
    isError: parseRequiredField(objectValue, "isError", endpoint, path, parseBoolean),
    isStopped: parseRequiredField(objectValue, "isStopped", endpoint, path, parseBoolean),
    cursor: parseOptionalField(objectValue, "cursor", endpoint, path, parseNullableString) ?? null,
    itemId: parseOptionalField(objectValue, "itemId", endpoint, path, parseNullableString) ?? null,
  };
}

export function parseContentPartArray(value: unknown, endpoint: string, path: string): ReadonlyArray<ContentPart> {
  return parseArray(value, endpoint, path, parseContentPart);
}

function parseChatRole(value: unknown, endpoint: string, path: string): "user" | "assistant" {
  return parseEnum(value, endpoint, path, ["user", "assistant"]);
}

function parseReasoningEffort(value: unknown, endpoint: string, path: string): "low" | "medium" | "high" | "minimal" {
  return parseEnum(value, endpoint, path, ["low", "medium", "high", "minimal"]);
}

function parseContentPartType(
  value: unknown,
  endpoint: string,
  path: string,
): "text" | "image" | "file" | "card" | "tool_call" | "reasoning_summary" {
  return parseEnum(value, endpoint, path, ["text", "image", "file", "card", "tool_call", "reasoning_summary"]);
}

function parseToolCallStatus(value: unknown, endpoint: string, path: string): "started" | "completed" {
  return parseEnum(value, endpoint, path, ["started", "completed"]);
}

export function parseChatSessionSnapshotResponse(value: unknown, endpoint: string): ChatSessionSnapshot {
  const objectValue = parseObject(value, endpoint, "");
  return {
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    conversationScopeId: parseRequiredField(objectValue, "conversationScopeId", endpoint, "", parseString),
    conversation: parseRequiredField(objectValue, "conversation", endpoint, "", parseChatConversation),
    composerSuggestions: parseRequiredField(objectValue, "composerSuggestions", endpoint, "", parseChatComposerSuggestionArray),
    chatConfig: parseRequiredField(objectValue, "chatConfig", endpoint, "", parseChatConfig),
    activeRun: parseRequiredField(objectValue, "activeRun", endpoint, "", parseNullableChatActiveRun),
  };
}

function parseChatSessionHistoryMessageArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<ChatSessionHistoryMessage> {
  return parseArray(value, endpoint, path, parseChatSessionHistoryMessage);
}

export function parseStartChatRunResponse(value: unknown, endpoint: string): StartChatRunResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    accepted: parseLiteral(parseRequiredField(objectValue, "accepted", endpoint, "", parseBoolean), endpoint, "accepted", true),
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    conversationScopeId: parseRequiredField(objectValue, "conversationScopeId", endpoint, "", parseString),
    conversation: parseRequiredField(objectValue, "conversation", endpoint, "", parseChatConversation),
    composerSuggestions: parseRequiredField(objectValue, "composerSuggestions", endpoint, "", parseChatComposerSuggestionArray),
    chatConfig: parseRequiredField(objectValue, "chatConfig", endpoint, "", parseChatConfig),
    activeRun: parseRequiredField(objectValue, "activeRun", endpoint, "", parseNullableChatActiveRun),
    deduplicated: parseOptionalField(objectValue, "deduplicated", endpoint, "", parseBoolean),
  };
}

export function parseNewChatSessionResponse(value: unknown, endpoint: string): NewChatSessionResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    composerSuggestions: parseRequiredField(objectValue, "composerSuggestions", endpoint, "", parseChatComposerSuggestionArray),
    chatConfig: parseRequiredField(objectValue, "chatConfig", endpoint, "", parseChatConfig),
  };
}

export function parseStopChatRunResponse(value: unknown, endpoint: string): StopChatRunResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    stopped: parseRequiredField(objectValue, "stopped", endpoint, "", parseBoolean),
    stillRunning: parseRequiredField(objectValue, "stillRunning", endpoint, "", parseBoolean),
  };
}

export function parseChatTranscriptionResponse(value: unknown, endpoint: string): ChatTranscriptionResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    text: parseRequiredField(objectValue, "text", endpoint, "", parseString),
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
  };
}
