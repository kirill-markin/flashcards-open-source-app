import { HttpError } from "../shared/errors";
import type { TimestampValue } from "./types";

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;
const packageMediaKeyPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

export function toOptionalIsoString(value: TimestampValue | null): string | null {
  return value === null ? null : toIsoString(value);
}

export function toSafeNumber(value: string | number, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isSafeInteger(parsedValue) === false) {
    throw new Error(`${fieldName} must be a safe integer`);
  }

  return parsedValue;
}

export function normalizeNonEmptyString(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new HttpError(400, `${fieldName} must not be empty`, "CATALOG_INVALID_INPUT");
  }

  return normalizedValue;
}

export function normalizeNullableString(value: string | null, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return normalizeNonEmptyString(value, fieldName);
}

export function normalizeSlug(value: string, fieldName: string): string {
  const slug = normalizeNonEmptyString(value, fieldName).toLowerCase();
  if (slugPattern.test(slug) === false) {
    throw new HttpError(
      400,
      `${fieldName} must use lowercase letters, numbers, and hyphens without leading or trailing hyphens.`,
      "CATALOG_SLUG_INVALID",
    );
  }

  return slug;
}

export function normalizePackageMediaKey(value: string, fieldName: string): string {
  const packageMediaKey = normalizeNonEmptyString(value, fieldName).toLowerCase();
  if (packageMediaKeyPattern.test(packageMediaKey) === false) {
    throw new HttpError(
      400,
      `${fieldName} must use lowercase letters, numbers, dots, underscores, or hyphens.`,
      "CATALOG_PACKAGE_MEDIA_KEY_INVALID",
    );
  }

  return packageMediaKey;
}

export function normalizeTextArray(
  values: ReadonlyArray<string>,
  fieldName: string,
  requireNonEmpty: boolean,
): ReadonlyArray<string> {
  const normalizedValues = values.map((value) => normalizeNonEmptyString(value, fieldName).toLowerCase());
  const uniqueValues = [...new Set(normalizedValues)];
  if (requireNonEmpty && uniqueValues.length === 0) {
    throw new HttpError(400, `${fieldName} must include at least one item`, "CATALOG_INVALID_INPUT");
  }

  return uniqueValues;
}

export function normalizeAdminEmail(adminEmail: string): string {
  return normalizeNonEmptyString(adminEmail, "adminEmail").toLowerCase();
}
