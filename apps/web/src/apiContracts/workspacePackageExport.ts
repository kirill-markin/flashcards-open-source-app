import {
  workspaceAnkiExportContentType,
  workspaceAnkiExportFilename,
  workspacePackageExportFilename,
  type WorkspaceAnkiExportDownload,
  type WorkspacePackageExportDefaultPackageMetadata,
  type WorkspacePackageExportDownloadMetadata,
  type WorkspacePackageExportPreviewResponse,
  type WorkspacePackageExportTagCount,
} from "../types";
import {
  ApiContractError,
  parseArray,
  parseLiteral,
  parseNonNegativeInteger,
  parseObject,
  parseOptionalField,
  parseRequiredField,
  parseString,
} from "./core";

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
    return workspacePackageExportFilename;
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
    return workspacePackageExportFilename;
  }

  const parameters = contentDisposition.split(";").slice(1);
  const filenameParameter = parameters.find((parameter: string): boolean => {
    const [key] = parameter.split("=", 1);
    return key?.trim().toLowerCase() === "filename";
  });
  if (filenameParameter === undefined) {
    return workspacePackageExportFilename;
  }

  const valueStartIndex = filenameParameter.indexOf("=");
  if (valueStartIndex < 0) {
    return workspacePackageExportFilename;
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

function parseAnkiExportDownloadUrl(value: unknown, endpoint: string, path: string): string {
  const downloadUrl = parseString(value, endpoint, path);
  let url: URL;
  try {
    url = new URL(downloadUrl);
  } catch {
    throw new ApiContractError(endpoint, path, "an absolute URL");
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new ApiContractError(endpoint, path, "an HTTPS URL without embedded credentials");
  }

  return downloadUrl;
}

export function parseWorkspaceAnkiExportDownload(value: unknown, endpoint: string): WorkspaceAnkiExportDownload {
  const objectValue = parseObject(value, endpoint, "");
  return {
    downloadUrl: parseRequiredField(objectValue, "downloadUrl", endpoint, "", parseAnkiExportDownloadUrl),
    filename: parseLiteral(objectValue.fileName, endpoint, "fileName", workspaceAnkiExportFilename),
    contentType: parseLiteral(objectValue.contentType, endpoint, "contentType", workspaceAnkiExportContentType),
  };
}
