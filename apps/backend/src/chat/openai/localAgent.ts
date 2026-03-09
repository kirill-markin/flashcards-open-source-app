import OpenAI from "openai";
import { ZodError } from "zod";
import type {
  EasyInputMessage,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { LocalAssistantToolCall, LocalChatMessage, LocalChatStreamEvent } from "../localTypes";
import {
  OPENAI_LOCAL_FLASHCARDS_TOOLS,
  OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS,
} from "./localTools";

const LOCAL_CHAT_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.2",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
]);

const MAX_TOOL_REPAIR_ATTEMPTS = 3;

type LocalResponseStreamEvent = Readonly<{
  type: string;
  delta?: string;
}>;

type ResponseStreamLike = AsyncIterable<LocalResponseStreamEvent> & Readonly<{
  finalResponse: () => Promise<Readonly<{
    output: ReadonlyArray<Readonly<{ type: string }>>;
  }>>;
}>;

type OpenAIResponsesClient = Readonly<{
  responses: Readonly<{
    stream: (body: Readonly<Record<string, unknown>>) => ResponseStreamLike;
  }>;
}>;

type LocalChatLogEvent =
  | Readonly<{
    action: "request";
    requestId: string;
    model: string;
    messageCount: number;
  }>
  | Readonly<{
    action: "stream_opened";
    requestId: string;
    model: string;
    attempt: number;
  }>
  | Readonly<{
    action: "tool_call_validated";
    requestId: string;
    model: string;
    toolName: string;
    toolCallId: string;
  }>
  | Readonly<{
    action: "repair_attempt";
    requestId: string;
    model: string;
    attempt: number;
    maxAttempts: number;
    toolName: string | null;
    details: string;
  }>
  | Readonly<{
    action: "repair_exhausted";
    requestId: string;
    model: string;
    toolName: string | null;
  }>
  | Readonly<{
    action: "stream_closed";
    requestId: string;
    model: string;
    attempt: number;
    deltaCount: number;
    toolCallCount: number;
  }>;

type RepairPromptState = Readonly<{
  assistantText: string;
  prompt: string;
}>;

type ValidatedToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export type StreamLocalTurnParams = Readonly<{
  messages: ReadonlyArray<LocalChatMessage>;
  model: string;
  timezone: string;
  requestId: string;
}>;

class RepairableToolCallError extends Error {
  readonly toolName: string | null;
  readonly repairPrompt: string;
  readonly rawDetails: string;

  constructor(toolName: string | null, repairPrompt: string, rawDetails: string) {
    super("Assistant could not prepare a valid tool call.");
    this.toolName = toolName;
    this.repairPrompt = repairPrompt;
    this.rawDetails = rawDetails;
  }
}

export class LocalChatRuntimeError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(message: string, code: string, stage: string) {
    super(message);
    this.code = code;
    this.stage = stage;
  }
}

function logLocalChatEvent(event: LocalChatLogEvent): void {
  console.error(JSON.stringify({
    domain: "chat",
    vendor: "openai",
    mode: "local_ios",
    ...event,
  }));
}

function formatDatetime(timezone: string): string {
  const now = new Date();
  const utc = now.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const local = now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  return `Current datetime - UTC: ${utc} | User local (${timezone}): ${local}`;
}

export function buildLocalSystemInstructions(timezone: string): string {
  return [
    "You are a flashcards assistant for an offline-first flashcards app on iPhone.",
    "The local device database is the source of truth for reads.",
    "Use only the provided local tools to inspect workspace data.",
    "Keep answers concise, direct, and operational.",
    "",
    "Tool-call rules:",
    "- Tool arguments must be exactly one JSON object.",
    "- Never send prose, markdown, comments, arrays, or multiple JSON objects.",
    "- For strict schemas, every property in the tool contract must be present.",
    "- If a field is optional semantically, send null instead of omitting it.",
    "- For update tools, include unchanged editable fields as null.",
    "- Do not invent extra properties.",
    "",
    "Write policy:",
    "- Before any write tool call you must describe the exact change.",
    "- You must then wait for explicit user confirmation before executing the write tool.",
    "- Use write tools only after the latest user message clearly confirms the exact proposed change.",
    "- Never mutate hidden FSRS fields, sync metadata, outbox rows, cloud settings, or arbitrary local tables directly.",
    "",
    "Tool-call JSON examples:",
    "- list_cards => {\"limit\": 20}",
    "- search_cards => {\"query\": \"grammar\", \"limit\": null}",
    "- list_review_history => {\"limit\": 20, \"cardId\": null}",
    "- update_card => {\"cardId\": \"card_123\", \"frontText\": null, \"backText\": \"Updated back\", \"tags\": null, \"effortLevel\": null}",
    "- update_deck => {\"deckId\": \"deck_123\", \"name\": null, \"effortLevels\": [\"fast\", \"medium\"], \"combineWith\": \"and\", \"tagsOperator\": \"containsAny\", \"tags\": [\"grammar\"]}",
    "",
    "If a previous tool call was rejected for invalid arguments, correct the tool call shape and continue without repeating earlier assistant text.",
    formatDatetime(timezone),
  ].join("\n");
}

