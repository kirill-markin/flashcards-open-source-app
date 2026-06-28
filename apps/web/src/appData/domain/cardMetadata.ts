import type { CardMetadata, CardSourceMetadata } from "../../types";

type CardMetadataRecord = Readonly<Record<string, unknown>>;

function expectCardMetadataRecord(value: unknown, context: string): CardMetadataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }

  return value as CardMetadataRecord;
}

function expectNullableCardMetadataString(value: unknown, fieldName: string): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }

  throw new Error(`${fieldName} must be a string or null`);
}

function normalizeCardSourceMetadata(value: unknown): CardSourceMetadata | null {
  if (value === null) {
    return null;
  }

  const record = expectCardMetadataRecord(value, "metadata.source");
  return {
    label: expectNullableCardMetadataString(record.label, "metadata.source.label"),
    author: expectNullableCardMetadataString(record.author, "metadata.source.author"),
    comment: expectNullableCardMetadataString(record.comment, "metadata.source.comment"),
    createdAt: expectNullableCardMetadataString(record.createdAt, "metadata.source.createdAt"),
    importedAt: expectNullableCardMetadataString(record.importedAt, "metadata.source.importedAt"),
    importId: expectNullableCardMetadataString(record.importId, "metadata.source.importId"),
  };
}

export function normalizeCardType(value: unknown): string {
  if (value === undefined) {
    return "basic";
  }

  if (typeof value !== "string") {
    throw new Error("cardType must be a string when present");
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? "basic" : trimmedValue;
}

export function makeDefaultCardSourceMetadata(createdAt: string): CardSourceMetadata {
  return {
    label: null,
    author: null,
    comment: null,
    createdAt,
    importedAt: null,
    importId: null,
  };
}

export function makeDefaultCardMetadata(createdAt: string): CardMetadata {
  return {
    version: 1,
    source: makeDefaultCardSourceMetadata(createdAt),
  };
}

export function normalizeCardMetadata(value: unknown, createdAt: string): CardMetadata {
  if (value === undefined) {
    return makeDefaultCardMetadata(createdAt);
  }

  const record = expectCardMetadataRecord(value, "metadata");
  if (record.version !== 1) {
    throw new Error("metadata.version must be 1");
  }

  return {
    version: 1,
    source: normalizeCardSourceMetadata(record.source),
  };
}

export function resolveCardRendererType(cardType: string): "basic" {
  void cardType;
  return "basic";
}
