import type { DatabaseExecutor } from "../../database";
import { unsafeTransaction } from "../../database/core";
import { HttpError } from "../../shared/errors";
import {
  normalizeNonEmptyString,
  normalizeNullableString,
  normalizePackageMediaKey,
  normalizeSlug,
  normalizeTextArray,
} from "../common";
import { assertDraftMediaKeysExistInExecutor } from "./media/draftMedia";
import { rethrowCatalogPersistenceError } from "../errors";
import {
  getPublicCatalogAuthorEligibilityIssue,
  getPublicCatalogPackageEligibilityIssue,
} from "../publicSafety";
import {
  catalogPackageColumns,
  catalogPackageMediaAssetColumns,
  mapCatalogPackageMediaAssetRow,
  mapCatalogPackageRow,
  lockCatalogPackageInExecutor,
} from "../rows";
import type {
  CatalogPackage,
  CatalogPackageDraft,
  CatalogPackageMediaAssetRow,
  CatalogPackageRow,
  CreateCatalogPackageDraftInput,
  UpdateCatalogPackageDraftInput,
} from "../types";

type CatalogPackageSelectedAuthorRow = Readonly<{
  slug: string;
  display_name: string;
  bio: string | null;
  website_url: string | null;
}>;

async function assertCatalogPackageSelectedAuthorPubliclyEligibleInExecutor(
  executor: DatabaseExecutor,
  authorId: string,
): Promise<void> {
  const result = await executor.query<CatalogPackageSelectedAuthorRow>(
    [
      "SELECT slug, display_name, bio, website_url",
      "FROM catalog.authors",
      "WHERE author_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [authorId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Catalog author not found. authorId=${authorId}`,
      "CATALOG_AUTHOR_NOT_FOUND",
    );
  }

  const issue = getPublicCatalogAuthorEligibilityIssue({
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    websiteUrl: row.website_url,
  });
  if (issue !== null) {
    const field = issue.reason === "invalid_author_website_url" ? "websiteUrl" : issue.field;
    throw new HttpError(
      409,
      `Selected catalog author is not eligible for public presentation. authorId=${authorId} field=${field}`,
      "CATALOG_PACKAGE_AUTHOR_NOT_PUBLICLY_ELIGIBLE",
    );
  }
}

function normalizeCreateCatalogPackageDraftInput(
  input: CreateCatalogPackageDraftInput,
): CreateCatalogPackageDraftInput {
  const normalizedInput = {
    packageId: input.packageId,
    authorId: input.authorId,
    slug: normalizeSlug(input.slug, "slug"),
    title: normalizeNonEmptyString(input.title, "title"),
    summary: normalizeNonEmptyString(input.summary, "summary"),
    description: normalizeNonEmptyString(input.description, "description"),
    languageTags: normalizeTextArray(input.languageTags, "languageTags", true),
    license: normalizeNonEmptyString(input.license, "license"),
    contentWarning: normalizeNullableString(input.contentWarning, "contentWarning"),
  };
  const publicEligibilityIssue = getPublicCatalogPackageEligibilityIssue({
    slug: normalizedInput.slug,
  });
  if (publicEligibilityIssue !== null) {
    throw new HttpError(
      400,
      `Catalog package is not eligible for public presentation. field=${publicEligibilityIssue.field} reason=contains a private or managed-storage media reference`,
      "CATALOG_PACKAGE_NOT_PUBLICLY_ELIGIBLE",
    );
  }

  return normalizedInput;
}

function normalizeUpdateCatalogPackageDraftInput(
  input: UpdateCatalogPackageDraftInput,
): UpdateCatalogPackageDraftInput {
  return {
    ...normalizeCreateCatalogPackageDraftInput(input),
    coverPackageMediaKey: input.coverPackageMediaKey === null
      ? null
      : normalizePackageMediaKey(input.coverPackageMediaKey, "coverPackageMediaKey"),
  };
}

