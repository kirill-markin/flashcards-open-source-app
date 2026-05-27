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

export class ChatAttachmentUnsupportedTypeError extends Error {
  constructor() {
    super("AI chat attachment file type is unsupported.");
    this.name = "ChatAttachmentUnsupportedTypeError";
  }
}

function fileExtensionFromName(fileName: string): string | null {
  const normalizedFileName = fileName.trim().split(/[\\/]/).pop() ?? "";
  const extensionStartIndex = normalizedFileName.lastIndexOf(".");
  if (extensionStartIndex < 0 || extensionStartIndex === normalizedFileName.length - 1) {
    return null;
  }

  return normalizedFileName.slice(extensionStartIndex + 1).trim().toLowerCase() || null;
}

function normalizeRawMediaType(mediaType: string): string {
  return mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function normalizeChatAttachmentFileMediaType(
  fileName: string,
  mediaType: string,
): string {
  const fileExtension = fileExtensionFromName(fileName);
  if (fileExtension !== null) {
    const canonicalByExtension = canonicalFileMediaTypeByExtension[fileExtension];
    if (canonicalByExtension !== undefined) {
      return canonicalByExtension;
    }

    throw new ChatAttachmentUnsupportedTypeError();
  }

  const normalizedMediaType = normalizeRawMediaType(mediaType);
  const canonicalByAlias = canonicalFileMediaTypeByAlias[normalizedMediaType];
  if (canonicalByAlias !== undefined) {
    return canonicalByAlias;
  }

  if (canonicalFileMediaTypes.has(normalizedMediaType)) {
    return normalizedMediaType;
  }

  throw new ChatAttachmentUnsupportedTypeError();
}

export function isChatAttachmentUnsupportedTypeError(error: unknown): boolean {
  return error instanceof ChatAttachmentUnsupportedTypeError;
}
