import { useRef, type ReactElement } from "react";
import { useI18n } from "../../i18n";
import {
  AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES,
  AI_CHAT_MAXIMUM_IMAGE_UPLOAD_BYTES,
  AI_CHAT_MAXIMUM_IMAGE_UPLOADS_PER_TURN_BYTES,
  AI_CHAT_MAXIMUM_UPLOADS_PER_TURN,
  type ChatAttachmentLimitViolation,
} from "../shared/chatSizePolicy";
import {
  compressImageBlobToJpegBlob,
  convertHeicToJpegBlob,
  isHeicFile,
  isImageFileCandidate,
  isImageMediaType,
  type ImageCompressionOptions,
} from "../../media/imagePreparation";
import {
  ChatAttachmentUnsupportedTypeError,
  normalizeChatAttachmentFileMediaType,
} from "./attachmentMediaTypes";

export type { ImageCompressionOptions } from "../../media/imagePreparation";

/** Held only in memory; the send uploads `blob` unchanged. */
export type BinaryPendingAttachment = Readonly<{
  type: "binary";
  fileName: string;
  mediaType: string;
  blob: Blob;
}>;

export type CardPendingAttachment = Readonly<{
  type: "card";
  attachmentId: string;
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}>;

export type PendingAttachment = BinaryPendingAttachment | CardPendingAttachment;

type Props = Readonly<{
  onFiles: (files: ReadonlyArray<File>) => Promise<void> | void;
  disabled?: boolean;
}>;

export class ChatAttachmentTooLargeError extends Error {
  constructor() {
    super("AI chat attachment is too large.");
    this.name = "ChatAttachmentTooLargeError";
  }
}

/**
 * Everything that stopped an image from becoming an attachment, presented the same way. It keeps the
 * `cause` because one of them — a `HeicConverterUnavailableError` — is not a statement about the
 * picked file, and the analytics mapping reports it as a failure of this client rather than as a
 * refusal the person could act on.
 */
export class ChatImageAttachmentPreparationError extends Error {
  constructor(fileName: string, causeMessage: string, cause: unknown) {
    super(`Failed to process image "${fileName}". ${causeMessage}`, { cause });
    this.name = "ChatImageAttachmentPreparationError";
  }
}

const ACCEPTED_TYPES = "image/*,.pdf,.txt,.csv,.json,.xml,.xlsx,.xls,.md,.html,.py,.js,.ts,.yaml,.yml,.sql,.log,.docx,.zip,.apkg";
const MB = 1024 * 1024;

export const IMAGE_RAW_MAX_FILE_SIZE_BYTES = 40 * MB;
export const NON_IMAGE_RAW_MAX_FILE_SIZE_BYTES = AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES;

export const AGGRESSIVE_IMAGE_COMPRESSION: ImageCompressionOptions = {
  maxSidePixels: 2_048,
  quality: 0.8,
};

export const EXTRA_AGGRESSIVE_IMAGE_COMPRESSION: ImageCompressionOptions = {
  maxSidePixels: 1_280,
  quality: 0.55,
};

export function isBinaryPendingAttachment(attachment: PendingAttachment): attachment is BinaryPendingAttachment {
  return attachment.type === "binary";
}

function fileSizeLimitBytes(file: File): number {
  if (isImageFileCandidate(file)) {
    return IMAGE_RAW_MAX_FILE_SIZE_BYTES;
  }

  return NON_IMAGE_RAW_MAX_FILE_SIZE_BYTES;
}

function formatMegabytes(byteCount: number): string {
  return (byteCount / MB).toFixed(1);
}

export function checkFileSize(file: File): string | null {
  const sizeLimitBytes = fileSizeLimitBytes(file);
  if (file.size > sizeLimitBytes) {
    const sizeMb = formatMegabytes(file.size);
    const limitMb = (sizeLimitBytes / MB).toFixed(0);
    if (isImageFileCandidate(file)) {
      return `Image "${file.name}" is too large (${sizeMb} MB). Maximum allowed image size before compression is ${limitMb} MB.`;
    }

    return `File "${file.name}" is too large (${sizeMb} MB). Maximum allowed size is ${limitMb} MB.`;
  }

  return null;
}

function isImagePendingAttachment(attachment: BinaryPendingAttachment): boolean {
  return isImageMediaType(attachment.mediaType);
}

function binaryPendingAttachmentExceedsSizeLimit(attachment: BinaryPendingAttachment): boolean {
  const sizeLimitBytes = isImagePendingAttachment(attachment)
    ? AI_CHAT_MAXIMUM_IMAGE_UPLOAD_BYTES
    : AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES;
  return attachment.blob.size > sizeLimitBytes;
}

