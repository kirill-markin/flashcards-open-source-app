import { randomUUID } from "node:crypto";
import {
  createCard,
  getCard,
  listCards,
  listReviewHistory,
  listReviewQueue,
  searchCards,
  summarizeDeckState,
  updateCard,
  type CreateCardInput,
  type EffortLevel,
  type UpdateCardInput,
} from "../cards";
import type { ChatMessage, ContentPart } from "./types";

const MAX_LIST_LIMIT = 100;

export type AgentContext = Readonly<{
  workspaceId: string;
  deviceId: string;
  latestUserText: string;
}>;

type WriteToolInput = Readonly<{
  deviceId: string;
  latestUserText: string;
}>;

const CONFIRMATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bconfirm\b/i,
  /\bapproved?\b/i,
  /\byes\b/i,
  /\bgo ahead\b/i,
  /\bdo it\b/i,
  /\bapply (it|this|changes?)\b/i,
  /\bproceed\b/i,
];

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
  return `Current datetime — UTC: ${utc} | User local (${timezone}): ${local}`;
}

const BASE_SYSTEM_INSTRUCTIONS = `You are a flashcards assistant for an offline-first flashcards app.
You help with card drafting, deck cleanup, review analysis, study planning, and organizing content.
You can inspect cards, review history, due cards, and deck summary through tools.
You can also create cards and update editable card fields through tools.

Write policy:
- Before any create or update tool call, you MUST first describe the exact changes you plan to make.
- You MUST then wait for explicit user confirmation before executing the write tool.
- Treat confirmation as explicit only when the latest user message clearly approves the exact pending change.
- Never mutate due dates, reps, lapses, updated timestamps, or review-event history.
- Never invent study stats or hidden fields.

When helpful, use web search for current information and code execution for calculations, text transforms, or attachment analysis.
Be concise, direct, and operational.`;

export function buildSystemInstructions(timezone: string): string {
  return `${BASE_SYSTEM_INSTRUCTIONS}\n\n${formatDatetime(timezone)}`;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 20;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`);
  }

  return limit;
}

function ensureWriteConfirmed(input: WriteToolInput): void {
  const latestUserText = input.latestUserText.trim();
  if (latestUserText === "") {
    throw new Error("Write tool requires an explicit user confirmation message");
  }

  const isConfirmed = CONFIRMATION_PATTERNS.some((pattern) => pattern.test(latestUserText));
  if (!isConfirmed) {
    throw new Error("Write tool blocked: latest user message is not an explicit confirmation");
  }
}

function makeWriteMetadata(deviceId: string): Readonly<{
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
}> {
  return {
    clientUpdatedAt: new Date().toISOString(),
    lastModifiedByDeviceId: deviceId,
    lastOperationId: randomUUID(),
  };
}

function stringifyResult(value: unknown): string {
  return JSON.stringify(value);
}

export function normalizeTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  const uniqueTags = new Set<string>();

  for (const tag of tags) {
    const normalizedTag = tag.trim();
    if (normalizedTag !== "") {
      uniqueTags.add(normalizedTag);
    }
  }

  return [...uniqueTags];
}

function validateCreateInput(input: CreateCardInput): CreateCardInput {
  return {
    frontText: input.frontText.trim(),
    backText: input.backText.trim(),
    tags: normalizeTags(input.tags),
    effortLevel: input.effortLevel,
  };
}

function validateUpdateInput(input: UpdateCardInput): UpdateCardInput {
  return {
    frontText: input.frontText?.trim(),
    backText: input.backText?.trim(),
    tags: input.tags === undefined ? undefined : normalizeTags(input.tags),
    effortLevel: input.effortLevel,
  };
}

function ensureNonEmptyCardText(value: string, fieldName: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new Error(`${fieldName} must not be empty`);
  }

  return trimmedValue;
}

export async function runListCardsTool(workspaceId: string, limit: number | undefined): Promise<string> {
  const items = await listCards(workspaceId);
  return stringifyResult(items.slice(0, normalizeLimit(limit)));
}

export async function runGetCardTool(workspaceId: string, cardId: string): Promise<string> {
  return stringifyResult(await getCard(workspaceId, cardId));
}

export async function runSearchCardsTool(
  workspaceId: string,
  searchText: string,
  limit: number | undefined,
): Promise<string> {
  const queryText = searchText.trim();
  if (queryText === "") {
    throw new Error("query must not be empty");
  }

  return stringifyResult(await searchCards(workspaceId, queryText, normalizeLimit(limit)));
}

export async function runListDueCardsTool(workspaceId: string, limit: number | undefined): Promise<string> {
  return stringifyResult(await listReviewQueue(workspaceId, normalizeLimit(limit)));
}

export async function runListReviewHistoryTool(
  workspaceId: string,
  limit: number | undefined,
  cardId?: string,
): Promise<string> {
  return stringifyResult(await listReviewHistory(workspaceId, normalizeLimit(limit), cardId));
}

export async function runSummarizeDeckStateTool(workspaceId: string): Promise<string> {
  return stringifyResult(await summarizeDeckState(workspaceId));
}

export async function runCreateCardTool(
  workspaceId: string,
  input: CreateCardInput,
  writeToolInput: WriteToolInput,
): Promise<string> {
  ensureWriteConfirmed(writeToolInput);
  const validatedInput = validateCreateInput(input);

  return stringifyResult(await createCard(workspaceId, {
    frontText: ensureNonEmptyCardText(validatedInput.frontText, "frontText"),
    backText: ensureNonEmptyCardText(validatedInput.backText, "backText"),
    tags: validatedInput.tags,
    effortLevel: validatedInput.effortLevel,
  }, makeWriteMetadata(writeToolInput.deviceId)));
}

export async function runUpdateCardTool(
  workspaceId: string,
  cardId: string,
  input: UpdateCardInput,
  writeToolInput: WriteToolInput,
): Promise<string> {
  ensureWriteConfirmed(writeToolInput);
  const validatedInput = validateUpdateInput(input);
  const nextInput: {
    frontText?: string;
    backText?: string;
    tags?: ReadonlyArray<string>;
    effortLevel?: EffortLevel;
  } = {};

  if (validatedInput.frontText !== undefined) {
    nextInput.frontText = ensureNonEmptyCardText(validatedInput.frontText, "frontText");
  }

  if (validatedInput.backText !== undefined) {
    nextInput.backText = ensureNonEmptyCardText(validatedInput.backText, "backText");
  }

  if (validatedInput.tags !== undefined) {
    nextInput.tags = validatedInput.tags;
  }

  if (validatedInput.effortLevel !== undefined) {
    nextInput.effortLevel = validatedInput.effortLevel;
  }

  return stringifyResult(await updateCard(workspaceId, cardId, nextInput, makeWriteMetadata(writeToolInput.deviceId)));
}

export function extractText(content: ReadonlyArray<ContentPart>): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function summarizeContent(content: ReadonlyArray<ContentPart>): string {
  const parts: Array<string> = [];

  for (const part of content) {
    if (part.type === "text") {
      parts.push(part.text);
      continue;
    }

    if (part.type === "image") {
      parts.push("[attached image]");
      continue;
    }

    if (part.type === "file") {
      parts.push(`[attached file: ${part.fileName}]`);
    }
  }

  return parts.join("\n");
}

export function getLatestUserText(messages: ReadonlyArray<ChatMessage>): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (latestUserMessage === undefined) {
    return "";
  }

  return extractText(latestUserMessage.content);
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return value === "fast" || value === "medium" || value === "long";
}
