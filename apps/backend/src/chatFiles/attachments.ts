import { createHash, randomUUID } from "node:crypto";
import type { DatabaseExecutor, WorkspaceDatabaseScope } from "../database";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import type { BackendObservationScope } from "../observability/sentry";
import {
  validateChatFileAttachmentContent,
  validateChatImageAttachmentContent,
} from "../chat/attachmentPolicy";
import type {
  ContentPart,
  FileContentPart,
  ImageContentPart,
  InlineAttachmentContentPart,
  UnconvertedContentPart,
  UploadContentPart,
} from "../chat/types";
import { allocateChatFilePath } from "./paths";
import { insertChatAttachmentFileWithExecutor, listChatFilePathsWithExecutor, type StoredContent } from "./repository";
import { buildChatFileS3Key, putChatFileObject } from "./storage";
import {
  assertChatImageUploadsPerTurnSize,
  headChatFileUpload,
  readChatFileUpload,
  type StagedChatFileUpload,
} from "./uploads";

/** One attachment whose bytes are stored and whose `ai.chat_files` row is not yet inserted. */
export type UploadedChatAttachment = Readonly<{
  fileId: string;
  s3Key: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}> & (Readonly<{ type: "image" }> | Readonly<{ type: "file"; fileName: string }>);

type ChatAttachmentReference = ImageContentPart | FileContentPart;

type TurnAttachmentContentPart = InlineAttachmentContentPart | UploadContentPart;

type OrphanedUploadReason =
  | "upload_failed"
  | "write_failed"
  | "already_converted"
  | "sandbox_unconfirmed"
  | "path_taken";

export function isInlineAttachmentContentPart(
  part: ContentPart | InlineAttachmentContentPart,
): part is InlineAttachmentContentPart {
  return (part.type === "image" || part.type === "file") && "base64Data" in part;
}

/** Identical inline attachments share one key, so they become one session file. */
function buildInlineAttachmentKey(part: InlineAttachmentContentPart): string {
  return JSON.stringify([part.type, part.mediaType, part.type === "file" ? part.fileName : null, part.base64Data]);
}

export function collectInlineAttachments(
  contents: ReadonlyArray<StoredContent>,
): ReadonlyMap<string, InlineAttachmentContentPart> {
  const attachments = new Map<string, InlineAttachmentContentPart>();
  for (const content of contents) {
    for (const part of content) {
      if (!isInlineAttachmentContentPart(part)) {
        continue;
      }

      const key = buildInlineAttachmentKey(part);
      if (!attachments.has(key)) {
        attachments.set(key, part);
      }
    }
  }

  return attachments;
}

/** `error` is null when nothing failed and another writer converted the same attachments first. */
export function logOrphanedChatFileUploads(
  observationScope: BackendObservationScope,
  uploads: ReadonlyArray<Readonly<{ s3Key: string }>>,
  reason: OrphanedUploadReason,
  error: unknown,
): void {
  if (uploads.length === 0) {
    return;
  }

  writeCloudWatchRecord({
    action: "chat_file_upload_orphaned",
    message: "Stored chat file objects are left without an ai.chat_files row.",
    scope: observationScope,
    details: {
      s3Keys: uploads.map((upload) => upload.s3Key),
      reason,
      errorClass: error === null ? null : error instanceof Error ? error.name : "UnknownError",
      errorMessage: error === null ? null : error instanceof Error ? error.message : String(error),
    },
  }, "warning");
}

export type DecodedChatAttachment = Readonly<{
  mediaType: string;
  bytes: Buffer;
}> & (Readonly<{ type: "image" }> | Readonly<{ type: "file"; fileName: string }>);

/** Validates with the chat attachment policy, which also canonicalizes the media type. */
export function decodeInlineChatAttachment(part: InlineAttachmentContentPart): DecodedChatAttachment {
  if (part.type === "image") {
    const attachment = validateChatImageAttachmentContent(part.mediaType, part.base64Data);
    return { type: "image", mediaType: attachment.mediaType, bytes: Buffer.from(attachment.base64Data, "base64") };
  }

  const attachment = validateChatFileAttachmentContent(part.fileName, part.mediaType, part.base64Data);
  return {
    type: "file",
    fileName: part.fileName,
    mediaType: attachment.mediaType,
    bytes: Buffer.from(attachment.base64Data, "base64"),
  };
}

async function uploadDecodedChatAttachment(
  sessionId: string,
  attachment: DecodedChatAttachment,
): Promise<UploadedChatAttachment> {
  const fileId = randomUUID();
  const s3Key = buildChatFileS3Key(sessionId, fileId);
  await putChatFileObject(s3Key, attachment.bytes, attachment.mediaType);
  const stored = {
    fileId,
    s3Key,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.bytes.length,
    sha256: createHash("sha256").update(attachment.bytes).digest("hex"),
  };

  return attachment.type === "image"
    ? { ...stored, type: "image" }
    : { ...stored, type: "file", fileName: attachment.fileName };
}

export async function uploadInlineChatAttachments(
  sessionId: string,
  attachments: ReadonlyMap<string, DecodedChatAttachment>,
  observationScope: BackendObservationScope,
): Promise<ReadonlyMap<string, UploadedChatAttachment>> {
  const keys = [...attachments.keys()];
  const results = await Promise.allSettled(
    [...attachments.values()].map((attachment) => uploadDecodedChatAttachment(sessionId, attachment)),
  );
  const uploads = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure !== undefined) {
    logOrphanedChatFileUploads(observationScope, uploads, "upload_failed", failure.reason);
    throw failure.reason;
  }

  return new Map(uploads.map((upload, index) => [keys[index], upload]));
}

