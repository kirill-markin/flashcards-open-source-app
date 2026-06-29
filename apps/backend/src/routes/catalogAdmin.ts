import { Hono } from "hono";
import { requireAdminRequest, type AdminRequestContext } from "../admin/authz";
import { normalizeCardMetadata } from "../cards/shared";
import {
  attachCatalogPackageDraftMediaAsset,
  createCatalogAuthor,
  createCatalogPackageDraft,
  createCatalogPackageVersionFromCards,
  createCatalogPackageVersionFromWorkspaceSelection,
  delistCatalogPackageVersion,
  loadCatalogPackageDraft,
  publishCatalogPackageVersion,
  updateCatalogAuthor,
  updateCatalogPackageDraft,
  updateCatalogPackageVersionReviewStatus,
} from "../catalog";
import {
  catalogPackageStatuses,
  type AttachCatalogPackageMediaAssetInput,
  type CatalogAuthor,
  type CatalogPackage,
  type CatalogPackageCardSnapshotInput,
  type CatalogPackageDraft,
  type CatalogPackageMediaAsset,
  type CatalogPackageStatus,
  type CatalogPackageVersion,
  type CreateCatalogPackageDraftInput,
  type CreateCatalogPackageVersionFromWorkspaceInput,
  type CreateCatalogPackageVersionInput,
  type UpdateCatalogPackageDraftInput,
  type UpdateCatalogPackageVersionStatusInput,
  type UpsertCatalogAuthorInput,
} from "../catalog/types";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
  parseJsonBodyWithByteLimit,
} from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import type { AppEnv } from "../server/app";

type CatalogAdminRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  requireAdminRequestFn?: (
    request: Request,
    allowedOrigins: ReadonlyArray<string>,
  ) => Promise<AdminRequestContext>;
  createCatalogAuthorFn?: (input: UpsertCatalogAuthorInput) => Promise<CatalogAuthor>;
  updateCatalogAuthorFn?: (input: UpsertCatalogAuthorInput) => Promise<CatalogAuthor>;
  createCatalogPackageDraftFn?: (input: CreateCatalogPackageDraftInput) => Promise<CatalogPackage>;
  updateCatalogPackageDraftFn?: (input: UpdateCatalogPackageDraftInput) => Promise<CatalogPackage>;
  loadCatalogPackageDraftFn?: (packageId: string) => Promise<CatalogPackageDraft>;
  attachCatalogPackageDraftMediaAssetFn?: (
    packageId: string,
    input: AttachCatalogPackageMediaAssetInput,
  ) => Promise<CatalogPackageMediaAsset>;
  createCatalogPackageVersionFromCardsFn?: (
    packageId: string,
    input: CreateCatalogPackageVersionInput,
    adminEmail: string,
  ) => Promise<CatalogPackageVersion>;
  createCatalogPackageVersionFromWorkspaceSelectionFn?: (
    packageId: string,
    input: CreateCatalogPackageVersionFromWorkspaceInput,
    adminUserId: string,
    adminEmail: string,
  ) => Promise<CatalogPackageVersion>;
  updateCatalogPackageVersionReviewStatusFn?: (
    packageVersionId: string,
    input: UpdateCatalogPackageVersionStatusInput,
    adminEmail: string,
  ) => Promise<CatalogPackageVersion>;
  publishCatalogPackageVersionFn?: (
    packageVersionId: string,
    adminEmail: string,
    note: string | null,
  ) => Promise<CatalogPackageVersion>;
  delistCatalogPackageVersionFn?: (
    packageVersionId: string,
    adminEmail: string,
    note: string | null,
  ) => Promise<CatalogPackageVersion>;
}>;

const catalogAdminMaximumBodyBytes = 2_000_000;
const catalogStatusSet: ReadonlySet<string> = new Set(catalogPackageStatuses);

async function parseCatalogAdminJsonBody(request: Request): Promise<Readonly<Record<string, unknown>>> {
  return expectRecord(await parseJsonBodyWithByteLimit(
    request,
    catalogAdminMaximumBodyBytes,
    "Catalog admin request body is too large.",
    "CATALOG_ADMIN_BODY_TOO_LARGE",
  ));
}

