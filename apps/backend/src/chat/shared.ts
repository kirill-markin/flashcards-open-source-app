import { randomUUID } from "node:crypto";
import * as cards from "../cards";
import * as decks from "../decks";
import type {
  BulkCreateCardItem,
  BulkDeleteCardItem,
  BulkUpdateCardItem,
  CreateCardInput,
  EffortLevel,
  UpdateCardInput,
} from "../cards";
import type {
  BulkCreateDeckItem,
  BulkDeleteDeckItem,
  BulkUpdateDeckItem,
  CreateDeckInput,
  DeckFilterDefinition,
  UpdateDeckInput,
} from "../decks";
import {
  buildAssistantRoleSection,
  buildCloudCapabilitiesSection,
  buildCloudWorkspaceSection,
  buildCloudWritePolicyLines,
  buildConciseStyleSection,
  buildDatetimeSection,
  buildPromptFromSections,
  buildWritePolicySection,
} from "./promptSections";
import type { ChatMessage, ContentPart } from "./types";

const MAX_LIST_LIMIT = 100;

export const cardsApi = {
  createCard: cards.createCard,
  createCards: cards.createCards,
  deleteCards: cards.deleteCards,
  getCards: cards.getCards,
  listCards: cards.listCards,
  listReviewHistory: cards.listReviewHistory,
  listReviewQueue: cards.listReviewQueue,
  searchCards: cards.searchCards,
  summarizeDeckState: cards.summarizeDeckState,
  updateCard: cards.updateCard,
  updateCards: cards.updateCards,
} as const;

export const decksApi = {
  createDeck: decks.createDeck,
  createDecks: decks.createDecks,
  deleteDeck: decks.deleteDeck,
  deleteDecks: decks.deleteDecks,
  getDeck: decks.getDeck,
  getDecks: decks.getDecks,
  listDecks: decks.listDecks,
  searchDecks: decks.searchDecks,
  updateDeck: decks.updateDeck,
  updateDecks: decks.updateDecks,
} as const;

export type AgentContext = Readonly<{
  workspaceId: string;
  deviceId: string;
}>;

type WriteToolInput = Readonly<{
  deviceId: string;
}>;

export function buildSystemInstructions(timezone: string): string {
  return buildPromptFromSections([
    buildAssistantRoleSection(),
    buildCloudWorkspaceSection(),
    buildWritePolicySection(buildCloudWritePolicyLines()),
    buildCloudCapabilitiesSection(),
    buildConciseStyleSection(),
    buildDatetimeSection(timezone),
  ]);
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

function validateCardBatchCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_LIST_LIMIT) {
    throw new Error(`Card batch must contain between 1 and ${MAX_LIST_LIMIT} items`);
  }
}

function validateDeckBatchCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_LIST_LIMIT) {
    throw new Error(`Deck batch must contain between 1 and ${MAX_LIST_LIMIT} items`);
  }
}

function validateUniqueCardIds(cardIds: ReadonlyArray<string>): void {
  const uniqueCardIds = new Set(cardIds);
  if (uniqueCardIds.size !== cardIds.length) {
    throw new Error("Card batch must not contain duplicate cardId values");
  }
}

function validateUniqueDeckIds(deckIds: ReadonlyArray<string>): void {
  const uniqueDeckIds = new Set(deckIds);
  if (uniqueDeckIds.size !== deckIds.length) {
    throw new Error("Deck batch must not contain duplicate deckId values");
  }
}

function makeWriteMetadataList(deviceId: string, count: number): ReadonlyArray<Readonly<{
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
}>> {
  validateCardBatchCount(count);
  const clientUpdatedAt = new Date().toISOString();

  return Array.from({ length: count }, () => ({
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: randomUUID(),
  }));
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

function normalizeDeckName(name: string): string {
  const normalizedName = name.trim();
  if (normalizedName === "") {
    throw new Error("name must not be empty");
  }

  return normalizedName;
}

function normalizeEffortLevels(effortLevels: ReadonlyArray<EffortLevel>): ReadonlyArray<EffortLevel> {
  return [...new Set(effortLevels)];
}

function normalizeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): DeckFilterDefinition {
  return {
    version: 2,
    effortLevels: normalizeEffortLevels(filterDefinition.effortLevels),
    tags: normalizeTags(filterDefinition.tags),
  };
}

