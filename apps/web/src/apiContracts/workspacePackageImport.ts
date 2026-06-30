import type {
  WorkspacePackageImportedMediaAsset,
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportConfirmSummary,
  WorkspacePackageImportDefaultOptions,
  WorkspacePackageImportPreviewMetadata,
  WorkspacePackageImportPreviewResponse,
  WorkspacePackageImportPreviewTagCount,
  WorkspacePackageImportPreviewWarning,
} from "../types";
import {
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
import { parseMediaAsset } from "./mediaAssets";
import { parseCard } from "./studyData";

function parseWorkspacePackageImportPreviewMetadata(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageImportPreviewMetadata {
  const objectValue = parseObject(value, endpoint, path);
  return {
    label: parseRequiredField(objectValue, "label", endpoint, path, parseNullableString),
    author: parseRequiredField(objectValue, "author", endpoint, path, parseNullableString),
    comment: parseRequiredField(objectValue, "comment", endpoint, path, parseNullableString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseNullableString),
    sourceUrl: parseRequiredField(objectValue, "sourceUrl", endpoint, path, parseNullableString),
  };
}

function parseWorkspacePackageImportPreviewTagCount(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageImportPreviewTagCount {
  const objectValue = parseObject(value, endpoint, path);
  return {
    tag: parseRequiredField(objectValue, "tag", endpoint, path, parseString),
    cardsCount: parseRequiredField(objectValue, "cardsCount", endpoint, path, parseNonNegativeInteger),
  };
}

function parseWorkspacePackageImportPreviewWarning(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageImportPreviewWarning {
  const objectValue = parseObject(value, endpoint, path);
  return {
    code: parseRequiredField(objectValue, "code", endpoint, path, parseString),
    message: parseRequiredField(objectValue, "message", endpoint, path, parseString),
    mediaPath: parseRequiredField(objectValue, "mediaPath", endpoint, path, parseString),
  };
}

function parseWorkspacePackageImportDefaultOptions(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageImportDefaultOptions {
  const objectValue = parseObject(value, endpoint, path);
  return {
    addImportTag: parseRequiredField(objectValue, "addImportTag", endpoint, path, parseBoolean),
    suggestedImportTag: parseRequiredField(objectValue, "suggestedImportTag", endpoint, path, parseString),
    keptTags: parseRequiredField(objectValue, "keptTags", endpoint, path, parseStringArray),
    removedTags: parseRequiredField(objectValue, "removedTags", endpoint, path, parseStringArray),
  };
}

function parseWorkspacePackageImportedMediaAsset(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageImportedMediaAsset {
  const objectValue = parseObject(value, endpoint, path);
  return {
    portablePath: parseRequiredField(objectValue, "portablePath", endpoint, path, parseString),
    mediaAsset: parseRequiredField(objectValue, "mediaAsset", endpoint, path, parseMediaAsset),
    applied: parseRequiredField(objectValue, "applied", endpoint, path, parseBoolean),
  };
}

function parseWorkspacePackageImportConfirmSummary(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageImportConfirmSummary {
  const objectValue = parseObject(value, endpoint, path);
  return {
    cardCount: parseRequiredField(objectValue, "cardCount", endpoint, path, parseNonNegativeInteger),
    cardBatchCount: parseRequiredField(objectValue, "cardBatchCount", endpoint, path, parseNonNegativeInteger),
    referencedMediaCount: parseRequiredField(objectValue, "referencedMediaCount", endpoint, path, parseNonNegativeInteger),
    importedMediaAssetCount: parseRequiredField(objectValue, "importedMediaAssetCount", endpoint, path, parseNonNegativeInteger),
    appliedMediaAssetCount: parseRequiredField(objectValue, "appliedMediaAssetCount", endpoint, path, parseNonNegativeInteger),
    keptTagCount: parseRequiredField(objectValue, "keptTagCount", endpoint, path, parseNonNegativeInteger),
    removedTagCount: parseRequiredField(objectValue, "removedTagCount", endpoint, path, parseNonNegativeInteger),
    importTag: parseRequiredField(objectValue, "importTag", endpoint, path, parseNullableString),
  };
}

export function parseWorkspacePackageImportPreviewResponse(
  value: unknown,
  endpoint: string,
): WorkspacePackageImportPreviewResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    sourceKind: parseLiteral(
      parseRequiredField(objectValue, "sourceKind", endpoint, "", parseString),
      endpoint,
      "sourceKind",
      "zip",
    ),
    packageMetadata: parseRequiredField(objectValue, "packageMetadata", endpoint, "", parseWorkspacePackageImportPreviewMetadata),
    cardCount: parseRequiredField(objectValue, "cardCount", endpoint, "", parseNonNegativeInteger),
    tagCounts: parseRequiredField(
      objectValue,
      "tagCounts",
      endpoint,
      "",
      (tagCountsValue, tagCountsEndpoint, tagCountsPath) => parseArray(
        tagCountsValue,
        tagCountsEndpoint,
        tagCountsPath,
        parseWorkspacePackageImportPreviewTagCount,
      ),
    ),
    referencedMediaCount: parseRequiredField(objectValue, "referencedMediaCount", endpoint, "", parseNonNegativeInteger),
    packageMediaFileCount: parseRequiredField(objectValue, "packageMediaFileCount", endpoint, "", parseNonNegativeInteger),
    warnings: parseRequiredField(
      objectValue,
      "warnings",
      endpoint,
      "",
      (warningsValue, warningsEndpoint, warningsPath) => parseArray(
        warningsValue,
        warningsEndpoint,
        warningsPath,
        parseWorkspacePackageImportPreviewWarning,
      ),
    ),
    defaultOptions: parseRequiredField(objectValue, "defaultOptions", endpoint, "", parseWorkspacePackageImportDefaultOptions),
  };
}

export function parseWorkspacePackageImportConfirmResponse(
  value: unknown,
  endpoint: string,
): WorkspacePackageImportConfirmResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    cards: parseRequiredField(
      objectValue,
      "cards",
      endpoint,
      "",
      (cardsValue, cardsEndpoint, cardsPath) => parseArray(cardsValue, cardsEndpoint, cardsPath, parseCard),
    ),
    importedMediaAssets: parseRequiredField(
      objectValue,
      "importedMediaAssets",
      endpoint,
      "",
      (mediaAssetsValue, mediaAssetsEndpoint, mediaAssetsPath) => parseArray(
        mediaAssetsValue,
        mediaAssetsEndpoint,
        mediaAssetsPath,
        parseWorkspacePackageImportedMediaAsset,
      ),
    ),
    summary: parseRequiredField(objectValue, "summary", endpoint, "", parseWorkspacePackageImportConfirmSummary),
  };
}
