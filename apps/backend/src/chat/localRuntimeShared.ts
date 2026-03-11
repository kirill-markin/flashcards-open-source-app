import { ZodError } from "zod";
import type {
  LocalAssistantToolCall,
  LocalChatDevicePlatform,
  LocalChatStreamEvent,
  LocalContentPart,
} from "./localTypes";
import {
  buildAssistantRoleSection,
  buildCardSideContractSection,
  buildConciseStyleSection,
  buildDatetimeSection,
  buildLocalRepairSection,
  buildLocalToolCallExamplesSection,
  buildLocalToolCallRulesSection,
  buildLocalWorkspaceSection,
  buildLocalWritePolicyLines,
  buildPromptFromSections,
  buildWritePolicySection,
} from "./promptSections";
import { OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS } from "./openai/localTools";

export const MAX_LOCAL_TOOL_REPAIR_ATTEMPTS = 3;
const LOCAL_TOOL_NAME_SET = new Set(Object.keys(OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS));

type RepairableToolCallError = Readonly<{
  toolName: string | null;
  repairPrompt: string;
  rawDetails: string;
}>;

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

function platformPromptLabel(devicePlatform: LocalChatDevicePlatform): string {
  return devicePlatform === "web" ? "Use this assistant in the browser." : "Use this assistant on iPhone.";
}

/**
 * Builds the canonical system instructions for local-turn runtimes. Every
 * local client must use the same tool-call rules and write-policy wording so
 * OpenAI and Anthropic turns produce compatible local tool requests.
 */
export function buildLocalSystemInstructions(
  timezone: string,
  devicePlatform: LocalChatDevicePlatform,
): string {
  return buildPromptFromSections([
    buildAssistantRoleSection(),
    platformPromptLabel(devicePlatform),
    buildLocalWorkspaceSection(),
    buildCardSideContractSection(),
    buildConciseStyleSection(),
    buildLocalToolCallRulesSection(),
    buildWritePolicySection(buildLocalWritePolicyLines()),
    buildLocalToolCallExamplesSection(),
    buildLocalRepairSection(),
    buildDatetimeSection(timezone),
  ]);
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

function createRepairableToolCallError(
  toolName: string | null,
  repairPrompt: string,
  rawDetails: string,
): RepairableToolCallError {
  return {
    toolName,
    repairPrompt,
    rawDetails,
  };
}

/**
 * Validates local tool arguments against the shared canonical local-tool
 * schema. The returned JSON string is normalized and safe to persist in local
 * chat history and replay in later turns.
 */
export function validateLocalToolArguments(toolName: string, rawArguments: string): string {
  let parsedArguments: unknown;

  try {
    parsedArguments = JSON.parse(rawArguments);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createRepairableToolCallError(
      toolName,
      buildRepairPrompt(toolName, `Invalid JSON: ${message}`),
      `Invalid JSON: ${message}. Raw arguments: ${rawArguments}`,
    );
  }

  const validator = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS[toolName];
  if (validator === undefined) {
    throw createRepairableToolCallError(
      toolName,
      buildRepairPrompt(toolName, "Unknown tool name."),
      `Unknown tool name: ${toolName}`,
    );
  }

  const result = validator.safeParse(parsedArguments);
  if (!result.success) {
    const details = formatSchemaIssues(result.error);
    throw createRepairableToolCallError(
      toolName,
      buildRepairPrompt(toolName, details),
      details,
    );
  }

  return JSON.stringify(result.data);
}

export function isRepairableToolCallError(error: unknown): error is RepairableToolCallError {
  return typeof error === "object"
    && error !== null
    && "toolName" in error
    && "repairPrompt" in error
    && "rawDetails" in error;
}

export function makeLocalRepairStatusEvent(
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
    maxAttempts: MAX_LOCAL_TOOL_REPAIR_ATTEMPTS,
    toolName,
  };
}

/**
 * Normalizes one validated local tool call into the persisted assistant-tool
 * record format shared by iOS and web local chat histories.
 */
export function toLocalAssistantToolCall(
  toolCallId: string,
  name: string,
  rawInput: string,
): LocalAssistantToolCall {
  return {
    toolCallId,
    name,
    input: validateLocalToolArguments(name, rawInput),
  };
}

export function isLocalToolName(name: string): boolean {
  return LOCAL_TOOL_NAME_SET.has(name);
}

export function summarizeLocalContentParts(parts: ReadonlyArray<LocalContentPart>): string {
  return parts.map((part) => {
    if (part.type === "text") {
      return part.text;
    }

    if (part.type === "image") {
      return "[image attached]";
    }

    if (part.type === "file") {
      return `[${part.fileName}]`;
    }

    if (isLocalToolName(part.name)) {
      return "";
    }

    return part.status === "completed"
      ? `[${part.name} completed]`
      : `[${part.name} started]`;
  }).filter((part) => part !== "").join("\n");
}

export function extractLocalAssistantToolCalls(
  parts: ReadonlyArray<LocalContentPart>,
): ReadonlyArray<LocalAssistantToolCall> {
  return parts.flatMap((part) => {
    if (part.type !== "tool_call" || isLocalToolName(part.name) === false) {
      return [];
    }

    return [{
      toolCallId: part.toolCallId,
      name: part.name,
      input: part.input ?? "{}",
    }];
  });
}
