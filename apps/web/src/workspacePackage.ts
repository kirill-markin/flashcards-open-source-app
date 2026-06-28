import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  normalizeCardMetadata,
  normalizeCardType,
  normalizeTagKey,
} from "./appData/domain";
import type { Card, CardMetadata, CardSourceMetadata } from "./types";

const packageCardsJsonFilename = "cards.json";
const unsupportedAssetReferencePrefix = "fcasset:";

type JsonRecord = Readonly<Record<string, unknown>>;

export type FlashcardsPackageCardV1 = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  cardType: string;
  metadata: CardMetadata;
}>;

export type FlashcardsPackageV1 = Readonly<{
  formatVersion: 1;
  cards: ReadonlyArray<FlashcardsPackageCardV1>;
}>;

export type PreparedFlashcardsPackageImport = Readonly<{
  cards: ReadonlyArray<FlashcardsPackageCardV1>;
  importTag: string | null;
}>;

export type PrepareFlashcardsPackageImportWithTagParams = Readonly<{
  packageData: FlashcardsPackageV1;
  existingTags: ReadonlyArray<string>;
  now: Date;
  importId: string;
  importedAt: string;
}>;

export type PrepareFlashcardsPackageImportWithoutTagParams = Readonly<{
  packageData: FlashcardsPackageV1;
  importId: string;
  importedAt: string;
}>;

export class FlashcardsPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlashcardsPackageError";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireJsonRecord(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FlashcardsPackageError(`${path} must be a JSON object`);
  }

  return value as JsonRecord;
}

function requireStringField(record: JsonRecord, fieldName: string, path: string): string {
  const value = record[fieldName];
  if (typeof value !== "string") {
    throw new FlashcardsPackageError(`${path}.${fieldName} must be a string`);
  }

  return value;
}

function requirePackageTags(value: unknown, path: string): ReadonlyArray<string> {
  if (Array.isArray(value) === false) {
    throw new FlashcardsPackageError(`${path} must be an array`);
  }

  return value.map((tagValue, index) => {
    if (typeof tagValue !== "string") {
      throw new FlashcardsPackageError(`${path}[${index}] must be a string`);
    }

    const tag = tagValue.trim();
    if (tag === "") {
      throw new FlashcardsPackageError(`${path}[${index}] must not be empty`);
    }

    return tag;
  });
}

function requirePackageMetadata(value: unknown, path: string): CardMetadata {
  if (value === undefined) {
    throw new FlashcardsPackageError(`${path} is required`);
  }

  try {
    return normalizeCardMetadata(value, "");
  } catch (error) {
    throw new FlashcardsPackageError(`${path} is invalid: ${getErrorMessage(error)}`);
  }
}

function validateNoUnsupportedAssetReferences(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (value.includes(unsupportedAssetReferencePrefix)) {
      throw new FlashcardsPackageError(
        `Media files are not supported yet: ${path} contains an fcasset: reference`,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoUnsupportedAssetReferences(item, `${path}[${index}]`));
    return;
  }

  if (typeof value === "object" && value !== null) {
    Object.entries(value as JsonRecord).forEach(([key, item]) => {
      validateNoUnsupportedAssetReferences(item, `${path}.${key}`);
    });
  }
}

function validateFlashcardsPackageCard(value: unknown, index: number): FlashcardsPackageCardV1 {
  const path = `$.cards[${index}]`;
  const record = requireJsonRecord(value, path);
  const frontText = requireStringField(record, "frontText", path);
  if (frontText.trim() === "") {
    throw new FlashcardsPackageError(`${path}.frontText must not be empty`);
  }

  return {
    frontText,
    backText: requireStringField(record, "backText", path),
    tags: requirePackageTags(record.tags, `${path}.tags`),
    cardType: normalizeCardType(requireStringField(record, "cardType", path)),
    metadata: requirePackageMetadata(record.metadata, `${path}.metadata`),
  };
}

export function validateFlashcardsPackage(value: unknown): FlashcardsPackageV1 {
  validateNoUnsupportedAssetReferences(value, "$");

  const record = requireJsonRecord(value, "$");
  if (record.formatVersion !== 1) {
    throw new FlashcardsPackageError("$.formatVersion must be 1");
  }

  if (Array.isArray(record.cards) === false) {
    throw new FlashcardsPackageError("$.cards must be an array");
  }

  return {
    formatVersion: 1,
    cards: record.cards.map(validateFlashcardsPackageCard),
  };
}

export function createFlashcardsPackage(
  cards: ReadonlyArray<Pick<Card, "frontText" | "backText" | "tags" | "cardType" | "metadata">>,
): FlashcardsPackageV1 {
  return {
    formatVersion: 1,
    cards: cards.map((card) => ({
      frontText: card.frontText,
      backText: card.backText,
      tags: card.tags,
      cardType: card.cardType,
      metadata: card.metadata,
    })),
  };
}

