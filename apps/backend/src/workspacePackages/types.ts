import { z } from "zod";

export const workspacePackageFormatVersion = 1 as const;

export type WorkspacePackageMetadataV1 = Readonly<{
  label?: string;
  author?: string;
  comment?: string;
  createdAt?: string;
  sourceUrl?: string;
}>;

export type WorkspacePackageCardSourceMetadataV1 = Readonly<{
  label: string | null;
  author: string | null;
  comment: string | null;
  createdAt: string | null;
  importedAt: string | null;
  importId: string | null;
}>;

export type WorkspacePackageCardSourceMetadataInputV1 = Readonly<{
  label?: string | null;
  author?: string | null;
  comment?: string | null;
  createdAt?: string | null;
  importedAt?: string | null;
  importId?: string | null;
}>;

export type WorkspacePackageCardMetadataV1 = Readonly<{
  version: 1;
  source: WorkspacePackageCardSourceMetadataV1 | null;
}>;

export type WorkspacePackageCardMetadataInputV1 = Readonly<{
  version: 1;
  source: WorkspacePackageCardSourceMetadataInputV1 | null;
}>;

export type PortableWorkspacePackageCardV1 = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  cardType: string;
  metadata: WorkspacePackageCardMetadataV1;
}>;

export type PortableWorkspacePackageCardInputV1 = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  cardType: string;
  metadata: WorkspacePackageCardMetadataInputV1;
}>;

export type WorkspacePackageCardsJsonV1 = WorkspacePackageMetadataV1 & Readonly<{
  formatVersion: 1;
  cards: ReadonlyArray<PortableWorkspacePackageCardV1>;
}>;

export type WorkspacePackageValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

const optionalPackageMetadataSchema = {
  label: z.string().optional(),
  author: z.string().optional(),
  comment: z.string().optional(),
  createdAt: z.string().optional(),
  sourceUrl: z.string().optional(),
} as const;

const optionalNullableStringSchema = z.string().nullable().optional();
const requiredTrimmedStringSchema = z.string().trim().min(1);

function normalizeCardSourceMetadata(
  sourceMetadata: WorkspacePackageCardSourceMetadataInputV1,
): WorkspacePackageCardSourceMetadataV1 {
  return {
    label: sourceMetadata.label ?? null,
    author: sourceMetadata.author ?? null,
    comment: sourceMetadata.comment ?? null,
    createdAt: sourceMetadata.createdAt ?? null,
    importedAt: sourceMetadata.importedAt ?? null,
    importId: sourceMetadata.importId ?? null,
  };
}

const cardSourceMetadataSchema = z.object({
  label: optionalNullableStringSchema,
  author: optionalNullableStringSchema,
  comment: optionalNullableStringSchema,
  createdAt: optionalNullableStringSchema,
  importedAt: optionalNullableStringSchema,
  importId: optionalNullableStringSchema,
}).transform((sourceMetadata): WorkspacePackageCardSourceMetadataV1 => (
  normalizeCardSourceMetadata(sourceMetadata)
));

const cardMetadataSchema = z.object({
  version: z.literal(workspacePackageFormatVersion),
  source: z.union([cardSourceMetadataSchema, z.null()]),
}).transform((metadata): WorkspacePackageCardMetadataV1 => ({
  version: workspacePackageFormatVersion,
  source: metadata.source,
}));

function normalizeRequiredWorkspacePackageText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new TypeError(`${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeWorkspacePackageCardType(cardType: string): string {
  const normalizedCardType = cardType.trim();
  return normalizedCardType === "" ? "basic" : normalizedCardType;
}

function normalizeWorkspacePackageTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  return tags.map((tag) => normalizeRequiredWorkspacePackageText(tag, "tags[]"));
}

const portableCardSchema = z.object({
  frontText: requiredTrimmedStringSchema,
  backText: z.string().transform((backText): string => backText.trim()),
  tags: z.array(requiredTrimmedStringSchema),
  cardType: z.string().transform((cardType): string => normalizeWorkspacePackageCardType(cardType)),
  metadata: cardMetadataSchema,
}).transform((card): PortableWorkspacePackageCardV1 => (
  toPortableWorkspacePackageCard(card)
));

export const workspacePackageCardsJsonV1Schema = z.object({
  formatVersion: z.literal(workspacePackageFormatVersion),
  ...optionalPackageMetadataSchema,
  cards: z.array(portableCardSchema),
}).transform((cardsJson): WorkspacePackageCardsJsonV1 => ({
  ...cardsJson,
  formatVersion: workspacePackageFormatVersion,
  cards: cardsJson.cards,
}));

function summarizeValidationPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path.join(".");
}

function summarizeValidationIssue(issue: z.core.$ZodIssue): WorkspacePackageValidationIssue {
  return {
    path: summarizeValidationPath(issue.path),
    code: issue.code,
    message: issue.message,
  };
}

function summarizeValidationIssues(error: z.ZodError): ReadonlyArray<WorkspacePackageValidationIssue> {
  return error.issues.map(summarizeValidationIssue);
}

export function parseWorkspacePackageCardsJsonV1(value: unknown): WorkspacePackageCardsJsonV1 {
  const parsedCardsJson = workspacePackageCardsJsonV1Schema.safeParse(value);
  if (parsedCardsJson.success) {
    return parsedCardsJson.data;
  }

  const issues = summarizeValidationIssues(parsedCardsJson.error);
  throw new TypeError(`Invalid workspace package cards.json: ${JSON.stringify(issues)}`);
}

export function normalizeWorkspacePackageCardMetadataV1(
  metadata: WorkspacePackageCardMetadataInputV1,
): WorkspacePackageCardMetadataV1 {
  return {
    version: workspacePackageFormatVersion,
    source: metadata.source === null ? null : normalizeCardSourceMetadata(metadata.source),
  };
}

export function toPortableWorkspacePackageCard(
  card: PortableWorkspacePackageCardInputV1,
): PortableWorkspacePackageCardV1 {
  return {
    frontText: normalizeRequiredWorkspacePackageText(card.frontText, "frontText"),
    backText: card.backText.trim(),
    tags: normalizeWorkspacePackageTags(card.tags),
    cardType: normalizeWorkspacePackageCardType(card.cardType),
    metadata: normalizeWorkspacePackageCardMetadataV1(card.metadata),
  };
}
