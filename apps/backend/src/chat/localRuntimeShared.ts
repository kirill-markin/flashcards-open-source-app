import { Buffer } from "node:buffer";
import { ZodError } from "zod";
import type {
  LocalAssistantToolCall,
  LocalChatDevicePlatform,
  LocalChatStreamEvent,
  LocalChatUserContext,
  LocalContentPart,
  LocalFileContentPart,
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
  buildUserContextSection,
  buildWritePolicySection,
} from "./promptSections";
import { OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS } from "./openai/localTools";

export const MAX_LOCAL_TOOL_REPAIR_ATTEMPTS = 3;
const LOCAL_TOOL_NAME_SET = new Set(Object.keys(OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS));
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

function normalizeMediaType(mediaType: string): string {
  return mediaType.trim().toLowerCase();
}

function normalizeFileName(fileName: string): string {
  return fileName.trim().toLowerCase();
}

function hasInlineTextFileExtension(fileName: string): boolean {
  const normalizedFileName = normalizeFileName(fileName);
  return [...INLINE_TEXT_FILE_EXTENSIONS].some((extension) => normalizedFileName.endsWith(extension));
}

function isCsvFile(mediaType: string, fileName: string): boolean {
  const normalizedMediaType = normalizeMediaType(mediaType);
  const normalizedFileName = normalizeFileName(fileName);
  return normalizedMediaType === "text/csv"
    || normalizedMediaType === "application/csv"
    || normalizedFileName.endsWith(".csv");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildLocalAttachmentHandlingSection(): string {
  return [
    "Attachment handling:",
    "If a small text attachment is duplicated inline inside <attached_text_file>, read that inline text before using code execution.",
    "When a file is available to code execution, the mounted filename may differ from the uploaded filename.",
    "Mounted files are typically exposed under /mnt/data with generated names or prefixes.",
    "Inspect mounted files before claiming that an attached file is missing.",
  ].join("\n");
}

/**
 * Builds the canonical system instructions for local-turn runtimes. Every
 * local client must use the same tool-call rules and write-policy wording so
 * OpenAI and Anthropic turns produce compatible local tool requests. The
 * attachment section documents the hybrid delivery strategy for small text
 * files and instructs models how to find mounted files inside code execution.
 *
 * iOS consumer:
 * `apps/ios/Flashcards/Flashcards/AI/AIChatSessionRuntime.swift`
 */
export function buildLocalSystemInstructions(
  timezone: string,
  devicePlatform: LocalChatDevicePlatform,
  userContext: LocalChatUserContext,
): string {
  return buildPromptFromSections([
    buildAssistantRoleSection(),
    platformPromptLabel(devicePlatform),
    buildUserContextSection(userContext.totalCards),
    buildLocalWorkspaceSection(),
    buildCardSideContractSection(),
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
 * Returns true when a file should be considered for inline text duplication in
 * addition to tool/container delivery. CSV is intentionally excluded because
 * it is more often processed programmatically than read conversationally.
 */
export function isInlineTextAttachmentCandidate(part: LocalFileContentPart): boolean {
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
 * Decodes a text-like attachment as strict UTF-8 when it is small enough to
 * duplicate inline. Invalid UTF-8 and oversized files are left tool-only.
 */
export function decodeInlineTextAttachment(part: LocalFileContentPart): string | null {
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
 * Formats the duplicated inline text payload so the model can read small text
 * attachments directly from the prompt without guessing file boundaries.
 */
export function buildInlineTextAttachmentBlock(
  part: LocalFileContentPart,
  textContent: string,
): string {
  return [
    `<attached_text_file name="${escapeXmlAttribute(part.fileName)}" media_type="${escapeXmlAttribute(part.mediaType)}">`,
    escapeXmlText(textContent),
    "</attached_text_file>",
  ].join("\n");
}

/**
 * Explains how the same uploaded file is exposed to code execution. The hint
 * avoids promising an exact mounted filename while still pointing the model to
 * the documented /mnt/data pattern.
 */
export function buildExecutionEnvironmentHintBlock(part: LocalFileContentPart): string {
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
 * Returns the full inline attachment context for small text files. The caller
 * can append this directly as a text block next to the uploaded file handle.
 */
export function buildInlineTextAttachmentContext(part: LocalFileContentPart): string | null {
  const textContent = decodeInlineTextAttachment(part);
  if (textContent === null) {
    return null;
  }

  return [
    buildInlineTextAttachmentBlock(part, textContent),
    buildExecutionEnvironmentHintBlock(part),
  ].join("\n");
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

function getLocalToolArgumentValidator(
  toolName: string,
): typeof OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS[keyof typeof OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS] | undefined {
  return OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS[
    toolName as keyof typeof OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS
  ];
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

  const validator = getLocalToolArgumentValidator(toolName);
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
