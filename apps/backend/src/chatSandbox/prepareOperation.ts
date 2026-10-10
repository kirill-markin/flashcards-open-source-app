import { findChatFilePathConflict } from "../chatFiles/paths";
import { cutHeadAtCodePoint } from "../shared/codePointCuts";
import { deriveAnkiPackageFiles, deriveZipEntries } from "./archiveDerivatives";
import {
  findChatFileDerivativeKind,
  maximumChatFilePathBytes,
  maximumDerivativeErrorChars,
  type ChatFileDerivativeKind,
  type ChatSandboxPrepareRequest,
  type ChatSandboxPrepareResponse,
} from "./contract";
import { DerivativeRefusal } from "./derivativeRefusal";
import { deriveDocxText, derivePdfText, deriveXlsxSheets } from "./documentDerivatives";
import { downloadPresignedObject } from "./presignedTransfer";
import { uploadToWriteSlots, type SlotFile } from "./slotUploads";

const sourceLabelByKind: Readonly<Record<ChatFileDerivativeKind, string>> = {
  pdf: "PDF",
  docx: "document",
  xlsx: "workbook",
  zip: "archive",
  apkg: "Anki package",
};

async function deriveFiles(
  kind: ChatFileDerivativeKind,
  path: string,
  bytes: Uint8Array,
): Promise<ReadonlyArray<SlotFile>> {
  if (kind === "pdf") {
    return derivePdfText(path, bytes);
  }

  if (kind === "docx") {
    return deriveDocxText(path, bytes);
  }

  if (kind === "xlsx") {
    return deriveXlsxSheets(path, bytes);
  }

  return kind === "zip" ? deriveZipEntries(path, bytes) : deriveAnkiPackageFiles(path, bytes);
}

/** A parser's own message names what it could not read; a refusal is already phrased for the model. */
function describeFailure(kind: ChatFileDerivativeKind, error: unknown): string {
  const message = error instanceof DerivativeRefusal
    ? error.message
    : `could not read the ${sourceLabelByKind[kind]}: ${error instanceof Error ? error.message : String(error)}`;
  return cutHeadAtCodePoint(message, maximumDerivativeErrorChars);
}

function findDerivedFilesRefusal(files: ReadonlyArray<SlotFile>): string | null {
  const longPath = files.find((file) => Buffer.byteLength(file.path) > maximumChatFilePathBytes);
  if (longPath !== undefined) {
    return `a derived path is longer than ${maximumChatFilePathBytes} bytes: ${cutHeadAtCodePoint(longPath.path, 120)}`;
  }

  const conflict = findChatFilePathConflict(files.map((file) => file.path));
  return conflict === null ? null : `two derived files would share the path ${cutHeadAtCodePoint(conflict, 120)}`;
}

/**
 * Turns one attachment into the plain files the model reads with bash. Everything is derived in memory
 * before the first upload, so a file that fails or crosses a limit uploads nothing. A failed download or
 * upload fails the call instead, because it says nothing about the file.
 */
export async function runChatSandboxPrepare(request: ChatSandboxPrepareRequest): Promise<ChatSandboxPrepareResponse> {
  const kind = findChatFileDerivativeKind(request.file.mediaType);
  if (kind === null) {
    throw new Error(`Nothing is derived from this media type. path=${request.file.path} mediaType=${request.file.mediaType}`);
  }

  const bytes = await downloadPresignedObject(request.file.getUrl, request.file.path, request.file.sizeBytes);
  let files: ReadonlyArray<SlotFile>;
  try {
    files = await deriveFiles(kind, request.file.path, bytes);
  } catch (error) {
    return { outcome: "failed", error: describeFailure(kind, error) };
  }

  const refusal = findDerivedFilesRefusal(files);
  if (refusal !== null) {
    return { outcome: "failed", error: cutHeadAtCodePoint(refusal, maximumDerivativeErrorChars) };
  }

  if (files.length > request.writeSlots.length) {
    throw new Error(
      `The worker issued fewer write slots than this kind can yield. kind=${kind} fileCount=${files.length} slotCount=${request.writeSlots.length}`,
    );
  }

  return { outcome: "prepared", derivedFiles: [...await uploadToWriteSlots(files, request.writeSlots)] };
}
