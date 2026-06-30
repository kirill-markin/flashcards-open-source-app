import type {
  WorkspacePackageExportDefaultPackageMetadata,
  WorkspacePackageExportDownloadMetadata,
  WorkspacePackageExportPreviewResponse,
  WorkspacePackageExportTagCount,
} from "../types";
import {
  parseArray,
  parseNonNegativeInteger,
  parseObject,
  parseOptionalField,
  parseRequiredField,
  parseString,
} from "./core";

const defaultWorkspacePackageExportFilename = "flashcards.zip";
const defaultWorkspacePackageExportContentType = "application/octet-stream";
const unsafeFilenamePattern = /[/\\\u0000-\u001f\u007f]/u;

function parseWorkspacePackageExportTagCount(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageExportTagCount {
  const objectValue = parseObject(value, endpoint, path);
  return {
    tag: parseRequiredField(objectValue, "tag", endpoint, path, parseString),
    cardsCount: parseRequiredField(objectValue, "cardsCount", endpoint, path, parseNonNegativeInteger),
  };
}

function parseWorkspacePackageExportDefaultPackageMetadata(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspacePackageExportDefaultPackageMetadata {
  const objectValue = parseObject(value, endpoint, path);
  const author = parseOptionalField(objectValue, "author", endpoint, path, parseString);
  const comment = parseOptionalField(objectValue, "comment", endpoint, path, parseString);
  const sourceUrl = parseOptionalField(objectValue, "sourceUrl", endpoint, path, parseString);

  return {
    label: parseRequiredField(objectValue, "label", endpoint, path, parseString),
    ...(author === undefined ? {} : { author }),
    ...(comment === undefined ? {} : { comment }),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  };
}

function sanitizeDownloadFilename(filename: string): string {
  const trimmedFilename = filename.trim();
  if (trimmedFilename === "" || unsafeFilenamePattern.test(trimmedFilename)) {
    return defaultWorkspacePackageExportFilename;
  }

  return trimmedFilename;
}

function unquoteContentDispositionValue(value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length >= 2 && trimmedValue.startsWith("\"") && trimmedValue.endsWith("\"")) {
    return trimmedValue.slice(1, -1).replace(/\\(["\\])/gu, "$1");
  }

  return trimmedValue;
}

function parseContentDispositionFilename(contentDisposition: string | null): string {
  if (contentDisposition === null) {
    return defaultWorkspacePackageExportFilename;
  }

  const parameters = contentDisposition.split(";").slice(1);
  const filenameParameter = parameters.find((parameter: string): boolean => {
    const [key] = parameter.split("=", 1);
    return key?.trim().toLowerCase() === "filename";
  });
  if (filenameParameter === undefined) {
    return defaultWorkspacePackageExportFilename;
  }

  const valueStartIndex = filenameParameter.indexOf("=");
  if (valueStartIndex < 0) {
    return defaultWorkspacePackageExportFilename;
  }

  return sanitizeDownloadFilename(unquoteContentDispositionValue(filenameParameter.slice(valueStartIndex + 1)));
}

function parseResponseContentType(headers: Headers): string {
  const contentType = headers.get("Content-Type");
  if (contentType === null || contentType.trim() === "") {
    return defaultWorkspacePackageExportContentType;
  }

  return contentType;
}

export function parseWorkspacePackageExportPreviewResponse(
  value: unknown,
  endpoint: string,
): WorkspacePackageExportPreviewResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    selectedCardCount: parseRequiredField(objectValue, "selectedCardCount", endpoint, "", parseNonNegativeInteger),
    availableTagCounts: parseRequiredField(
      objectValue,
      "availableTagCounts",
      endpoint,
      "",
      (tagCountsValue, tagCountsEndpoint, tagCountsPath) => parseArray(
        tagCountsValue,
        tagCountsEndpoint,
        tagCountsPath,
        parseWorkspacePackageExportTagCount,
      ),
    ),
    tagsSelectedForRemoval: parseRequiredField(
      objectValue,
      "tagsSelectedForRemoval",
      endpoint,
      "",
      (tagCountsValue, tagCountsEndpoint, tagCountsPath) => parseArray(
        tagCountsValue,
        tagCountsEndpoint,
        tagCountsPath,
        parseWorkspacePackageExportTagCount,
      ),
    ),
    referencedMediaCount: parseRequiredField(objectValue, "referencedMediaCount", endpoint, "", parseNonNegativeInteger),
    approximateReferencedMediaBytes: parseRequiredField(
      objectValue,
      "approximateReferencedMediaBytes",
      endpoint,
      "",
      parseNonNegativeInteger,
    ),
    defaultPackageMetadata: parseRequiredField(
      objectValue,
      "defaultPackageMetadata",
      endpoint,
      "",
      parseWorkspacePackageExportDefaultPackageMetadata,
    ),
  };
}

export function parseWorkspacePackageExportDownloadMetadata(headers: Headers): WorkspacePackageExportDownloadMetadata {
  return {
    filename: parseContentDispositionFilename(headers.get("Content-Disposition")),
    contentType: parseResponseContentType(headers),
  };
}
