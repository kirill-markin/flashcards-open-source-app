import { HttpError } from "../shared/errors";
import type { TimestampValue } from "./types";

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;
const packageMediaKeyPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const privateWorkspacePackageMediaKeyPattern = /^w-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.[0-9]+)?$/u;
const uuidPackageMediaKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const sha256PackageMediaKeyPattern = /^(?:sha256[._-])?[0-9a-f]{64}$/u;
const storageKeyLikePackageMediaKeyPattern = /^media[._-]blobs[._-]sha256(?:[._-][a-z0-9]+)*$/u;
const storageKeyLikeMarkdownPathPattern = /(?:^|[\\/])media[/._-]blobs[/._-]sha256(?:[/._-]|$)/u;
const storageKeyLikeMarkdownTextPattern = /(?:^|[^a-z0-9])media[/._-]blobs[/._-]sha256(?:[/._-]|$)/u;
const privateWorkspacePackageMediaKeyTextPattern = /(?:^|[^a-z0-9])w-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.[0-9]+)?(?:$|[^a-z0-9])/u;
const sha256PackageMediaKeyTextPattern = /(?:^|[^a-z0-9])(?:sha256[._-])?[0-9a-f]{64}(?:$|[^a-z0-9])/u;
const fcAssetReferencePattern = /fcasset:[^\s<>()\[\]]+/gu;
const pathSeparatorPattern = /[\\/]+/u;
const queryOrFragmentPattern = /[?#]/u;
const percentEncodedPathSeparatorPattern = /%(?:2f|5c)/u;
const fcAssetDestinationPrefix = "fcasset:";
const relativeUrlBase = "https://public-catalog.invalid";
const markdownDestinationDecodeLimit = 4;

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

export function isPrivateWorkspacePackageMediaKey(value: string): boolean {
  return privateWorkspacePackageMediaKeyPattern.test(value.toLowerCase());
}

export function isUnsafePublicPackageMediaKey(value: string): boolean {
  const packageMediaKey = value.toLowerCase();
  return (
    privateWorkspacePackageMediaKeyPattern.test(packageMediaKey)
    || uuidPackageMediaKeyPattern.test(packageMediaKey)
    || sha256PackageMediaKeyPattern.test(packageMediaKey)
    || storageKeyLikePackageMediaKeyPattern.test(packageMediaKey)
  );
}

function stripQueryAndFragment(value: string): string {
  const queryOrFragmentIndex = value.search(queryOrFragmentPattern);
  return queryOrFragmentIndex === -1 ? value : value.slice(0, queryOrFragmentIndex);
}

function decodePercentEncodedValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function addUniqueValue(values: Array<string>, value: string): void {
  if (values.includes(value)) {
    return;
  }

  values.push(value);
}

function buildPercentDecodedValues(value: string): ReadonlyArray<string> {
  const values: Array<string> = [];
  let currentValue = value;
  addUniqueValue(values, currentValue);

  for (let decodeDepth = 0; decodeDepth < markdownDestinationDecodeLimit; decodeDepth += 1) {
    const decodedValue = decodePercentEncodedValue(currentValue);
    if (decodedValue === null || decodedValue === currentValue) {
      return values;
    }

    addUniqueValue(values, decodedValue);
    currentValue = decodedValue;
  }

  return values;
}

function buildMarkdownDestinationInspectionValues(destination: string): ReadonlyArray<string> {
  const values: Array<string> = [];
  const lowerDestination = destination.trim().toLowerCase();
  const sourceValues = buildPercentDecodedValues(lowerDestination);

  for (const sourceValue of sourceValues) {
    addUniqueValue(values, sourceValue);
    addUniqueValue(values, stripQueryAndFragment(sourceValue));

    try {
      const parsedUrl = new URL(sourceValue, relativeUrlBase);
      addUniqueValue(values, parsedUrl.pathname);
    } catch {
      continue;
    }
  }

  return values;
}

function hasUnsafePublicPackageMediaPathSegment(pathValue: string): boolean {
  const pathWithoutQueryOrFragment = stripQueryAndFragment(pathValue);
  const segments = pathWithoutQueryOrFragment.split(pathSeparatorPattern).filter((segment) => segment !== "");
  return segments.some((segment) => isUnsafePublicPackageMediaKey(segment));
}

function hasSuspiciousEncodedInternalStorageHint(destination: string): boolean {
  return percentEncodedPathSeparatorPattern.test(destination)
    && (destination.includes("media") || destination.includes("sha256"));
}

function isSuspiciousUndecodableMarkdownDestination(destination: string): boolean {
  let currentValue = destination;
  for (let decodeDepth = 0; decodeDepth < markdownDestinationDecodeLimit; decodeDepth += 1) {
    const decodedValue = decodePercentEncodedValue(currentValue);
    if (decodedValue === null) {
      return hasSuspiciousEncodedInternalStorageHint(currentValue);
    }

    if (decodedValue === currentValue) {
      return false;
    }

    currentValue = decodedValue;
  }

  return hasSuspiciousEncodedInternalStorageHint(currentValue);
}

function isUnsafeFcAssetDestination(destination: string): boolean {
  if (destination.startsWith(fcAssetDestinationPrefix)) {
    const packageMediaKey = destination.slice(fcAssetDestinationPrefix.length);
    return packageMediaKeyPattern.test(packageMediaKey) === false
      || isUnsafePublicPackageMediaKey(packageMediaKey);
  }

  return false;
}

function containsUnsafeFcAssetReference(value: string): boolean {
  for (const match of value.matchAll(fcAssetReferencePattern)) {
    const fcAssetReference = match[0] ?? "";
    if (isUnsafeFcAssetDestination(fcAssetReference)) {
      return true;
    }
  }

  return false;
}

function containsUnsafePublicPackageMediaTextPattern(value: string): boolean {
  return (
    storageKeyLikeMarkdownTextPattern.test(value)
    || privateWorkspacePackageMediaKeyTextPattern.test(value)
    || sha256PackageMediaKeyTextPattern.test(value)
  );
}

export function containsUnsafePublicPackageMediaReference(value: string): boolean {
  const destination = value.trim().toLowerCase();
  if (destination === "") {
    return false;
  }

  if (isSuspiciousUndecodableMarkdownDestination(destination)) {
    return true;
  }

  return buildMarkdownDestinationInspectionValues(destination).some((inspectionValue) => (
    isUnsafePublicPackageMediaKey(inspectionValue)
    || storageKeyLikeMarkdownPathPattern.test(inspectionValue)
    || hasUnsafePublicPackageMediaPathSegment(inspectionValue)
    || containsUnsafePublicPackageMediaTextPattern(inspectionValue)
    || containsUnsafeFcAssetReference(inspectionValue)
  ));
}

export function isUnsafePublicPackageMediaDestination(value: string): boolean {
  const destination = value.trim().toLowerCase();
  if (isUnsafeFcAssetDestination(destination)) {
    return true;
  }

  return containsUnsafePublicPackageMediaReference(destination);
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