/** Cards are not uploads, so only files and images count toward these limits. */
export function findPendingAttachmentLimitViolation(
  attachments: ReadonlyArray<PendingAttachment>,
): ChatAttachmentLimitViolation | null {
  const binaryAttachments = attachments.filter(isBinaryPendingAttachment);
  if (binaryAttachments.some(binaryPendingAttachmentExceedsSizeLimit)) {
    return "attachment_too_large";
  }

  if (binaryAttachments.length > AI_CHAT_MAXIMUM_UPLOADS_PER_TURN) {
    return "too_many_attachments";
  }

  const imageBytes = binaryAttachments.reduce(
    (total, attachment) => isImagePendingAttachment(attachment) ? total + attachment.blob.size : total,
    0,
  );
  return imageBytes > AI_CHAT_MAXIMUM_IMAGE_UPLOADS_PER_TURN_BYTES ? "images_too_large" : null;
}

export function isChatAttachmentTooLargeError(error: unknown): boolean {
  return error instanceof ChatAttachmentTooLargeError;
}

export function isExpectedImageAttachmentPreparationError(error: unknown): boolean {
  return error instanceof ChatImageAttachmentPreparationError;
}

async function compressImageAttachment(
  fileName: string,
  imageBlob: Blob,
  options: ImageCompressionOptions,
): Promise<BinaryPendingAttachment> {
  const compressedImage = await compressImageBlobToJpegBlob(imageBlob, fileName, {
    ...options,
    mediaType: "image/jpeg",
    backgroundColor: null,
  });

  return {
    type: "binary",
    fileName,
    mediaType: compressedImage.mediaType,
    blob: compressedImage.blob,
  };
}

async function prepareImageAttachmentWithinSizeLimit(file: File): Promise<BinaryPendingAttachment> {
  const imageBlob = isHeicFile(file)
    ? await convertHeicToJpegBlob(file)
    : file;
  const attachment = await compressImageAttachment(file.name, imageBlob, AGGRESSIVE_IMAGE_COMPRESSION);
  if (binaryPendingAttachmentExceedsSizeLimit(attachment) === false) {
    return attachment;
  }

  return compressImageAttachment(file.name, imageBlob, EXTRA_AGGRESSIVE_IMAGE_COMPRESSION);
}

export async function recompressImageAttachment(
  attachment: PendingAttachment,
  options: ImageCompressionOptions,
): Promise<PendingAttachment> {
  if (attachment.type !== "binary" || !isImagePendingAttachment(attachment)) {
    throw new Error("Cannot recompress a non-image attachment");
  }

  return compressImageAttachment(attachment.fileName, attachment.blob, options);
}

export async function prepareAttachment(file: File): Promise<PendingAttachment> {
  if (isImageFileCandidate(file)) {
    try {
      const attachment = await prepareImageAttachmentWithinSizeLimit(file);
      if (binaryPendingAttachmentExceedsSizeLimit(attachment)) {
        throw new ChatAttachmentTooLargeError();
      }
      return attachment;
    } catch (error) {
      if (isChatAttachmentTooLargeError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new ChatImageAttachmentPreparationError(
        file.name,
        `Please try another image format or a smaller file. ${message}`,
        error,
      );
    }
  }

  const attachment: BinaryPendingAttachment = {
    type: "binary",
    fileName: file.name,
    mediaType: normalizeChatAttachmentFileMediaType(file.name, file.type),
    blob: file,
  };
  // The backend refuses empty bytes as an unsupported file.
  if (file.size === 0) {
    throw new ChatAttachmentUnsupportedTypeError();
  }

  if (binaryPendingAttachmentExceedsSizeLimit(attachment)) {
    throw new ChatAttachmentTooLargeError();
  }

  return attachment;
}

export function FileAttachment(props: Props): ReactElement {
  const { onFiles } = props;
  const { t } = useI18n();
  const disabled = props.disabled === true;
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(): Promise<void> {
    const files = inputRef.current?.files;
    if (files === undefined || files === null) {
      return;
    }

    await onFiles(Array.from(files));

    if (inputRef.current !== null) {
      inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        name="chatAttachments"
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        style={{ display: "none" }}
        disabled={disabled}
        onChange={() => void handleChange()}
      />
      <button
        type="button"
        className="chat-attach-btn"
        disabled={disabled}
        aria-label={t("chatPanel.actions.addAttachment")}
        title={t("chatPanel.actions.addAttachment")}
        onClick={() => inputRef.current?.click()}
      >
        <svg
          className="chat-attach-btn-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.5 13.5 16 8a3.182 3.182 0 1 1 4.5 4.5l-8 8a5.303 5.303 0 0 1-7.5-7.5l8.5-8.5" />
        </svg>
      </button>
    </>
  );
}
