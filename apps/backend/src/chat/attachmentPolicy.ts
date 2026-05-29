import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
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

const strictStandardBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const pdfEndMarker = Buffer.from("%%EOF", "ascii");
const zipLocalFileHeaderSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const zipEndOfCentralDirectorySignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const minimumOleCompoundFileByteLength = 512;
const textLikeFileMediaTypes: ReadonlySet<string> = new Set([
  "application/json",
  "application/typescript",
  "application/x-yaml",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/x-python",
  "text/xml",
]);
const utf8TextDecoder = new TextDecoder("utf-8", { fatal: true });

type DecodedAttachmentData = Readonly<{
  base64Data: string;
  decodedData: Buffer;
}>;

export type ValidatedChatAttachmentContent = Readonly<{
  mediaType: string;
  base64Data: string;
}>;

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

function isDataUrlBase64Payload(base64Data: string): boolean {
  const lowerCaseValue = base64Data.toLowerCase();
  return lowerCaseValue.startsWith("data:") || lowerCaseValue.includes(";base64,");
}

function decodeStrictStandardBase64(base64Data: string): DecodedAttachmentData {
  const trimmedBase64Data = base64Data.trim();
  if (
    trimmedBase64Data === ""
    || isDataUrlBase64Payload(trimmedBase64Data)
    || !strictStandardBase64Pattern.test(trimmedBase64Data)
  ) {
    throwUnsupportedChatAttachmentType();
  }

  const decodedData = Buffer.from(trimmedBase64Data, "base64");
  if (decodedData.length === 0 || decodedData.toString("base64") !== trimmedBase64Data) {
    throwUnsupportedChatAttachmentType();
  }

  return {
    base64Data: trimmedBase64Data,
    decodedData,
  };
}

function startsWithBytes(data: Buffer, expectedBytes: ReadonlyArray<number>): boolean {
  if (data.length < expectedBytes.length) {
    return false;
  }

  return expectedBytes.every((expectedByte, index) => data[index] === expectedByte);
}

function endsWithBytes(data: Buffer, expectedBytes: ReadonlyArray<number>): boolean {
  if (data.length < expectedBytes.length) {
    return false;
  }

  const startIndex = data.length - expectedBytes.length;
  return expectedBytes.every((expectedByte, index) => data[startIndex + index] === expectedByte);
}