export async function createCatalogPackageDraftInExecutor(
  executor: DatabaseExecutor,
  input: CreateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  const normalizedInput = normalizeCreateCatalogPackageDraftInput(input);
  try {
    await assertCatalogPackageSelectedAuthorPubliclyEligibleInExecutor(
      executor,
      normalizedInput.authorId,
    );
    const result = await executor.query<CatalogPackageRow>(
      [
        "INSERT INTO catalog.packages",
        "(",
        "package_id, author_id, slug, title, summary, description, language_tags,",
        "license, content_warning",
        ")",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        "RETURNING",
        catalogPackageColumns,
      ].join(" "),
      [
        normalizedInput.packageId,
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.title,
        normalizedInput.summary,
        normalizedInput.description,
        normalizedInput.languageTags,
        normalizedInput.license,
        normalizedInput.contentWarning,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package insert to return a row");
    }

    return mapCatalogPackageRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function updateCatalogPackageDraftInExecutor(
  executor: DatabaseExecutor,
  input: UpdateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  const normalizedInput = normalizeUpdateCatalogPackageDraftInput(input);
  try {
    await lockCatalogPackageInExecutor(executor, normalizedInput.packageId);
    await assertCatalogPackageSelectedAuthorPubliclyEligibleInExecutor(
      executor,
      normalizedInput.authorId,
    );
    await assertDraftMediaKeysExistInExecutor(
      executor,
      normalizedInput.packageId,
      normalizedInput.coverPackageMediaKey === null ? [] : [normalizedInput.coverPackageMediaKey],
    );
    const result = await executor.query<CatalogPackageRow>(
      [
        "UPDATE catalog.packages",
        "SET author_id = $2, slug = $3, title = $4, summary = $5, description = $6,",
        "language_tags = $7, license = $8, content_warning = $9,",
        "cover_package_media_key = $10",
        "WHERE package_id = $1",
        "RETURNING",
        catalogPackageColumns,
      ].join(" "),
      [
        normalizedInput.packageId,
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.title,
        normalizedInput.summary,
        normalizedInput.description,
        normalizedInput.languageTags,
        normalizedInput.license,
        normalizedInput.contentWarning,
        normalizedInput.coverPackageMediaKey,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new HttpError(
        404,
        `Catalog package not found. packageId=${normalizedInput.packageId}`,
        "CATALOG_PACKAGE_NOT_FOUND",
      );
    }

    return mapCatalogPackageRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function loadCatalogPackageDraftInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<CatalogPackageDraft> {
  const packageResult = await executor.query<CatalogPackageRow>(
    [
      "SELECT",
      catalogPackageColumns,
      "FROM catalog.packages",
      "WHERE package_id = $1",
    ].join(" "),
    [packageId],
  );
  const packageRow = packageResult.rows[0];
  if (packageRow === undefined) {
    throw new HttpError(404, `Catalog package not found. packageId=${packageId}`, "CATALOG_PACKAGE_NOT_FOUND");
  }

  const mediaResult = await executor.query<CatalogPackageMediaAssetRow>(
    [
      "SELECT",
      catalogPackageMediaAssetColumns,
      "FROM catalog.package_media_assets",
      "WHERE package_id = $1",
      "AND package_version_id IS NULL",
      "ORDER BY package_media_key ASC",
    ].join(" "),
    [packageId],
  );

  return {
    catalogPackage: mapCatalogPackageRow(packageRow),
    mediaAssets: mediaResult.rows.map((row: CatalogPackageMediaAssetRow) => mapCatalogPackageMediaAssetRow(row)),
  };
}

export async function createCatalogPackageDraft(
  input: CreateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  return unsafeTransaction(async (executor) => createCatalogPackageDraftInExecutor(executor, input));
}

export async function updateCatalogPackageDraft(
  input: UpdateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  return unsafeTransaction(async (executor) => updateCatalogPackageDraftInExecutor(executor, input));
}

export async function loadCatalogPackageDraft(packageId: string): Promise<CatalogPackageDraft> {
  return unsafeTransaction(async (executor) => loadCatalogPackageDraftInExecutor(executor, packageId));
}
