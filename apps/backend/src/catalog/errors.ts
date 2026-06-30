import { getDatabaseErrorFields } from "../database/transient";
import { HttpError } from "../shared/errors";

function readStringField(value: unknown, fieldName: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const fieldValue = (value as Readonly<Record<string, unknown>>)[fieldName];
  return typeof fieldValue === "string" && fieldValue !== "" ? fieldValue : null;
}

export function toCatalogPersistenceError(error: unknown): HttpError | null {
  if (error instanceof HttpError) {
    return error;
  }

  const fields = getDatabaseErrorFields(error);
  const constraint = readStringField(error, "constraint");
  if (fields.sqlState === "23505") {
    switch (constraint) {
      case "authors_slug_unique":
        return new HttpError(409, "Catalog author slug already exists.", "CATALOG_AUTHOR_SLUG_ALREADY_EXISTS");
      case "packages_slug_unique":
        return new HttpError(409, "Catalog package slug already exists.", "CATALOG_PACKAGE_SLUG_ALREADY_EXISTS");
      case "idx_package_versions_one_review_candidate":
        return new HttpError(
          409,
          "Package already has a mutable draft or review candidate version.",
          "CATALOG_PACKAGE_VERSION_DRAFT_ALREADY_EXISTS",
        );
      case "package_versions_package_number_unique":
        return new HttpError(
          409,
          "Package version number already exists for this package.",
          "CATALOG_PACKAGE_VERSION_ALREADY_EXISTS",
        );
      case "idx_package_media_assets_draft_key_unique":
      case "idx_package_media_assets_version_key_unique":
        return new HttpError(
          409,
          "Catalog package media key already exists for this package draft or version.",
          "CATALOG_PACKAGE_MEDIA_KEY_ALREADY_EXISTS",
        );
    }
  }

  if (fields.sqlState === "23503") {
    return new HttpError(
      400,
      `Catalog write references a missing row. constraint=${constraint ?? "unknown"}`,
      "CATALOG_REFERENCE_NOT_FOUND",
    );
  }

  if (fields.sqlState === "23514") {
    return new HttpError(
      409,
      `Catalog write violates a catalog database constraint. message=${fields.errorMessage}`,
      "CATALOG_CONSTRAINT_VIOLATION",
    );
  }

  return null;
}

export function rethrowCatalogPersistenceError(error: unknown): never {
  const mappedError = toCatalogPersistenceError(error);
  if (mappedError !== null) {
    throw mappedError;
  }

  throw error;
}
