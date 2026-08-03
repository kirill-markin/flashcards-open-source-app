import type { DatabaseExecutor } from "../../database";
import { unsafeTransaction } from "../../database/core";
import { HttpError } from "../../shared/errors";
import {
  normalizeNonEmptyString,
  normalizeNullableString,
  normalizeSlug,
} from "../common";
import { rethrowCatalogPersistenceError } from "../errors";
import {
  catalogAuthorColumns,
  mapCatalogAuthorRow,
} from "../rows";
import { getPublicCatalogAuthorEligibilityIssue } from "../publicSafety";
import type {
  CatalogAuthor,
  CatalogAuthorRow,
  UpsertCatalogAuthorInput,
} from "../types";

function normalizeCatalogAuthorInput(input: UpsertCatalogAuthorInput): UpsertCatalogAuthorInput {
  const presentationInput = {
    authorId: input.authorId,
    slug: normalizeSlug(input.slug, "slug"),
    displayName: normalizeNonEmptyString(input.displayName, "displayName"),
    bio: normalizeNullableString(input.bio, "bio"),
    websiteUrl: input.websiteUrl,
  };
  const publicEligibilityIssue = getPublicCatalogAuthorEligibilityIssue(presentationInput);
  if (publicEligibilityIssue !== null) {
    const field = publicEligibilityIssue.reason === "invalid_author_website_url"
      ? "websiteUrl"
      : publicEligibilityIssue.field;
    const reason = publicEligibilityIssue.reason === "invalid_author_website_url"
      ? "websiteUrl must be a valid absolute HTTP or HTTPS URI without credentials"
      : `${field} contains a private or managed-storage media reference`;
    throw new HttpError(
      400,
      `Catalog author is not eligible for public presentation. field=${field} reason=${reason}`,
      "CATALOG_AUTHOR_NOT_PUBLICLY_ELIGIBLE",
    );
  }

  return {
    ...presentationInput,
    websiteUrl: normalizeNullableString(input.websiteUrl, "websiteUrl"),
  };
}

export async function createCatalogAuthorInExecutor(
  executor: DatabaseExecutor,
  input: UpsertCatalogAuthorInput,
): Promise<CatalogAuthor> {
  const normalizedInput = normalizeCatalogAuthorInput(input);
  try {
    const result = await executor.query<CatalogAuthorRow>(
      [
        "INSERT INTO catalog.authors",
        "(author_id, slug, display_name, bio, website_url)",
        "VALUES ($1, $2, $3, $4, $5)",
        "RETURNING",
        catalogAuthorColumns,
      ].join(" "),
      [
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.displayName,
        normalizedInput.bio,
        normalizedInput.websiteUrl,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog author insert to return a row");
    }

    return mapCatalogAuthorRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function updateCatalogAuthorInExecutor(
  executor: DatabaseExecutor,
  input: UpsertCatalogAuthorInput,
): Promise<CatalogAuthor> {
  const normalizedInput = normalizeCatalogAuthorInput(input);
  try {
    const result = await executor.query<CatalogAuthorRow>(
      [
        "UPDATE catalog.authors",
        "SET slug = $2, display_name = $3, bio = $4, website_url = $5",
        "WHERE author_id = $1",
        "RETURNING",
        catalogAuthorColumns,
      ].join(" "),
      [
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.displayName,
        normalizedInput.bio,
        normalizedInput.websiteUrl,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new HttpError(
        404,
        `Catalog author not found. authorId=${normalizedInput.authorId}`,
        "CATALOG_AUTHOR_NOT_FOUND",
      );
    }

    return mapCatalogAuthorRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function createCatalogAuthor(input: UpsertCatalogAuthorInput): Promise<CatalogAuthor> {
  return unsafeTransaction(async (executor) => createCatalogAuthorInExecutor(executor, input));
}

export async function updateCatalogAuthor(input: UpsertCatalogAuthorInput): Promise<CatalogAuthor> {
  return unsafeTransaction(async (executor) => updateCatalogAuthorInExecutor(executor, input));
}