function validateCreateDeckInput(input: CreateDeckInput): CreateDeckInput {
  return {
    name: normalizeDeckName(input.name),
    filterDefinition: normalizeDeckFilterDefinition(input.filterDefinition),
  };
}

function validateUpdateDeckInput(input: UpdateDeckInput): UpdateDeckInput {
  return {
    name: normalizeDeckName(input.name),
    filterDefinition: normalizeDeckFilterDefinition(input.filterDefinition),
  };
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

function normalizeCardBackText(value: string): string {
  return value.trim();
}

export async function runListCardsTool(workspaceId: string, limit: number | undefined): Promise<string> {
  const items = await cardsApi.listCards(workspaceId);
  return stringifyResult(items.slice(0, normalizeLimit(limit)));
}

export async function runGetCardsTool(
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
): Promise<string> {
  validateCardBatchCount(cardIds.length);
  validateUniqueCardIds(cardIds);
  return stringifyResult(await cardsApi.getCards(workspaceId, cardIds));
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

  return stringifyResult(await cardsApi.searchCards(workspaceId, queryText, normalizeLimit(limit)));
}

export async function runListDueCardsTool(workspaceId: string, limit: number | undefined): Promise<string> {
  return stringifyResult(await cardsApi.listReviewQueue(workspaceId, normalizeLimit(limit)));
}

export async function runListDecksTool(workspaceId: string): Promise<string> {
  return stringifyResult(await decksApi.listDecks(workspaceId));
}

export async function runSearchDecksTool(
  workspaceId: string,
  searchText: string,
  limit: number | undefined,
): Promise<string> {
  const queryText = searchText.trim();
  if (queryText === "") {
    throw new Error("query must not be empty");
  }

  return stringifyResult(await decksApi.searchDecks(workspaceId, queryText, normalizeLimit(limit)));
}

export async function runGetDecksTool(
  workspaceId: string,
  deckIds: ReadonlyArray<string>,
): Promise<string> {
  validateDeckBatchCount(deckIds.length);
  validateUniqueDeckIds(deckIds);
  return stringifyResult(await decksApi.getDecks(workspaceId, deckIds));
}

export async function runListReviewHistoryTool(
  workspaceId: string,
  limit: number | undefined,
  cardId?: string,
): Promise<string> {
  return stringifyResult(await cardsApi.listReviewHistory(workspaceId, normalizeLimit(limit), cardId));
}

export async function runSummarizeDeckStateTool(workspaceId: string): Promise<string> {
  return stringifyResult(await cardsApi.summarizeDeckState(workspaceId));
}

export async function runCreateCardsTool(
  workspaceId: string,
  inputs: ReadonlyArray<CreateCardInput>,
  writeToolInput: WriteToolInput,
): Promise<string> {
  validateCardBatchCount(inputs.length);

  const validatedInputs = inputs.map((input) => {
    const validatedInput = validateCreateInput(input);

    return {
      frontText: ensureNonEmptyCardText(validatedInput.frontText, "frontText"),
      backText: normalizeCardBackText(validatedInput.backText),
      tags: validatedInput.tags,
      effortLevel: validatedInput.effortLevel,
    };
  });
  const metadataList = makeWriteMetadataList(writeToolInput.deviceId, validatedInputs.length);
  const items: Array<BulkCreateCardItem> = validatedInputs.map((input, index) => ({
    input,
    metadata: metadataList[index]!,
  }));

  return stringifyResult(await cardsApi.createCards(workspaceId, items));
}

export async function runCreateDecksTool(
  workspaceId: string,
  inputs: ReadonlyArray<Readonly<{
    name: string;
    effortLevels: ReadonlyArray<EffortLevel>;
    tags: ReadonlyArray<string>;
  }>>,
  writeToolInput: WriteToolInput,
): Promise<string> {
  validateDeckBatchCount(inputs.length);

  const validatedInputs = inputs.map((input) => validateCreateDeckInput({
    name: input.name,
    filterDefinition: {
      version: 2,
      effortLevels: input.effortLevels,
      tags: input.tags,
    },
  }));
  const metadataList = makeWriteMetadataList(writeToolInput.deviceId, validatedInputs.length);
  const items: Array<BulkCreateDeckItem> = validatedInputs.map((input, index) => ({
    input,
    metadata: metadataList[index]!,
  }));

  return stringifyResult(await decksApi.createDecks(workspaceId, items));
}

export async function runUpdateCardsTool(
  workspaceId: string,
  updates: ReadonlyArray<Readonly<{
    cardId: string;
    frontText?: string;
    backText?: string;
    tags?: ReadonlyArray<string>;
    effortLevel?: EffortLevel;
  }>>,
  writeToolInput: WriteToolInput,
): Promise<string> {
  validateCardBatchCount(updates.length);
  validateUniqueCardIds(updates.map((update) => update.cardId));

  const validatedUpdates = updates.map((update) => {
    const validatedInput = validateUpdateInput({
      frontText: update.frontText,
      backText: update.backText,
      tags: update.tags,
      effortLevel: update.effortLevel,
    });
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
      nextInput.backText = normalizeCardBackText(validatedInput.backText);
    }

    if (validatedInput.tags !== undefined) {
      nextInput.tags = validatedInput.tags;
    }

    if (validatedInput.effortLevel !== undefined) {
      nextInput.effortLevel = validatedInput.effortLevel;
    }

    return {
      cardId: update.cardId,
      input: nextInput,
    };
  });
  const metadataList = makeWriteMetadataList(writeToolInput.deviceId, validatedUpdates.length);
  const items: Array<BulkUpdateCardItem> = validatedUpdates.map((update, index) => ({
    cardId: update.cardId,
    input: update.input,
    metadata: metadataList[index]!,
  }));

  return stringifyResult(await cardsApi.updateCards(workspaceId, items));
}

