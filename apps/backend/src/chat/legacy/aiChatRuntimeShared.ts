/**
 * Legacy chat backend shared runtime helpers for old `/chat/turn` clients.
 * The backend-first `/chat` stack persists sessions and runs on the server and no longer relies on this legacy runtime shape.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
import { Buffer } from "node:buffer";
import { ZodError } from "zod";
import type {
  AIChatAssistantToolCall,
  AIChatContentPart,
  AIChatDevicePlatform,
  AIChatFileContentPart,
  AIChatTurnStreamEvent,
  AIChatUserContext,
} from "./aiChatTypes";
import {
  buildAssistantRoleSection,
  buildCardEffortSection,
  buildCardSideContractSection,
  buildConciseStyleSection,
  buildDatetimeSection,
  buildLocalRepairSection,
  buildPlainTextChatFormattingSection,
  buildLocalToolCallExamplesSection,
  buildLocalToolCallRulesSection,
  buildLocalWorkspaceSection,
  buildLocalWritePolicyLines,
  buildPromptFromSections,
  buildUserContextSection,
  buildWritePolicySection,
} from "./promptSections";
import { OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS } from "./openai/aiChatTools";

export const MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS = 3;
const AI_CHAT_TOOL_NAME_SET = new Set(Object.keys(OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS));
export const INLINE_TEXT_ATTACHMENT_MAX_BYTES = 64 * 1024;

const GENERIC_FILE_MEDIA_TYPES = new Set([
  "",
  "application/octet-stream",
]);

const INLINE_TEXT_MEDIA_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
  "application/yaml",
  "text/yaml",
  "text/x-yaml",
  "application/sql",
  "text/x-sql",
]);

const INLINE_TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".sql",
  ".log",
]);

type RepairableToolCallError = Readonly<{
  toolName: string | null;
  repairPrompt: string;
  rawDetails: string;
}>;

/**
 * This legacy chat backend helper formats validation paths for old `/chat/turn` tool-call repair.
 * The backend-first `/chat` stack validates and repairs tool calls through a different server-owned loop.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return "root";
  }

  return path.map((segment) => String(segment)).join(".");
}

/**
 * This legacy chat backend helper formats validation paths for old `/chat/turn` tool-call repair.
 * The backend-first `/chat` stack validates and repairs tool calls through a different server-owned loop.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
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

/**
 * This legacy chat backend helper describes the client platform in old `/chat/turn` system prompts.
 * The backend-first `/chat` stack injects platform context through a different server-owned runtime path.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function platformPromptLabel(devicePlatform: AIChatDevicePlatform): string {
  if (devicePlatform === "web") {
    return "The user is chatting with you in the web browser chat.";
  }

  if (devicePlatform === "android") {
    return "The user is chatting with you in the native Android app chat.";
  }

  return "The user is chatting with you in the iOS app chat on iPhone.";
}

/**
 * This legacy chat backend helper normalizes media types for old `/chat/turn` attachment handling.
 * The backend-first `/chat` stack maps attachments through a different server-owned input pipeline.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function normalizeMediaType(mediaType: string): string {
  return mediaType.trim().toLowerCase();
}

/**
 * This legacy chat backend helper normalizes filenames for old `/chat/turn` attachment handling.
 * The backend-first `/chat` stack handles attachment metadata through a different server-owned flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function normalizeFileName(fileName: string): string {
  return fileName.trim().toLowerCase();
}

/**
 * This legacy chat backend helper checks text-like file extensions for old `/chat/turn` attachments.
 * The backend-first `/chat` stack decides attachment treatment through a different server-owned input contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function hasInlineTextFileExtension(fileName: string): boolean {
  const normalizedFileName = normalizeFileName(fileName);
  return [...INLINE_TEXT_FILE_EXTENSIONS].some((extension) => normalizedFileName.endsWith(extension));
}

/**
 * This legacy chat backend helper recognizes CSV files for old `/chat/turn` attachments.
 * The backend-first `/chat` stack routes spreadsheet-like input through a different server-owned pipeline.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function isCsvFile(mediaType: string, fileName: string): boolean {
  const normalizedMediaType = normalizeMediaType(mediaType);
  const normalizedFileName = normalizeFileName(fileName);
  return normalizedMediaType === "text/csv"
    || normalizedMediaType === "application/csv"
    || normalizedFileName.endsWith(".csv");
}

/**
 * This legacy chat backend helper recognizes spreadsheet attachments for old `/chat/turn` clients.
 * The backend-first `/chat` stack handles file capabilities through a different server-owned runtime.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function isSpreadsheetFile(mediaType: string, fileName: string): boolean {
  const normalizedMediaType = normalizeMediaType(mediaType);
  const normalizedFileName = normalizeFileName(fileName);

  if (isCsvFile(mediaType, fileName)) {
    return true;
  }

  return normalizedMediaType === "application/vnd.ms-excel"
    || normalizedMediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || normalizedFileName.endsWith(".xls")
    || normalizedFileName.endsWith(".xlsx");
}

/**
 * This legacy chat backend helper escapes XML attributes for old `/chat/turn` inline attachment blocks.
 * The backend-first `/chat` stack no longer relies on this legacy inline-XML prompt format.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * This legacy chat backend helper escapes XML text for old `/chat/turn` inline attachment blocks.
 * The backend-first `/chat` stack structures attachment context through a different server-owned flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * This legacy chat backend helper explains attachment handling in the old `/chat/turn` system prompt.
 * The backend-first `/chat` stack now owns attachment processing through a different server-side contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function buildLocalAttachmentHandlingSection(): string {
  return [
    "Attachment handling:",
    "If a small text attachment is duplicated inline inside <attached_text_file>, read that inline text before using code execution.",
    "For CSV, XLS, and XLSX attachments, inspect the file with code execution before saying it is missing or inaccessible.",
    "Files uploaded earlier in the same chat may remain available to code execution even when the current user message has no attachment.",
    "When a file is available to code execution, the mounted filename may differ from the uploaded filename.",
    "Mounted files are typically exposed under /mnt/data with generated names or prefixes.",
    "Inspect mounted files before claiming that an attached file is missing.",
  ].join("\n");
}

/**
 * This legacy chat backend entrypoint builds canonical system instructions for old `/chat/turn` providers.
 * The backend-first `/chat` stack owns prompts through a different server-owned session and run model.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildAIChatSystemInstructions(
  timezone: string,
  devicePlatform: AIChatDevicePlatform,
  userContext: AIChatUserContext,
): string {
  return buildPromptFromSections([
    buildAssistantRoleSection(),
    platformPromptLabel(devicePlatform),
    buildPlainTextChatFormattingSection(),
    buildUserContextSection(userContext.totalCards),
    buildLocalWorkspaceSection(),
    buildCardSideContractSection(),
    buildCardEffortSection(),
    buildConciseStyleSection(),
    buildLocalToolCallRulesSection(),
    buildWritePolicySection(buildLocalWritePolicyLines()),
    buildLocalToolCallExamplesSection(),
    buildLocalRepairSection(),
    buildLocalAttachmentHandlingSection(),
    buildDatetimeSection(timezone),
  ]);
}

/**
 * This legacy chat backend helper decides whether old `/chat/turn` attachments should also be duplicated inline.
 * The backend-first `/chat` stack handles attachment fan-out through a different server-owned input path.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function isInlineTextAttachmentCandidate(part: AIChatFileContentPart): boolean {
  if (isCsvFile(part.mediaType, part.fileName)) {
    return false;
  }

  const normalizedMediaType = normalizeMediaType(part.mediaType);
  if (INLINE_TEXT_MEDIA_TYPES.has(normalizedMediaType)) {
    return true;
  }

  if (GENERIC_FILE_MEDIA_TYPES.has(normalizedMediaType)) {
    return hasInlineTextFileExtension(part.fileName);
  }

  return normalizedMediaType === "text/plain" && hasInlineTextFileExtension(part.fileName);
}

/**
 * This legacy chat backend helper decodes small text attachments for old `/chat/turn` inline prompt duplication.
 * The backend-first `/chat` stack handles attachment decoding through a different server-owned pipeline.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function decodeInlineTextAttachment(part: AIChatFileContentPart): string | null {
  if (isInlineTextAttachmentCandidate(part) === false) {
    return null;
  }

  const bytes = Buffer.from(part.base64Data, "base64");
  if (bytes.byteLength > INLINE_TEXT_ATTACHMENT_MAX_BYTES) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * This legacy chat backend helper formats inline text attachment payloads for old `/chat/turn` prompts.
 * The backend-first `/chat` stack does not depend on this legacy XML-like attachment block format.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildInlineTextAttachmentBlock(
  part: AIChatFileContentPart,
  textContent: string,
): string {
  return [
    `<attached_text_file name="${escapeXmlAttribute(part.fileName)}" media_type="${escapeXmlAttribute(part.mediaType)}">`,
    escapeXmlText(textContent),
    "</attached_text_file>",
  ].join("\n");
}

/**
 * This legacy chat backend helper explains code-execution file mounting for old `/chat/turn` prompts.
 * The backend-first `/chat` stack delivers file context through a different server-owned attachment flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildExecutionEnvironmentHintBlock(part: AIChatFileContentPart): string {
  return [
    `<attached_file_execution_hint name="${escapeXmlAttribute(part.fileName)}">`,
    "The original file is also available to code execution.",
    "Mounted files are typically exposed under /mnt/data with generated names or prefixes.",
    "The mounted filename may differ from the uploaded filename.",
    "Inspect mounted files before claiming that the file is missing.",
    "</attached_file_execution_hint>",
  ].join("\n");
}

/**
 * This legacy chat backend helper returns combined inline attachment context for old `/chat/turn` prompts.
 * The backend-first `/chat` stack no longer relies on this legacy prompt-side attachment bundling.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildInlineTextAttachmentContext(part: AIChatFileContentPart): string | null {
  const textContent = decodeInlineTextAttachment(part);
  if (textContent === null) {
    return null;
  }

  return [
    buildInlineTextAttachmentBlock(part, textContent),
    buildExecutionEnvironmentHintBlock(part),
  ].join("\n");
}

/**
 * This legacy chat backend helper builds repair prompts for invalid old `/chat/turn` tool calls.
 * The backend-first `/chat` stack repairs tool calls through a different server-owned runtime loop.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
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

/**
 * This legacy chat backend helper creates structured repair errors for old `/chat/turn` tool validation.
 * The backend-first `/chat` stack models repair state differently inside persisted server runs.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
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
 * This legacy chat backend helper looks up the old `/chat/turn` validator for a tool name.
 * The backend-first `/chat` stack resolves tool schemas through a different server-owned runtime.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function getAIChatToolArgumentValidator(
  toolName: string,
): typeof OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS[keyof typeof OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS] | undefined {
  return OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS[
    toolName as keyof typeof OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS
  ];
}

/**
 * This legacy chat backend entrypoint validates tool arguments for old `/chat/turn` assistant calls.
 * The backend-first `/chat` stack validates and persists tool input through a different server-owned flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function validateAIChatToolArguments(toolName: string, rawArguments: string): string {
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

  const validator = getAIChatToolArgumentValidator(toolName);
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

/**
 * This legacy chat backend helper narrows repairable validation errors for old `/chat/turn` flows.
 * The backend-first `/chat` stack tracks tool-call repair state differently inside persisted runs.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function isRepairableToolCallError(error: unknown): error is RepairableToolCallError {
  return typeof error === "object"
    && error !== null
    && "toolName" in error
    && "repairPrompt" in error
    && "rawDetails" in error;
}

/**
 * This legacy chat backend helper creates repair status events for old `/chat/turn` streaming clients.
 * The backend-first `/chat` stack emits recovery progress through a different server-owned runtime contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function makeAIChatRepairStatusEvent(
  attempt: number,
  toolName: string | null,
): AIChatTurnStreamEvent {
  const message = toolName === null
    ? "Assistant is correcting a tool call."
    : `Assistant is correcting ${toolName}.`;

  return {
    type: "repair_attempt",
    message,
    attempt,
    maxAttempts: MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS,
    toolName,
  };
}

/**
 * This legacy chat backend helper normalizes one validated tool call into the old `/chat/turn` assistant format.
 * The backend-first `/chat` stack stores tool calls in a different server-owned item model.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function toAIChatAssistantToolCall(
  toolCallId: string,
  name: string,
  rawInput: string,
): AIChatAssistantToolCall {
  return {
    toolCallId,
    name,
    input: validateAIChatToolArguments(name, rawInput),
  };
}

/**
 * This legacy chat backend helper checks whether a tool name belongs to the old `/chat/turn` tool set.
 * The backend-first `/chat` stack resolves tools through a different server-owned runtime path.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function isAIChatToolName(name: string): boolean {
  return AI_CHAT_TOOL_NAME_SET.has(name);
}

/**
 * This legacy chat backend helper summarizes content parts into the old `/chat/turn` assistant text format.
 * The backend-first `/chat` stack stores structured content and stream positions differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function summarizeAIChatContentParts(parts: ReadonlyArray<AIChatContentPart>): string {
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

    if (isAIChatToolName(part.name)) {
      return "";
    }

    return part.status === "completed"
      ? `[${part.name} completed]`
      : `[${part.name} started]`;
  }).filter((part) => part !== "").join("\n");
}

/**
 * This legacy chat backend helper extracts normalized assistant tool calls from old `/chat/turn` content parts.
 * The backend-first `/chat` stack persists tool calls in a different server-owned message model.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function extractAIChatAssistantToolCalls(
  parts: ReadonlyArray<AIChatContentPart>,
): ReadonlyArray<AIChatAssistantToolCall> {
  return parts.flatMap((part) => {
    if (part.type !== "tool_call" || isAIChatToolName(part.name) === false) {
      return [];
    }

    return [{
      toolCallId: part.toolCallId,
      name: part.name,
      input: part.input ?? "{}",
    }];
  });
}

/**
 * This legacy chat backend helper rebuilds completed tool-call content parts for old `/chat/turn` histories.
 * The backend-first `/chat` stack stores tool progress and outputs through a different server-owned item model.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildAssistantToolCallContentParts(
  toolCalls: ReadonlyArray<AIChatAssistantToolCall>,
  outputsByToolCallId: ReadonlyMap<string, string>,
): ReadonlyArray<Extract<AIChatContentPart, { type: "tool_call" }>> {
  return toolCalls.map((toolCall) => ({
    type: "tool_call",
    toolCallId: toolCall.toolCallId,
    name: toolCall.name,
    status: "completed",
    input: toolCall.input,
    output: outputsByToolCallId.get(toolCall.toolCallId) ?? null,
  }));
}
