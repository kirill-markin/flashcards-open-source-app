import type {
  CatalogPackageInstallAuthor,
  CatalogPackageInstallConfirmResponse,
  CatalogPackageInstallDefaultOptions,
  CatalogPackageInstallPackageVersion,
  CatalogPackageInstallPreviewResponse,
  CatalogPackageInstallTagCount,
  CatalogPublicSnapshot,
  CatalogPublicSnapshotAuthor,
  CatalogPublicSnapshotCard,
  CatalogPublicSnapshotCollection,
  CatalogPublicSnapshotCollectionPackage,
  CatalogPublicSnapshotMediaAsset,
  CatalogPublicSnapshotPackage,
  CatalogPublicSnapshotPackageVersion,
} from "../types";
import {
  ApiContractError,
  type JsonObject,
  parseArray,
  parseBoolean,
  parseLiteral,
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

function parseCatalogPublicSnapshotAuthor(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicSnapshotAuthor {
  const objectValue = parseObject(value, endpoint, path);
  return {
    authorId: parseRequiredField(objectValue, "authorId", endpoint, path, parseString),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    displayName: parseRequiredField(objectValue, "displayName", endpoint, path, parseString),
    bio: parseRequiredField(objectValue, "bio", endpoint, path, parseNullableString),
    websiteUrl: parseRequiredField(objectValue, "websiteUrl", endpoint, path, parseNullableString),
  };
}

function parseCatalogPublicSnapshotPackage(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicSnapshotPackage {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageId: parseRequiredField(objectValue, "packageId", endpoint, path, parseString),
    authorId: parseRequiredField(objectValue, "authorId", endpoint, path, parseString),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    status: parseLiteral(
      parseRequiredField(objectValue, "status", endpoint, path, parseString),
      endpoint,
      `${path}.status`,
      "published",
    ),
    latestPackageVersionId: parseRequiredField(objectValue, "latestPackageVersionId", endpoint, path, parseString),
    versionCount: parseRequiredField(objectValue, "versionCount", endpoint, path, parsePositiveInteger),
    publishedAt: parseRequiredField(objectValue, "publishedAt", endpoint, path, parseString),
  };
}

function parseCatalogPublicSnapshotPackageVersion(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicSnapshotPackageVersion {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageVersionId: parseRequiredField(objectValue, "packageVersionId", endpoint, path, parseString),
    packageId: parseRequiredField(objectValue, "packageId", endpoint, path, parseString),
    versionNumber: parseRequiredField(objectValue, "versionNumber", endpoint, path, parsePositiveInteger),
    status: parseLiteral(
      parseRequiredField(objectValue, "status", endpoint, path, parseString),
      endpoint,
      `${path}.status`,
      "published",
    ),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    title: parseRequiredField(objectValue, "title", endpoint, path, parseString),
    summary: parseRequiredField(objectValue, "summary", endpoint, path, parseString),
    description: parseRequiredField(objectValue, "description", endpoint, path, parseString),
    languageTags: parseRequiredField(objectValue, "languageTags", endpoint, path, parseStringArray),
    topicTags: parseRequiredField(objectValue, "topicTags", endpoint, path, parseStringArray),
    license: parseRequiredField(objectValue, "license", endpoint, path, parseString),
    contentWarning: parseRequiredField(objectValue, "contentWarning", endpoint, path, parseNullableString),
    coverMediaAssetId: parseRequiredField(objectValue, "coverMediaAssetId", endpoint, path, parseNullableString),
    cardCount: parseRequiredField(objectValue, "cardCount", endpoint, path, parseNonNegativeInteger),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
    publishedAt: parseRequiredField(objectValue, "publishedAt", endpoint, path, parseString),
    installUrl: parseRequiredField(objectValue, "installUrl", endpoint, path, parseString),
  };
}

function parseCatalogPublicSnapshotCard(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicSnapshotCard {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageCardId: parseRequiredField(objectValue, "packageCardId", endpoint, path, parseString),
    packageVersionId: parseRequiredField(objectValue, "packageVersionId", endpoint, path, parseString),
    ordinal: parseRequiredField(objectValue, "ordinal", endpoint, path, parsePositiveInteger),
    frontText: parseRequiredField(objectValue, "frontText", endpoint, path, parseString),
    backText: parseRequiredField(objectValue, "backText", endpoint, path, parseString),
    cardType: parseRequiredField(objectValue, "cardType", endpoint, path, parseString),
    tags: parseRequiredField(objectValue, "tags", endpoint, path, parseStringArray),
    mediaAssetIds: parseRequiredField(objectValue, "mediaAssetIds", endpoint, path, parseStringArray),
  };
}

function parseCatalogPublicSnapshotMediaAsset(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicSnapshotMediaAsset {
  const objectValue = parseObject(value, endpoint, path);
  return {
    packageMediaAssetId: parseRequiredField(objectValue, "packageMediaAssetId", endpoint, path, parseString),
    packageVersionId: parseRequiredField(objectValue, "packageVersionId", endpoint, path, parseString),
    packageMediaKey: parseRequiredField(objectValue, "packageMediaKey", endpoint, path, parseString),
    altText: parseRequiredField(objectValue, "altText", endpoint, path, parseNullableString),
    credit: parseRequiredField(objectValue, "credit", endpoint, path, parseNullableString),
    license: parseRequiredField(objectValue, "license", endpoint, path, parseNullableString),
    mimeType: parseRequiredField(objectValue, "mimeType", endpoint, path, parseString),
    sizeBytes: parseRequiredField(objectValue, "sizeBytes", endpoint, path, parseNonNegativeInteger),
    downloadUrl: parseRequiredField(objectValue, "downloadUrl", endpoint, path, parseString),
  };
}

function parseCatalogPublicSnapshotCollection(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicSnapshotCollection {
  const objectValue = parseObject(value, endpoint, path);
  return {
    collectionId: parseRequiredField(objectValue, "collectionId", endpoint, path, parseString),
    slug: parseRequiredField(objectValue, "slug", endpoint, path, parseString),
    title: parseRequiredField(objectValue, "title", endpoint, path, parseString),
    summary: parseRequiredField(objectValue, "summary", endpoint, path, parseString),
    description: parseRequiredField(objectValue, "description", endpoint, path, parseString),
    languageTags: parseRequiredField(objectValue, "languageTags", endpoint, path, parseStringArray),
    topicTags: parseRequiredField(objectValue, "topicTags", endpoint, path, parseStringArray),
    coverPackageId: parseRequiredField(objectValue, "coverPackageId", endpoint, path, parseNullableString),
    status: parseLiteral(
      parseRequiredField(objectValue, "status", endpoint, path, parseString),
      endpoint,
      `${path}.status`,
      "published",
    ),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
    publishedAt: parseRequiredField(objectValue, "publishedAt", endpoint, path, parseString),
  };
}

function parseCatalogPublicSnapshotCollectionPackage(
  value: unknown,
  endpoint: string,
  path: string,
): CatalogPublicSnapshotCollectionPackage {
  const objectValue = parseObject(value, endpoint, path);
  return {
    collectionId: parseRequiredField(objectValue, "collectionId", endpoint, path, parseString),
    packageId: parseRequiredField(objectValue, "packageId", endpoint, path, parseString),
    ordinal: parseRequiredField(objectValue, "ordinal", endpoint, path, parsePositiveInteger),
  };
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

export function parseCatalogPublicSnapshotResponse(value: unknown, endpoint: string): CatalogPublicSnapshot {
  const objectValue = parseObject(value, endpoint, "");
  return {
    schemaVersion: parseLiteral(
      parseRequiredField(objectValue, "schemaVersion", endpoint, "", parseNonNegativeInteger),
      endpoint,
      "schemaVersion",
      1,
    ),
    generatedAt: parseRequiredField(objectValue, "generatedAt", endpoint, "", parseString),
    authors: parseCatalogArray(objectValue, "authors", endpoint, parseCatalogPublicSnapshotAuthor),
    packages: parseCatalogArray(objectValue, "packages", endpoint, parseCatalogPublicSnapshotPackage),
    packageVersions: parseCatalogArray(objectValue, "packageVersions", endpoint, parseCatalogPublicSnapshotPackageVersion),
    cards: parseCatalogArray(objectValue, "cards", endpoint, parseCatalogPublicSnapshotCard),
    mediaAssets: parseCatalogArray(objectValue, "mediaAssets", endpoint, parseCatalogPublicSnapshotMediaAsset),
    collections: parseCatalogArray(objectValue, "collections", endpoint, parseCatalogPublicSnapshotCollection),
    collectionPackages: parseCatalogArray(objectValue, "collectionPackages", endpoint, parseCatalogPublicSnapshotCollectionPackage),
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
    topicTags: parseRequiredField(objectValue, "topicTags", endpoint, path, parseStringArray),
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