function toChatAttachmentReference(upload: UploadedChatAttachment, path: string): ChatAttachmentReference {
  const reference = {
    fileId: upload.fileId,
    path,
    mediaType: upload.mediaType,
    sizeBytes: upload.sizeBytes,
  };

  return upload.type === "image"
    ? { type: "image", ...reference }
    : { type: "file", ...reference, fileName: upload.fileName };
}

/**
 * Inserts one `attachment` row per stored upload under a path free in the session. Callers hold the
 * session row lock, which is what keeps two writers from allocating the same path.
 */
export async function recordUploadedChatAttachmentsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  uploads: ReadonlyMap<string, UploadedChatAttachment>,
): Promise<ReadonlyMap<string, ChatAttachmentReference>> {
  const takenPaths = new Set(await listChatFilePathsWithExecutor(executor, scope, sessionId));
  const references = new Map<string, ChatAttachmentReference>();
  for (const [key, upload] of uploads) {
    const path = allocateChatFilePath(upload, takenPaths);
    takenPaths.add(path);
    await insertChatAttachmentFileWithExecutor(executor, scope, {
      fileId: upload.fileId,
      sessionId,
      path,
      mediaType: upload.mediaType,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      s3Key: upload.s3Key,
    });
    references.set(key, toChatAttachmentReference(upload, path));
  }

  return references;
}

export function replaceInlineAttachments(
  content: StoredContent,
  references: ReadonlyMap<string, ChatAttachmentReference>,
): ReadonlyArray<ContentPart> {
  return content.map((part) => {
    if (!isInlineAttachmentContentPart(part)) {
      return part;
    }

    const reference = references.get(buildInlineAttachmentKey(part));
    if (reference === undefined) {
      throw new Error(`Inline chat attachment has no session file to replace it. type=${part.type} mediaType=${part.mediaType}`);
    }

    return reference;
  });
}

/** In a new turn every image or file part is inline. */
function isTurnAttachmentContentPart(part: UnconvertedContentPart): part is TurnAttachmentContentPart {
  return part.type === "image" || part.type === "file" || part.type === "upload";
}

/** Identical parts share one key, so they become one session file. */
function buildTurnAttachmentKey(part: TurnAttachmentContentPart): string {
  return part.type === "upload"
    ? JSON.stringify([part.type, part.uploadId, part.fileName, part.mediaType])
    : buildInlineAttachmentKey(part);
}

async function headTurnAttachment(
  userId: string,
  part: TurnAttachmentContentPart,
): Promise<InlineAttachmentContentPart | StagedChatFileUpload> {
  return part.type === "upload" ? headChatFileUpload(userId, part) : part;
}

async function decodeTurnAttachment(
  attachment: InlineAttachmentContentPart | StagedChatFileUpload,
): Promise<DecodedChatAttachment> {
  return attachment.type === "upload" ? readChatFileUpload(attachment) : decodeInlineChatAttachment(attachment);
}

function replaceTurnAttachments(
  content: ReadonlyArray<UnconvertedContentPart>,
  references: ReadonlyMap<string, ChatAttachmentReference>,
): ReadonlyArray<ContentPart> {
  return content.map((part) => {
    if (!isTurnAttachmentContentPart(part)) {
      return part;
    }

    const reference = references.get(buildTurnAttachmentKey(part));
    if (reference === undefined) {
      throw new Error(`Chat attachment has no session file to replace it. type=${part.type} mediaType=${part.mediaType}`);
    }

    return reference;
  });
}

/**
 * First half of turning a new turn's attachments, inline or staged uploads, into session files: stores
 * their bytes. Every upload is sized before the first one is downloaded, so an oversized turn downloads
 * nothing, and every attachment is validated before the first one is stored, so an invalid one stores
 * nothing.
 */
export async function uploadTurnChatAttachments(
  sessionId: string,
  userId: string,
  content: ReadonlyArray<UnconvertedContentPart>,
  observationScope: BackendObservationScope,
): Promise<ReadonlyMap<string, UploadedChatAttachment>> {
  const parts = new Map(
    content.filter(isTurnAttachmentContentPart).map((part) => [buildTurnAttachmentKey(part), part]),
  );
  const headed = await Promise.all([...parts].map(async ([key, part]) => (
    [key, await headTurnAttachment(userId, part)] as const
  )));
  assertChatImageUploadsPerTurnSize(headed.flatMap(([, attachment]) => (
    attachment.type === "upload" ? [attachment] : []
  )));
  const attachments = await Promise.all(headed.map(async ([key, attachment]) => (
    [key, await decodeTurnAttachment(attachment)] as const
  )));
  return uploadInlineChatAttachments(sessionId, new Map(attachments), observationScope);
}

/**
 * Second half: inserts the `ai.chat_files` rows and returns the turn with reference parts in place of the
 * bytes. Runs inside the transaction that persists the turn and holds the session row lock.
 */
export async function recordTurnChatAttachmentsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  content: ReadonlyArray<UnconvertedContentPart>,
  uploads: ReadonlyMap<string, UploadedChatAttachment>,
): Promise<ReadonlyArray<ContentPart>> {
  if (uploads.size === 0) {
    return replaceTurnAttachments(content, new Map());
  }

  return replaceTurnAttachments(
    content,
    await recordUploadedChatAttachmentsWithExecutor(executor, scope, sessionId, uploads),
  );
}