function parseUuidParam(value: string | undefined, fieldName: string): string {
  if (value === undefined) {
    throw new HttpError(400, `${fieldName} is required`, "CATALOG_ADMIN_PARAM_REQUIRED");
  }

  try {
    return expectUuidString(value, fieldName);
  } catch {
    throw new HttpError(400, `${fieldName} must be a UUID`, "CATALOG_ADMIN_PARAM_INVALID");
  }
}

function expectNullableNonEmptyString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return expectNonEmptyString(value, fieldName);
}

function expectStringArray(value: unknown, fieldName: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((item, index) => expectNonEmptyString(item, `${fieldName}[${index}]`));
}

function expectPositiveSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || Number.isSafeInteger(value) === false || value < 1) {
    throw new HttpError(400, `${fieldName} must be a positive safe integer`);
  }

  return value;
}

function expectCatalogPackageStatus(value: unknown, fieldName: string): CatalogPackageStatus {
  const status = expectNonEmptyString(value, fieldName);
  if (catalogStatusSet.has(status) === false) {
    throw new HttpError(400, `${fieldName} must be a valid catalog package status`);
  }

  return status as CatalogPackageStatus;
}

function expectCardMetadata(value: unknown): CatalogPackageCardSnapshotInput["metadata"] {
  try {
    return normalizeCardMetadata(value);
  } catch (error) {
    throw new HttpError(
      400,
      `card.metadata must be valid card metadata. reason=${error instanceof Error ? error.message : String(error)}`,
      "CATALOG_CARD_METADATA_INVALID",
    );
  }
}

function parseAuthorCreateInput(record: Readonly<Record<string, unknown>>): UpsertCatalogAuthorInput {
  return {
    authorId: expectUuidString(record.authorId, "authorId"),
    slug: expectNonEmptyString(record.slug, "slug"),
    displayName: expectNonEmptyString(record.displayName, "displayName"),
    bio: expectNullableNonEmptyString(record.bio, "bio"),
    websiteUrl: expectNullableNonEmptyString(record.websiteUrl, "websiteUrl"),
  };
}

function parseAuthorUpdateInput(
  authorId: string,
  record: Readonly<Record<string, unknown>>,
): UpsertCatalogAuthorInput {
  return {
    authorId,
    slug: expectNonEmptyString(record.slug, "slug"),
    displayName: expectNonEmptyString(record.displayName, "displayName"),
    bio: expectNullableNonEmptyString(record.bio, "bio"),
    websiteUrl: expectNullableNonEmptyString(record.websiteUrl, "websiteUrl"),
  };
}

function parsePackageCreateInput(record: Readonly<Record<string, unknown>>): CreateCatalogPackageDraftInput {
  return {
    packageId: expectUuidString(record.packageId, "packageId"),
    authorId: expectUuidString(record.authorId, "authorId"),
    slug: expectNonEmptyString(record.slug, "slug"),
    title: expectNonEmptyString(record.title, "title"),
    summary: expectNonEmptyString(record.summary, "summary"),
    description: expectNonEmptyString(record.description, "description"),
    languageTags: expectStringArray(record.languageTags, "languageTags"),
    topicTags: expectStringArray(record.topicTags, "topicTags"),
    license: expectNonEmptyString(record.license, "license"),
    contentWarning: expectNullableNonEmptyString(record.contentWarning, "contentWarning"),
  };
}

function parsePackageUpdateInput(
  packageId: string,
  record: Readonly<Record<string, unknown>>,
): UpdateCatalogPackageDraftInput {
  return {
    packageId,
    authorId: expectUuidString(record.authorId, "authorId"),
    slug: expectNonEmptyString(record.slug, "slug"),
    title: expectNonEmptyString(record.title, "title"),
    summary: expectNonEmptyString(record.summary, "summary"),
    description: expectNonEmptyString(record.description, "description"),
    languageTags: expectStringArray(record.languageTags, "languageTags"),
    topicTags: expectStringArray(record.topicTags, "topicTags"),
    license: expectNonEmptyString(record.license, "license"),
    contentWarning: expectNullableNonEmptyString(record.contentWarning, "contentWarning"),
    coverPackageMediaKey: expectNullableNonEmptyString(record.coverPackageMediaKey, "coverPackageMediaKey"),
  };
}