export async function runUpdateDecksTool(
  workspaceId: string,
  updates: ReadonlyArray<Readonly<{
    deckId: string;
    name?: string;
    effortLevels?: ReadonlyArray<EffortLevel>;
    tags?: ReadonlyArray<string>;
  }>>,
  writeToolInput: WriteToolInput,
): Promise<string> {
  validateDeckBatchCount(updates.length);
  validateUniqueDeckIds(updates.map((update) => update.deckId));

  const existingDecks = await decksApi.getDecks(workspaceId, updates.map((update) => update.deckId));
  const existingDecksById = new Map(existingDecks.map((deck) => [deck.deckId, deck] as const));
  const validatedUpdates = updates.map((update) => {
    const existingDeck = existingDecksById.get(update.deckId);
    if (existingDeck === undefined) {
      throw new Error(`Deck not found: ${update.deckId}`);
    }

    return {
      deckId: update.deckId,
      input: validateUpdateDeckInput({
        name: update.name ?? existingDeck.name,
        filterDefinition: {
          version: 2,
          effortLevels: update.effortLevels ?? existingDeck.filterDefinition.effortLevels,
          tags: update.tags ?? existingDeck.filterDefinition.tags,
        },
      }),
    };
  });
  const metadataList = makeWriteMetadataList(writeToolInput.deviceId, validatedUpdates.length);
  const items: Array<BulkUpdateDeckItem> = validatedUpdates.map((update, index) => ({
    deckId: update.deckId,
    input: update.input,
    metadata: metadataList[index]!,
  }));

  return stringifyResult(await decksApi.updateDecks(workspaceId, items));
}

export async function runDeleteCardsTool(
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
  writeToolInput: WriteToolInput,
): Promise<string> {
  validateCardBatchCount(cardIds.length);
  validateUniqueCardIds(cardIds);

  const metadataList = makeWriteMetadataList(writeToolInput.deviceId, cardIds.length);
  const items: Array<BulkDeleteCardItem> = cardIds.map((cardId, index) => ({
    cardId,
    metadata: metadataList[index]!,
  }));

  return stringifyResult(await cardsApi.deleteCards(workspaceId, items));
}

export async function runDeleteDecksTool(
  workspaceId: string,
  deckIds: ReadonlyArray<string>,
  writeToolInput: WriteToolInput,
): Promise<string> {
  validateDeckBatchCount(deckIds.length);
  validateUniqueDeckIds(deckIds);

  const metadataList = makeWriteMetadataList(writeToolInput.deviceId, deckIds.length);
  const items: Array<BulkDeleteDeckItem> = deckIds.map((deckId, index) => ({
    deckId,
    metadata: metadataList[index]!,
  }));

  return stringifyResult(await decksApi.deleteDecks(workspaceId, items));
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