function mapMessage(message: LocalChatMessage): ReadonlyArray<ResponseInputItem> {
  if (message.role === "user") {
    const userMessage: EasyInputMessage = {
      type: "message",
      role: "user",
      content: message.content,
    };
    return [userMessage];
  }

  if (message.role === "assistant") {
    const items: Array<ResponseInputItem> = [];

    if (message.content !== "") {
      items.push({
        type: "message",
        role: "assistant",
        content: message.content,
      });
    }

    for (const toolCall of message.toolCalls) {
      items.push({
        type: "function_call",
        call_id: toolCall.toolCallId,
        name: toolCall.name,
        arguments: toolCall.input,
      });
    }

    return items;
  }

  return [{
    type: "function_call_output",
    call_id: message.toolCallId,
    output: message.output,
  }];
}

function buildInput(
  messages: ReadonlyArray<LocalChatMessage>,
  repairState: RepairPromptState | null,
): ReadonlyArray<ResponseInputItem> {
  const items: Array<ResponseInputItem> = [];

  for (const message of messages) {
    items.push(...mapMessage(message));
  }

  if (repairState === null) {
    return items;
  }

  if (repairState.assistantText !== "") {
    items.push({
      type: "message",
      role: "assistant",
      content: repairState.assistantText,
    });
  }

  items.push({
    type: "message",
    role: "user",
    content: repairState.prompt,
  });

  return items;
}

function isFunctionToolCall(
  item: Readonly<{ type: string }>,
): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

function createClient(): OpenAIResponsesClient {
  return new OpenAI();
}

function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return "root";
  }

  return path.map((segment) => String(segment)).join(".");
}

function formatSchemaIssues(error: ZodError): string {
  return error.issues.map((issue) => {
    const path = formatIssuePath(issue.path);

    if (issue.code === "invalid_type" && "input" in issue && issue.input === undefined) {
      return `${path} is required`;
    }

    if (issue.code === "unrecognized_keys") {
      return `unexpected keys: ${issue.keys.join(", ")}`;
    }

    return `${path}: ${issue.message}`;
  }).join("; ");
}

function buildRepairPrompt(toolName: string | null, details: string): string {
  return [
    "Your previous tool call arguments were invalid.",
    toolName === null ? "Tool: unknown" : `Tool: ${toolName}`,
    `Validation error: ${details}`,
    "Return one corrected tool call only.",
    "Return exactly one JSON object for the tool arguments.",
    "Include every required property.",
    "Use null instead of omitting semantically optional fields.",
    "Do not repeat earlier assistant text already sent to the user.",
  ].join("\n");
}

function validateToolArguments(
  toolName: string,
  rawArguments: string,
): string {
  let parsedArguments: unknown;

  try {
    parsedArguments = JSON.parse(rawArguments);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepairableToolCallError(
      toolName,
      buildRepairPrompt(toolName, `Invalid JSON: ${message}`),
      `Invalid JSON: ${message}. Raw arguments: ${rawArguments}`,
    );
  }

  const validator = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS[toolName];
  if (validator === undefined) {
    throw new RepairableToolCallError(
      toolName,
      buildRepairPrompt(toolName, "Unknown tool name."),
      `Unknown tool name: ${toolName}`,
    );
  }

  const result = validator.safeParse(parsedArguments);
  if (!result.success) {
    const details = formatSchemaIssues(result.error);
    throw new RepairableToolCallError(
      toolName,
      buildRepairPrompt(toolName, details),
      details,
    );
  }

  return JSON.stringify(result.data);
}

function normalizeToolCall(
  toolCall: ResponseFunctionToolCall,
  params: Readonly<{ requestId: string; model: string }>,
): ValidatedToolCall {
  const normalizedInput = validateToolArguments(toolCall.name, toolCall.arguments);
  logLocalChatEvent({
    action: "tool_call_validated",
    requestId: params.requestId,
    model: params.model,
    toolName: toolCall.name,
    toolCallId: toolCall.call_id,
  });
  return {
    toolCallId: toolCall.call_id,
    name: toolCall.name,
    input: normalizedInput,
  };
}