function hasPngSignature(data: Buffer): boolean {
  return startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function hasJpegSignature(data: Buffer): boolean {
  return startsWithBytes(data, [0xff, 0xd8, 0xff]);
}

function hasGifSignature(data: Buffer): boolean {
  return startsWithBytes(data, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || startsWithBytes(data, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
}

function hasWebpSignature(data: Buffer): boolean {
  return data.length >= 12
    && startsWithBytes(data, [0x52, 0x49, 0x46, 0x46])
    && startsWithBytes(data.subarray(8), [0x57, 0x45, 0x42, 0x50]);
}

function hasPdfSignature(data: Buffer): boolean {
  return startsWithBytes(data, [0x25, 0x50, 0x44, 0x46, 0x2d]);
}

function hasZipSignature(data: Buffer): boolean {
  return startsWithBytes(data, [0x50, 0x4b, 0x03, 0x04])
    || startsWithBytes(data, [0x50, 0x4b, 0x05, 0x06])
    || startsWithBytes(data, [0x50, 0x4b, 0x07, 0x08]);
}

function hasOleCompoundFileSignature(data: Buffer): boolean {
  return startsWithBytes(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function hasPdfStructure(data: Buffer): boolean {
  const pdfTailSearchStart = Math.max(0, data.length - 2048);
  return data.length >= 20
    && hasPdfSignature(data)
    && data.subarray(pdfTailSearchStart).indexOf(pdfEndMarker) >= 0;
}

function hasPngStructure(data: Buffer): boolean {
  if (!hasPngSignature(data)) {
    return false;
  }

  let offset = 8;
  let hasImageHeader = false;
  while (offset + 12 <= data.length) {
    const chunkLength = data.readUInt32BE(offset);
    const chunkTypeStart = offset + 4;
    const chunkDataStart = offset + 8;
    const nextOffset = chunkDataStart + chunkLength + 4;
    if (nextOffset > data.length || nextOffset <= offset) {
      return false;
    }

    const chunkType = data.toString("ascii", chunkTypeStart, chunkTypeStart + 4);
    if (!hasImageHeader) {
      if (chunkType !== "IHDR" || chunkLength !== 13) {
        return false;
      }
      hasImageHeader = true;
    }

    if (chunkType === "IEND") {
      return hasImageHeader && chunkLength === 0 && nextOffset === data.length;
    }

    offset = nextOffset;
  }

  return false;
}

function hasJpegStructure(data: Buffer): boolean {
  return data.length >= 4
    && hasJpegSignature(data)
    && endsWithBytes(data, [0xff, 0xd9]);
}

function hasGifStructure(data: Buffer): boolean {
  return data.length >= 14
    && hasGifSignature(data)
    && endsWithBytes(data, [0x3b]);
}

function hasWebpStructure(data: Buffer): boolean {
  if (!hasWebpSignature(data) || data.length < 20) {
    return false;
  }

  const riffPayloadLength = data.readUInt32LE(4);
  if (riffPayloadLength + 8 !== data.length) {
    return false;
  }

  const firstChunkType = data.toString("ascii", 12, 16);
  if (firstChunkType !== "VP8 " && firstChunkType !== "VP8L" && firstChunkType !== "VP8X") {
    return false;
  }

  const firstChunkPayloadLength = data.readUInt32LE(16);
  const firstChunkEnd = 20 + firstChunkPayloadLength + (firstChunkPayloadLength % 2);
  return firstChunkEnd <= data.length;
}

function hasZipEndOfCentralDirectory(data: Buffer): boolean {
  const maximumEndRecordSearchLength = 65_557;
  const searchStart = Math.max(0, data.length - maximumEndRecordSearchLength);
  return data.subarray(searchStart).indexOf(zipEndOfCentralDirectorySignature) >= 0;
}

function readZipLocalFileNames(data: Buffer): ReadonlySet<string> {
  const fileNames = new Set<string>();
  let searchOffset = 0;

  while (searchOffset < data.length) {
    const headerOffset = data.indexOf(zipLocalFileHeaderSignature, searchOffset);
    if (headerOffset < 0) {
      return fileNames;
    }

    if (headerOffset + 30 > data.length) {
      return fileNames;
    }

    const generalPurposeBitFlag = data.readUInt16LE(headerOffset + 6);
    const compressedSize = data.readUInt32LE(headerOffset + 18);
    const fileNameLength = data.readUInt16LE(headerOffset + 26);
    const extraFieldLength = data.readUInt16LE(headerOffset + 28);
    const fileNameStart = headerOffset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const entryDataStart = fileNameEnd + extraFieldLength;
    const hasDataDescriptor = (generalPurposeBitFlag & 0x08) !== 0;
    const nextOffset = hasDataDescriptor ? entryDataStart : entryDataStart + compressedSize;
    if (
      fileNameLength === 0
      || fileNameEnd > data.length
      || entryDataStart > data.length
      || nextOffset > data.length
      || nextOffset <= headerOffset
    ) {
      return fileNames;
    }

    fileNames.add(data.toString("utf8", fileNameStart, fileNameEnd));
    searchOffset = nextOffset;
  }

  return fileNames;
}

function hasOpenXmlPackageStructure(data: Buffer, requiredEntryName: string): boolean {
  if (!hasZipSignature(data) || !hasZipEndOfCentralDirectory(data)) {
    return false;
  }

  const fileNames = readZipLocalFileNames(data);
  return fileNames.has("[Content_Types].xml") && fileNames.has(requiredEntryName);
}

function hasOleCompoundFileStructure(data: Buffer): boolean {
  return data.length >= minimumOleCompoundFileByteLength && hasOleCompoundFileSignature(data);
}

function hasUtf16ByteOrderMark(data: Buffer): boolean {
  return data.length >= 4
    && data.length % 2 === 0
    && (
      startsWithBytes(data, [0xff, 0xfe])
      || startsWithBytes(data, [0xfe, 0xff])
    );
}

function hasOnlyTextControlBytes(data: Buffer): boolean {
  return data.every((byte) => byte >= 0x20
    || byte === 0x09
    || byte === 0x0a
    || byte === 0x0c
    || byte === 0x0d);
}

function isUtf8TextData(data: Buffer): boolean {
  if (!hasOnlyTextControlBytes(data)) {
    return false;
  }

  try {
    utf8TextDecoder.decode(data);
    return true;
  } catch {
    return false;
  }
}

function isSingleByteTextData(data: Buffer): boolean {
  return hasOnlyTextControlBytes(data);
}

function assertTextLikeAttachmentData(data: Buffer): void {
  if (isUtf8TextData(data) || hasUtf16ByteOrderMark(data) || isSingleByteTextData(data)) {
    return;
  }

  throwUnsupportedChatAttachmentType();
}

function assertChatImageAttachmentData(mediaType: string, decodedData: Buffer): void {
  if (mediaType === "image/png" && hasPngStructure(decodedData)) {
    return;
  }

  if (mediaType === "image/jpeg" && hasJpegStructure(decodedData)) {
    return;
  }

  if (mediaType === "image/gif" && hasGifStructure(decodedData)) {
    return;
  }

  if (mediaType === "image/webp" && hasWebpStructure(decodedData)) {
    return;
  }

  throwUnsupportedChatAttachmentType();
}

function assertChatFileAttachmentData(mediaType: string, decodedData: Buffer): void {
  if (mediaType === "application/pdf") {
    if (hasPdfStructure(decodedData)) {
      return;
    }

    throwUnsupportedChatAttachmentType();
  }

  if (mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (hasOpenXmlPackageStructure(decodedData, "word/document.xml")) {
      return;
    }

    throwUnsupportedChatAttachmentType();
  }

  if (mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    if (hasOpenXmlPackageStructure(decodedData, "xl/workbook.xml")) {
      return;
    }

    throwUnsupportedChatAttachmentType();
  }

  if (mediaType === "application/vnd.ms-excel") {
    if (hasOleCompoundFileStructure(decodedData)) {
      return;
    }

    throwUnsupportedChatAttachmentType();
  }

  if (textLikeFileMediaTypes.has(mediaType)) {
    assertTextLikeAttachmentData(decodedData);
    return;
  }

  throwUnsupportedChatAttachmentType();
}

export function validateChatImageAttachmentContent(
  mediaType: string,
  base64Data: string,
): ValidatedChatAttachmentContent {
  const canonicalMediaType = normalizeChatImageAttachmentMediaType(mediaType);
  const decodedAttachment = decodeStrictStandardBase64(base64Data);
  assertChatImageAttachmentData(canonicalMediaType, decodedAttachment.decodedData);

  return {
    mediaType: canonicalMediaType,
    base64Data: decodedAttachment.base64Data,
  };
}

export function validateChatFileAttachmentContent(
  fileName: string,
  mediaType: string,
  base64Data: string,
): ValidatedChatAttachmentContent {
  const canonicalMediaType = normalizeChatFileAttachmentMediaType(fileName, mediaType);
  const decodedAttachment = decodeStrictStandardBase64(base64Data);
  assertChatFileAttachmentData(canonicalMediaType, decodedAttachment.decodedData);

  return {
    mediaType: canonicalMediaType,
    base64Data: decodedAttachment.base64Data,
  };
}

export function isChatAttachmentUnsupportedTypeError(error: unknown): boolean {
  return error instanceof HttpError && error.code === chatAttachmentUnsupportedTypeCode;
}