function parsePackageMediaAssetInput(
  record: Readonly<Record<string, unknown>>,
): AttachCatalogPackageMediaAssetInput {
  return {
    packageMediaAssetId: expectUuidString(record.packageMediaAssetId, "packageMediaAssetId"),
    packageMediaKey: expectNonEmptyString(record.packageMediaKey, "packageMediaKey"),
    mediaBlobId: expectUuidString(record.mediaBlobId, "mediaBlobId"),
    altText: expectNullableNonEmptyString(record.altText, "altText"),
    credit: expectNullableNonEmptyString(record.credit, "credit"),
    license: expectNullableNonEmptyString(record.license, "license"),
  };
}

function parseCardSnapshotInput(value: unknown, index: number): CatalogPackageCardSnapshotInput {
  const record = expectRecord(value);
  return {
    packageCardId: expectUuidString(record.packageCardId, `cards[${index}].packageCardId`),
    stableCardKey: expectNonEmptyString(record.stableCardKey, `cards[${index}].stableCardKey`),
    ordinal: expectPositiveSafeInteger(record.ordinal, `cards[${index}].ordinal`),
    frontText: expectNonEmptyString(record.frontText, `cards[${index}].frontText`),
    backText: expectNonEmptyString(record.backText, `cards[${index}].backText`),
    cardType: expectNonEmptyString(record.cardType, `cards[${index}].cardType`),
    metadata: expectCardMetadata(record.metadata),
    tags: expectStringArray(record.tags, `cards[${index}].tags`),
    mediaAssetKeys: expectStringArray(record.mediaAssetKeys, `cards[${index}].mediaAssetKeys`),
  };
}

function parseCreatePackageVersionInput(
  record: Readonly<Record<string, unknown>>,
): CreateCatalogPackageVersionInput {
  if (!Array.isArray(record.cards)) {
    throw new HttpError(400, "cards must be an array");
  }

  return {
    packageVersionId: expectUuidString(record.packageVersionId, "packageVersionId"),
    cards: record.cards.map((card, index) => parseCardSnapshotInput(card, index)),
  };
}

function parseCreatePackageVersionFromWorkspaceInput(
  record: Readonly<Record<string, unknown>>,
): CreateCatalogPackageVersionFromWorkspaceInput {
  return {
    packageVersionId: expectUuidString(record.packageVersionId, "packageVersionId"),
    workspaceId: expectUuidString(record.workspaceId, "workspaceId"),
    cardIds: expectStringArray(record.cardIds, "cardIds").map((cardId, index) => (
      expectUuidString(cardId, `cardIds[${index}]`)
    )),
  };
}

function parseReviewStatusInput(
  record: Readonly<Record<string, unknown>>,
): UpdateCatalogPackageVersionStatusInput {
  return {
    status: expectCatalogPackageStatus(record.status, "status"),
    note: expectNullableNonEmptyString(record.note, "note"),
  };
}

function parseNoteInput(record: Readonly<Record<string, unknown>>): string | null {
  return expectNullableNonEmptyString(record.note, "note");
}