function normalizeToolCalls(
  toolCalls: ReadonlyArray<ResponseFunctionToolCall>,
  params: Readonly<{ requestId: string; model: string }>,
): ReadonlyArray<LocalAssistantToolCall> {
  return toolCalls.map((toolCall) => normalizeToolCall(toolCall, params));
}

function makeRepairStatusEvent(
  attempt: number,
  toolName: string | null,
): LocalChatStreamEvent {
  const message = toolName === null
    ? "Assistant is correcting a tool call."
    : `Assistant is correcting ${toolName}.`;

  return {
    type: "repair_attempt",
    message,
    attempt,
    maxAttempts: MAX_TOOL_REPAIR_ATTEMPTS,
    toolName,
  };
}

export function isSupportedLocalChatModel(model: string): boolean {
  return LOCAL_CHAT_MODEL_IDS.has(model);
}

export async function* streamLocalAgentTurn(
  params: StreamLocalTurnParams,
  client: OpenAIResponsesClient,
): AsyncGenerator<LocalChatStreamEvent> {
  logLocalChatEvent({
    action: "request",
    requestId: params.requestId,
    model: params.model,
    messageCount: params.messages.length,
  });

  let repairState: RepairPromptState | null = null;
  let streamedAssistantText = "";
  let deltaCount = 0;

  for (let repairAttempt = 0; repairAttempt <= MAX_TOOL_REPAIR_ATTEMPTS; repairAttempt++) {
    logLocalChatEvent({
      action: "stream_opened",
      requestId: params.requestId,
      model: params.model,
      attempt: repairAttempt + 1,
    });
    const stream = client.responses.stream({
      model: params.model,
      instructions: buildLocalSystemInstructions(params.timezone),
      input: buildInput(params.messages, repairState),
      tools: OPENAI_LOCAL_FLASHCARDS_TOOLS,
      parallel_tool_calls: false,
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta !== undefined) {
        deltaCount += 1;
        streamedAssistantText += event.delta;
        yield { type: "delta", text: event.delta };
      }
    }

    const finalResponse = await stream.finalResponse();
    const toolCalls = finalResponse.output.filter(isFunctionToolCall);

    if (toolCalls.length === 0) {
      logLocalChatEvent({
        action: "stream_closed",
        requestId: params.requestId,
        model: params.model,
        attempt: repairAttempt + 1,
        deltaCount,
        toolCallCount: 0,
      });
      yield { type: "done" };
      return;
    }

    try {
      const normalizedToolCalls = normalizeToolCalls(toolCalls, {
        requestId: params.requestId,
        model: params.model,
      });
      logLocalChatEvent({
        action: "stream_closed",
        requestId: params.requestId,
        model: params.model,
        attempt: repairAttempt + 1,
        deltaCount,
        toolCallCount: normalizedToolCalls.length,
      });

      for (const toolCall of normalizedToolCalls) {
        yield {
          type: "tool_call_request",
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          input: toolCall.input,
        };
      }

      yield { type: "await_tool_results" };
      return;
    } catch (error) {
      if ((error instanceof RepairableToolCallError) === false) {
        throw error;
      }

      if (repairAttempt >= MAX_TOOL_REPAIR_ATTEMPTS) {
        logLocalChatEvent({
          action: "repair_exhausted",
          requestId: params.requestId,
          model: params.model,
          toolName: error.toolName,
        });
        throw new LocalChatRuntimeError(
          "Assistant could not prepare a valid tool call. Try again.",
          "LOCAL_TOOL_CALL_INVALID",
          "tool_call_validation",
        );
      }

      const nextAttempt = repairAttempt + 1;
      logLocalChatEvent({
        action: "repair_attempt",
        requestId: params.requestId,
        model: params.model,
        attempt: nextAttempt,
        maxAttempts: MAX_TOOL_REPAIR_ATTEMPTS,
        toolName: error.toolName,
        details: error.rawDetails,
      });
      repairState = {
        assistantText: streamedAssistantText,
        prompt: error.repairPrompt,
      };
      yield makeRepairStatusEvent(nextAttempt, error.toolName);
    }
  }

  throw new LocalChatRuntimeError(
    "Assistant could not prepare a valid tool call. Try again.",
    "LOCAL_TOOL_CALL_INVALID",
    "tool_call_validation",
  );
}

export async function* streamLocalTurn(
  params: StreamLocalTurnParams,
): AsyncGenerator<LocalChatStreamEvent> {
  yield* streamLocalAgentTurn(params, createClient());
}
