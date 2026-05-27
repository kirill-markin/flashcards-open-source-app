import { HttpError } from "../shared/errors";

export const chatAttachmentUnsupportedTypeCode = "CHAT_ATTACHMENT_UNSUPPORTED_TYPE";
export const chatAttachmentUnsupportedTypeMessage = "This file type is not supported for AI chat. Remove the file or save it as PDF, TXT, CSV, JSON, XML, Markdown, HTML, Python, JavaScript, TypeScript, YAML, XLS/XLSX, DOCX, or an image, then try again.";

const canonicalFileMediaTypeByExtension: Readonly<Record<string, string>> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
  js: "text/javascript",
  json: "application/json",
  log: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  py: "text/x-python",
  sql: "text/plain",
  ts: "application/typescript",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "text/xml",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
};

const canonicalFileMediaTypes = new Set(Object.values(canonicalFileMediaTypeByExtension));

const canonicalFileMediaTypeByAlias: Readonly<Record<string, string>> = {
  "application/csv": "text/csv",
  "application/javascript": "text/javascript",
  "application/x-javascript": "text/javascript",
  "application/x-sql": "text/plain",
  "application/x-typescript": "application/typescript",
  "text/comma-separated-values": "text/csv",
  "text/javascript": "text/javascript",
  "text/typescript": "application/typescript",
  "text/x-markdown": "text/markdown",
  "text/x-sql": "text/plain",
  "text/x-typescript": "application/typescript",
  "text/x-yaml": "application/x-yaml",
  "application/xml": "text/xml",
  "text/xml": "text/xml",
  "text/yaml": "application/x-yaml",
};

const canonicalImageMediaTypeByAlias: Readonly<Record<string, string>> = {
  "image/gif": "image/gif",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

function throwUnsupportedChatAttachmentType(): never {
  throw new HttpError(
    400,
    chatAttachmentUnsupportedTypeMessage,
    chatAttachmentUnsupportedTypeCode,
  );
}

function normalizeRawMediaType(mediaType: string): string {
  return mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function fileExtensionFromName(fileName: string): string | null {
  const normalizedFileName = fileName.trim().split(/[\\/]/).pop() ?? "";
  const extensionStartIndex = normalizedFileName.lastIndexOf(".");
  if (extensionStartIndex < 0 || extensionStartIndex === normalizedFileName.length - 1) {
    return null;
  }

  return normalizedFileName.slice(extensionStartIndex + 1).trim().toLowerCase() || null;
}

export function normalizeChatFileAttachmentMediaType(
  fileName: string,
  mediaType: string,
): string {
  const fileExtension = fileExtensionFromName(fileName);
  if (fileExtension !== null) {
    const canonicalByExtension = canonicalFileMediaTypeByExtension[fileExtension];
    if (canonicalByExtension !== undefined) {
      return canonicalByExtension;
    }

    throwUnsupportedChatAttachmentType();
  }

  const normalizedMediaType = normalizeRawMediaType(mediaType);
  const canonicalByAlias = canonicalFileMediaTypeByAlias[normalizedMediaType];
  if (canonicalByAlias !== undefined) {
    return canonicalByAlias;
  }

  if (canonicalFileMediaTypes.has(normalizedMediaType)) {
    return normalizedMediaType;
  }

  throwUnsupportedChatAttachmentType();
}

export function normalizeChatImageAttachmentMediaType(mediaType: string): string {
  const normalizedMediaType = normalizeRawMediaType(mediaType);
  const canonicalMediaType = canonicalImageMediaTypeByAlias[normalizedMediaType];
  if (canonicalMediaType !== undefined) {
    return canonicalMediaType;
  }

  throwUnsupportedChatAttachmentType();
}
