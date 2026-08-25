import type {
  CatalogPackageInstallAuthor,
  CatalogPackageInstallConfirmResponse,
  CatalogPackageInstallDefaultOptions,
  CatalogPackageInstallPackageVersion,
  CatalogPackageInstallPreviewResponse,
  CatalogPackageInstallTagCount,
  CatalogPublicPackageVersion,
  CatalogPublicPackageVersionAuthor,
} from "../types";
import {
  ApiContractError,
  type JsonObject,
  parseArray,
  parseBoolean,
  parseNonNegativeInteger,
  parseNullableString,
  parseObject,
  parseRequiredField,
  parseString,
  parseStringArray,
} from "./core";

function parsePositiveInteger(value: unknown, endpoint: string, path: string): number {
  const parsedValue = parseNonNegativeInteger(value, endpoint, path);
  if (parsedValue === 0) {
    throw new ApiContractError(endpoint, path, "positive integer");
  }

  return parsedValue;
}

function parseCatalogArray<ParsedValue>(
  objectValue: JsonObject,
  key: string,
  endpoint: string,
  parseItem: (value: unknown, itemEndpoint: string, itemPath: string) => ParsedValue,
): ReadonlyArray<ParsedValue> {
  return parseRequiredField(
    objectValue,
    key,
    endpoint,
    "",
    (arrayValue, arrayEndpoint, arrayPath) => parseArray(arrayValue, arrayEndpoint, arrayPath, parseItem),
  );
}