export function createCatalogAdminRoutes(options: CatalogAdminRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const requireAdminRequestFn = options.requireAdminRequestFn ?? requireAdminRequest;
  const createCatalogAuthorFn = options.createCatalogAuthorFn ?? createCatalogAuthor;
  const updateCatalogAuthorFn = options.updateCatalogAuthorFn ?? updateCatalogAuthor;
  const createCatalogPackageDraftFn = options.createCatalogPackageDraftFn ?? createCatalogPackageDraft;
  const updateCatalogPackageDraftFn = options.updateCatalogPackageDraftFn ?? updateCatalogPackageDraft;
  const loadCatalogPackageDraftFn = options.loadCatalogPackageDraftFn ?? loadCatalogPackageDraft;
  const attachCatalogPackageDraftMediaAssetFn = options.attachCatalogPackageDraftMediaAssetFn
    ?? attachCatalogPackageDraftMediaAsset;
  const createCatalogPackageVersionFromCardsFn = options.createCatalogPackageVersionFromCardsFn
    ?? createCatalogPackageVersionFromCards;
  const createCatalogPackageVersionFromWorkspaceSelectionFn = options.createCatalogPackageVersionFromWorkspaceSelectionFn
    ?? createCatalogPackageVersionFromWorkspaceSelection;
  const updateCatalogPackageVersionReviewStatusFn = options.updateCatalogPackageVersionReviewStatusFn
    ?? updateCatalogPackageVersionReviewStatus;
  const publishCatalogPackageVersionFn = options.publishCatalogPackageVersionFn ?? publishCatalogPackageVersion;
  const delistCatalogPackageVersionFn = options.delistCatalogPackageVersionFn ?? delistCatalogPackageVersion;

  app.post("/admin/catalog/authors", async (context) => {
    await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const author = await createCatalogAuthorFn(parseAuthorCreateInput(await parseCatalogAdminJsonBody(context.req.raw)));
    return context.json({ author }, 201);
  });

  app.put("/admin/catalog/authors/:authorId", async (context) => {
    await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const authorId = parseUuidParam(context.req.param("authorId"), "authorId");
    const author = await updateCatalogAuthorFn(parseAuthorUpdateInput(
      authorId,
      await parseCatalogAdminJsonBody(context.req.raw),
    ));
    return context.json({ author });
  });

  app.post("/admin/catalog/packages", async (context) => {
    await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const catalogPackage = await createCatalogPackageDraftFn(parsePackageCreateInput(
      await parseCatalogAdminJsonBody(context.req.raw),
    ));
    return context.json({ catalogPackage }, 201);
  });

  app.get("/admin/catalog/packages/:packageId", async (context) => {
    await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageId = parseUuidParam(context.req.param("packageId"), "packageId");
    const draft = await loadCatalogPackageDraftFn(packageId);
    return context.json({ draft });
  });

  app.put("/admin/catalog/packages/:packageId/draft", async (context) => {
    await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageId = parseUuidParam(context.req.param("packageId"), "packageId");
    const catalogPackage = await updateCatalogPackageDraftFn(parsePackageUpdateInput(
      packageId,
      await parseCatalogAdminJsonBody(context.req.raw),
    ));
    return context.json({ catalogPackage });
  });

  app.post("/admin/catalog/packages/:packageId/media-assets", async (context) => {
    await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageId = parseUuidParam(context.req.param("packageId"), "packageId");
    const mediaAsset = await attachCatalogPackageDraftMediaAssetFn(
      packageId,
      parsePackageMediaAssetInput(await parseCatalogAdminJsonBody(context.req.raw)),
    );
    return context.json({ mediaAsset }, 201);
  });

  app.post("/admin/catalog/packages/:packageId/versions", async (context) => {
    const adminContext = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageId = parseUuidParam(context.req.param("packageId"), "packageId");
    const packageVersion = await createCatalogPackageVersionFromCardsFn(
      packageId,
      parseCreatePackageVersionInput(await parseCatalogAdminJsonBody(context.req.raw)),
      adminContext.email,
    );
    return context.json({ packageVersion }, 201);
  });

  app.post("/admin/catalog/packages/:packageId/versions/from-workspace", async (context) => {
    const adminContext = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageId = parseUuidParam(context.req.param("packageId"), "packageId");
    const packageVersion = await createCatalogPackageVersionFromWorkspaceSelectionFn(
      packageId,
      parseCreatePackageVersionFromWorkspaceInput(await parseCatalogAdminJsonBody(context.req.raw)),
      adminContext.userId,
      adminContext.email,
    );
    return context.json({ packageVersion }, 201);
  });

  app.post("/admin/catalog/package-versions/:packageVersionId/review-status", async (context) => {
    const adminContext = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageVersionId = parseUuidParam(context.req.param("packageVersionId"), "packageVersionId");
    const packageVersion = await updateCatalogPackageVersionReviewStatusFn(
      packageVersionId,
      parseReviewStatusInput(await parseCatalogAdminJsonBody(context.req.raw)),
      adminContext.email,
    );
    return context.json({ packageVersion });
  });

  app.post("/admin/catalog/package-versions/:packageVersionId/publish", async (context) => {
    const adminContext = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageVersionId = parseUuidParam(context.req.param("packageVersionId"), "packageVersionId");
    const packageVersion = await publishCatalogPackageVersionFn(
      packageVersionId,
      adminContext.email,
      parseNoteInput(await parseCatalogAdminJsonBody(context.req.raw)),
    );
    return context.json({ packageVersion });
  });

  app.post("/admin/catalog/package-versions/:packageVersionId/delist", async (context) => {
    const adminContext = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const packageVersionId = parseUuidParam(context.req.param("packageVersionId"), "packageVersionId");
    const packageVersion = await delistCatalogPackageVersionFn(
      packageVersionId,
      adminContext.email,
      parseNoteInput(await parseCatalogAdminJsonBody(context.req.raw)),
    );
    return context.json({ packageVersion });
  });

  return app;
}