export function serializeFlashcardsPackage(packageData: FlashcardsPackageV1): string {
  return `${JSON.stringify(packageData, null, 2)}\n`;
}

export function writeFlashcardsPackageZip(packageData: FlashcardsPackageV1): Uint8Array<ArrayBuffer> {
  return zipSync({
    [packageCardsJsonFilename]: strToU8(serializeFlashcardsPackage(packageData)),
  }, { level: 6 });
}

function readCardsJsonBytesFromZip(zipBytes: Uint8Array): Uint8Array {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch (error) {
    throw new FlashcardsPackageError(`Could not read flashcards.zip: ${getErrorMessage(error)}`);
  }

  const filenames = Object.keys(entries);
  if (filenames.length !== 1 || filenames[0] !== packageCardsJsonFilename) {
    throw new FlashcardsPackageError(
      "Unsupported flashcards package. This version only supports flashcards.zip files containing exactly cards.json.",
    );
  }

  const cardsJsonBytes = entries[packageCardsJsonFilename];
  if (cardsJsonBytes === undefined) {
    throw new FlashcardsPackageError("flashcards.zip is missing cards.json");
  }

  return cardsJsonBytes;
}

export function readFlashcardsPackageZip(zipBytes: Uint8Array): FlashcardsPackageV1 {
  const cardsJsonBytes = readCardsJsonBytesFromZip(zipBytes);
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(strFromU8(cardsJsonBytes));
  } catch (error) {
    throw new FlashcardsPackageError(`cards.json is not valid JSON: ${getErrorMessage(error)}`);
  }

  return validateFlashcardsPackage(parsedValue);
}

function formatImportTagDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function generateNextFlashcardsPackageImportTag(existingTags: ReadonlyArray<string>, now: Date): string {
  const date = formatImportTagDate(now);
  const tagPrefix = `import:${date}-`;
  const normalizedTagPrefix = normalizeTagKey(tagPrefix);
  let highestSuffix = -1;

  for (const tag of existingTags) {
    const normalizedTag = normalizeTagKey(tag);
    if (normalizedTag.startsWith(normalizedTagPrefix) === false) {
      continue;
    }

    const suffixText = normalizedTag.slice(normalizedTagPrefix.length);
    if (/^\d+$/.test(suffixText) === false) {
      continue;
    }

    highestSuffix = Math.max(highestSuffix, Number(suffixText));
  }

  return `${tagPrefix}${highestSuffix + 1}`;
}

function buildImportedSourceMetadata(
  source: CardSourceMetadata | null,
  importId: string,
  importedAt: string,
): CardSourceMetadata {
  return {
    label: source?.label ?? null,
    author: source?.author ?? null,
    comment: source?.comment ?? null,
    createdAt: source?.createdAt ?? null,
    importedAt,
    importId,
  };
}

function buildImportedMetadata(metadata: CardMetadata, importId: string, importedAt: string): CardMetadata {
  return {
    version: 1,
    source: buildImportedSourceMetadata(metadata.source, importId, importedAt),
  };
}

function appendImportTag(tags: ReadonlyArray<string>, importTag: string): ReadonlyArray<string> {
  const importTagKey = normalizeTagKey(importTag);
  if (tags.some((tag) => normalizeTagKey(tag) === importTagKey)) {
    return tags;
  }

  return [...tags, importTag];
}

function prepareImportedCard(
  card: FlashcardsPackageCardV1,
  importId: string,
  importedAt: string,
  tags: ReadonlyArray<string>,
): FlashcardsPackageCardV1 {
  return {
    ...card,
    tags,
    metadata: buildImportedMetadata(card.metadata, importId, importedAt),
  };
}

export function prepareFlashcardsPackageImportWithTag(
  params: PrepareFlashcardsPackageImportWithTagParams,
): PreparedFlashcardsPackageImport {
  const importTag = generateNextFlashcardsPackageImportTag(params.existingTags, params.now);

  return {
    importTag,
    cards: params.packageData.cards.map((card) => prepareImportedCard(
      card,
      params.importId,
      params.importedAt,
      appendImportTag(card.tags, importTag),
    )),
  };
}

export function prepareFlashcardsPackageImportWithoutTag(
  params: PrepareFlashcardsPackageImportWithoutTagParams,
): PreparedFlashcardsPackageImport {
  return {
    importTag: null,
    cards: params.packageData.cards.map((card) => prepareImportedCard(
      card,
      params.importId,
      params.importedAt,
      card.tags,
    )),
  };
}
