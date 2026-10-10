/**
 * An attachment whose bytes travel outside the 5 MiB `POST /chat` body. The client asks
 * `POST /chat/files/uploads` for a pre-signed PUT, uploads the bytes to a staged key, and names the upload
 * in an `upload` part of `POST /chat`. The turn validates the bytes like an inline attachment and stores
 * them as a session file.
 */
import { randomUUID } from "node:crypto";
import {
  assertChatUploadAttachmentBytes,
  normalizeChatUploadAttachmentType,
  type ChatUploadAttachmentType,
} from "../chat/attachmentPolicy";
import type { UploadContentPart } from "../chat/types";
import { HttpError } from "../shared/errors";
import type { DecodedChatAttachment } from "./attachments";
import {
  buildChatFileUploadS3Key,
  createChatFileUploadPutUrl,
  getChatFileObjectBytes,
  headChatFileObjectSize,
} from "./storage";

const mebibyte = 1024 * 1024;
const chatFileUploadMaximumBytes = 30 * mebibyte;
/** An image travels base64-encoded in every later model call of its session, so it gets the cap `view_file` applies. */
const chatImageUploadMaximumBytes = 10 * mebibyte;
/** For the same reason a turn's uploaded images share a budget; inline images are bounded by the `POST /chat` body. */
const chatImageUploadsPerTurnMaximumBytes = 15 * mebibyte;
/** A turn downloads and stores every upload it names while it holds the session row lock. */
const chatMaximumUploadsPerTurn = 10;
const chatFileUploadUrlExpiresSeconds = 15 * 60;

export const chatFileUploadTooLargeCode = "CHAT_FILE_UPLOAD_TOO_LARGE";
export const chatFileUploadNotFoundCode = "CHAT_FILE_UPLOAD_NOT_FOUND";
export const chatFileUploadsTooManyCode = "CHAT_FILE_UPLOADS_TOO_MANY";
export const chatFileUploadImagesTooLargeCode = "CHAT_FILE_UPLOAD_IMAGES_TOO_LARGE";

export type ChatFileUpload = Readonly<{
  uploadId: string;
  upload: Readonly<{
    method: "PUT";
    url: string;
    /** Sent with the PUT unchanged; its body must be exactly the declared number of bytes. */
    headers: Readonly<Record<string, string>>;
    expiresAt: string;
  }>;
}>;

/** A staged object that exists and fits its size cap, not yet downloaded. */
export type StagedChatFileUpload = Readonly<{
  type: "upload";
  fileName: string;
  attachmentType: ChatUploadAttachmentType;
  s3Key: string;
  sizeBytes: number;
}>;

function assertChatFileUploadSize(attachmentType: ChatUploadAttachmentType, sizeBytes: number): void {
  const maximumBytes = attachmentType.type === "image" ? chatImageUploadMaximumBytes : chatFileUploadMaximumBytes;
  if (sizeBytes > maximumBytes) {
    throw new HttpError(
      400,
      `This file is too large for AI chat. Files can be at most ${chatFileUploadMaximumBytes / mebibyte} MB, `
        + `and images at most ${chatImageUploadMaximumBytes / mebibyte} MB.`,
      chatFileUploadTooLargeCode,
    );
  }
}

/** Counts parts, not upload ids: one upload named under several file names is downloaded and stored once per name. */
export function assertChatUploadCountPerTurn(uploadPartCount: number): void {
  if (uploadPartCount > chatMaximumUploadsPerTurn) {
    throw new HttpError(
      400,
      `A message can carry at most ${chatMaximumUploadsPerTurn} uploaded files.`,
      chatFileUploadsTooManyCode,
    );
  }
}

/** No row is written: the staged key belongs to the caller, and the bucket expires it after a day. */
export async function createChatFileUpload(
  userId: string,
  fileName: string,
  mediaType: string,
  sizeBytes: number,
): Promise<ChatFileUpload> {
  const attachmentType = normalizeChatUploadAttachmentType(fileName, mediaType);
  assertChatFileUploadSize(attachmentType, sizeBytes);
  const uploadId = randomUUID();
  const signedAt = new Date();
  const url = await createChatFileUploadPutUrl(
    buildChatFileUploadS3Key(userId, uploadId),
    attachmentType.mediaType,
    sizeBytes,
    signedAt,
    chatFileUploadUrlExpiresSeconds,
  );

  return {
    uploadId,
    upload: {
      method: "PUT",
      url,
      headers: { "content-type": attachmentType.mediaType },
      expiresAt: new Date(signedAt.getTime() + chatFileUploadUrlExpiresSeconds * 1_000).toISOString(),
    },
  };
}

export async function headChatFileUpload(userId: string, part: UploadContentPart): Promise<StagedChatFileUpload> {
  const attachmentType = normalizeChatUploadAttachmentType(part.fileName, part.mediaType);
  const s3Key = buildChatFileUploadS3Key(userId, part.uploadId);
  const sizeBytes = await headChatFileObjectSize(s3Key);
  if (sizeBytes === null) {
    throw new HttpError(
      400,
      "The uploaded file was not found: it was never uploaded, or it expired. Attach it again, then try again.",
      chatFileUploadNotFoundCode,
    );
  }

  assertChatFileUploadSize(attachmentType, sizeBytes);
  return { type: "upload", fileName: part.fileName, attachmentType, s3Key, sizeBytes };
}

/** Takes the distinct uploads of one turn, since each of them becomes a session file of its own. */
export function assertChatImageUploadsPerTurnSize(uploads: ReadonlyArray<StagedChatFileUpload>): void {
  const imageBytes = uploads.reduce(
    (total, upload) => upload.attachmentType.type === "image" ? total + upload.sizeBytes : total,
    0,
  );
  if (imageBytes > chatImageUploadsPerTurnMaximumBytes) {
    throw new HttpError(
      400,
      `The images uploaded with one message can be at most ${chatImageUploadsPerTurnMaximumBytes / mebibyte} MB `
        + "together. Send some of them in another message.",
      chatFileUploadImagesTooLargeCode,
    );
  }
}

/** The staged bytes, checked by the policy that checks an inline attachment. */
export async function readChatFileUpload(upload: StagedChatFileUpload): Promise<DecodedChatAttachment> {
  const bytes = await getChatFileObjectBytes(upload.s3Key);
  assertChatUploadAttachmentBytes(upload.attachmentType, bytes);
  return upload.attachmentType.type === "image"
    ? { type: "image", mediaType: upload.attachmentType.mediaType, bytes }
    : { type: "file", fileName: upload.fileName, mediaType: upload.attachmentType.mediaType, bytes };
}