function parseCatalogPublicPackageVersionAuthor(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicPackageVersionAuthor {
  const objectValue = parseObject(value, endpoint, path);
  return {
    authorId: parseRequiredField(objectValue, "authorId", endpoint, path, parseString),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    displayName: parseRequiredField(objectValue, "displayName", endpoint, path, parseString),
  };
}

function parseCatalogPublicPackageVersion(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicPackageVersion {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageVersionId: parseRequiredField(objectValue, "packageVersionId", endpoint, path, parseString),
    packageId: parseRequiredField(objectValue, "packageId", endpoint, path, parseString),
    versionNumber: parseRequiredField(objectValue, "versionNumber", endpoint, path, parsePositiveInteger),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    title: parseRequiredField(objectValue, "title", endpoint, path, parseString),
    summary: parseRequiredField(objectValue, "summary", endpoint, path, parseString),
    languageTags: parseRequiredField(objectValue, "languageTags", endpoint, path, parseStringArray),
    cardCount: parseRequiredField(objectValue, "cardCount", endpoint, path, parseNonNegativeInteger),
    publishedAt: parseRequiredField(objectValue, "publishedAt", endpoint, path, parseString),
    author: parseRequiredField(objectValue, "author", endpoint, path, parseCatalogPublicPackageVersionAuthor),
  };
}

export function parseCatalogPublicPackageVersionResponse(value: unknown, endpoint: string): Readonly<{
  catalogPackageVersion: CatalogPublicPackageVersion;
}> {
  const objectValue = parseObject(value, endpoint, "");
  return {
    catalogPackageVersion: parseRequiredField(
      objectValue,
      "catalogPackageVersion",
      endpoint,
      "",
      parseCatalogPublicPackageVersion,
    ),
  };
}

function parseCatalogPackageInstallAuthor(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPackageInstallAuthor {
  const objectValue = parseObject(value, endpoint, path);
  return {
    authorId: parseRequiredField(objectValue, "authorId", endpoint, path, parseString),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    displayName: parseRequiredField(objectValue, "displayName", endpoint, path, parseString),
  };
}

function parseCatalogPackageInstallPackageVersion(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPackageInstallPackageVersion {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageVersionId: parseRequiredField(objectValue, "packageVersionId", endpoint, path, parseString),
    packageId: parseRequiredField(objectValue, "packageId", endpoint, path, parseString),
    versionNumber: parseRequiredField(objectValue, "versionNumber", endpoint, path, parsePositiveInteger),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    title: parseRequiredField(objectValue, "title", endpoint, path, parseString),
    summary: parseRequiredField(objectValue, "summary", endpoint, path, parseString),
    description: parseRequiredField(objectValue, "description", endpoint, path, parseString),
    languageTags: parseRequiredField(objectValue, "languageTags", endpoint, path, parseStringArray),
    license: parseRequiredField(objectValue, "license", endpoint, path, parseString),
    contentWarning: parseRequiredField(objectValue, "contentWarning", endpoint, path, parseNullableString),
    coverPackageMediaKey: parseRequiredField(objectValue, "coverPackageMediaKey", endpoint, path, parseNullableString),
    cardCount: parseRequiredField(objectValue, "cardCount", endpoint, path, parseNonNegativeInteger),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    publishedAt: parseRequiredField(objectValue, "publishedAt", endpoint, path, parseNullableString),
    author: parseRequiredField(objectValue, "author", endpoint, path, parseCatalogPackageInstallAuthor),
  };
}

function parseCatalogPackageInstallTagCount(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPackageInstallTagCount {
  const objectValue = parseObject(value, endpoint, path);
  return {
    tag: parseRequiredField(objectValue, "tag", endpoint, path, parseString),
    cardsCount: parseRequiredField(objectValue, "cardsCount", endpoint, path, parseNonNegativeInteger),
  };
}

function parseCatalogPackageInstallDefaultOptions(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPackageInstallDefaultOptions {
  const objectValue = parseObject(value, endpoint, path);
  return {
    addImportTag: parseRequiredField(objectValue, "addImportTag", endpoint, path, parseBoolean),
    suggestedImportTag: parseRequiredField(objectValue, "suggestedImportTag", endpoint, path, parseString),
    keptTags: parseRequiredField(objectValue, "keptTags", endpoint, path, parseStringArray),
    removedTags: parseRequiredField(objectValue, "removedTags", endpoint, path, parseStringArray),
  };
}

export function parseCatalogPackageInstallPreviewResponse(
  value: unknown,
  endpoint: string,
): CatalogPackageInstallPreviewResponse {
  const objectValue = parseObject(value, endpoint, "");
  const summaryValue = parseObject(objectValue.summary, endpoint, "summary");
  return {
    packageVersion: parseRequiredField(objectValue, "packageVersion", endpoint, "", parseCatalogPackageInstallPackageVersion),
    summary: {
      cardCount: parseRequiredField(summaryValue, "cardCount", endpoint, "summary", parseNonNegativeInteger),
      mediaAssetCount: parseRequiredField(summaryValue, "mediaAssetCount", endpoint, "summary", parseNonNegativeInteger),
    },
    tagCounts: parseCatalogArray(objectValue, "tagCounts", endpoint, parseCatalogPackageInstallTagCount),
    defaultOptions: parseRequiredField(objectValue, "defaultOptions", endpoint, "", parseCatalogPackageInstallDefaultOptions),
  };
}

function parseCatalogInstalledCard(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPackageInstallConfirmResponse["installedCards"][number] {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageCardId: parseRequiredField(objectValue, "packageCardId", endpoint, path, parseString),
    stableCardKey: parseRequiredField(objectValue, "stableCardKey", endpoint, path, parseString),
    ordinal: parseRequiredField(objectValue, "ordinal", endpoint, path, parsePositiveInteger),
    cardId: parseRequiredField(objectValue, "cardId", endpoint, path, parseString),
  };
}

function parseCatalogInstalledMediaAsset(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPackageInstallConfirmResponse["installedMediaAssets"][number] {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageMediaAssetId: parseRequiredField(objectValue, "packageMediaAssetId", endpoint, path, parseString),
    packageMediaKey: parseRequiredField(objectValue, "packageMediaKey", endpoint, path, parseString),
    mediaAssetId: parseRequiredField(objectValue, "mediaAssetId", endpoint, path, parseString),
  };
}

export function parseCatalogPackageInstallConfirmResponse(
  value: unknown,
  endpoint: string,
): CatalogPackageInstallConfirmResponse {
  const objectValue = parseObject(value, endpoint, "");
  const summaryValue = parseObject(objectValue.summary, endpoint, "summary");
  return {
    packageVersion: parseRequiredField(objectValue, "packageVersion", endpoint, "", parseCatalogPackageInstallPackageVersion),
    installedCards: parseCatalogArray(objectValue, "installedCards", endpoint, parseCatalogInstalledCard),
    installedMediaAssets: parseCatalogArray(objectValue, "installedMediaAssets", endpoint, parseCatalogInstalledMediaAsset),
    summary: {
      cardCount: parseRequiredField(summaryValue, "cardCount", endpoint, "summary", parseNonNegativeInteger),
      mediaAssetCount: parseRequiredField(summaryValue, "mediaAssetCount", endpoint, "summary", parseNonNegativeInteger),
      installId: parseRequiredField(summaryValue, "installId", endpoint, "summary", parseString),
      installedAt: parseRequiredField(summaryValue, "installedAt", endpoint, "summary", parseString),
      keptTagCount: parseRequiredField(summaryValue, "keptTagCount", endpoint, "summary", parseNonNegativeInteger),
      removedTagCount: parseRequiredField(summaryValue, "removedTagCount", endpoint, "summary", parseNonNegativeInteger),
      importTag: parseRequiredField(summaryValue, "importTag", endpoint, "summary", parseNullableString),
    },
  };
}
