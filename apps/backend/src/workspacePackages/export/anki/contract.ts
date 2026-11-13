export const ankiExportFileName = "flashcards.apkg";
export const ankiExportContentType = "application/apkg";

// API Gateway base64-encodes the binary body inside Lambda's buffered response.
export const ankiExportMaxInlineBytes = 4 * 1024 * 1024;

export type AnkiWorkspacePackage = Readonly<{
  fileName: typeof ankiExportFileName;
  contentType: typeof ankiExportContentType;
  bytes: Uint8Array<ArrayBuffer>;
}>;
