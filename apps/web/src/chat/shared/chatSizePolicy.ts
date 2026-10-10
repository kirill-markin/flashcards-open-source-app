import type { TranslationKey, TranslationValues } from "../../i18n";

const MEBIBYTE = 1024 * 1024;

// The upload limits mirror apps/backend/src/chatFiles/uploads.ts, which enforces them again.
export const AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES = 30 * MEBIBYTE;
export const AI_CHAT_MAXIMUM_IMAGE_UPLOAD_BYTES = 10 * MEBIBYTE;
export const AI_CHAT_MAXIMUM_IMAGE_UPLOADS_PER_TURN_BYTES = 15 * MEBIBYTE;
export const AI_CHAT_MAXIMUM_UPLOADS_PER_TURN = 10;
/** Attachment bytes travel outside this body, so only text, cards, and upload references count toward it. */
export const AI_CHAT_MAXIMUM_START_RUN_REQUEST_BYTES = 5 * MEBIBYTE;
export const CHAT_ATTACHMENT_UNSUPPORTED_TYPE_CODE = "CHAT_ATTACHMENT_UNSUPPORTED_TYPE";
export const CHAT_REQUEST_TOO_LARGE_CODE = "CHAT_REQUEST_TOO_LARGE";
export const CHAT_FILE_UPLOAD_TOO_LARGE_CODE = "CHAT_FILE_UPLOAD_TOO_LARGE";
export const CHAT_FILE_UPLOAD_NOT_FOUND_CODE = "CHAT_FILE_UPLOAD_NOT_FOUND";
export const CHAT_FILE_UPLOADS_TOO_MANY_CODE = "CHAT_FILE_UPLOADS_TOO_MANY";
export const CHAT_FILE_UPLOAD_IMAGES_TOO_LARGE_CODE = "CHAT_FILE_UPLOAD_IMAGES_TOO_LARGE";

/** A limit the files and images of one turn can break; the client checks each before the backend does. */
export type ChatAttachmentLimitViolation = "attachment_too_large" | "too_many_attachments" | "images_too_large";

export type ChatAttachmentLimitMessages = Readonly<Record<ChatAttachmentLimitViolation, string>>;

export function isAiChatRequestTooLargeError(params: Readonly<{
  statusCode: number | null;
  code: string | null;
}>): boolean {
  if (params.statusCode === 413) {
    return true;
  }

  return params.code === CHAT_REQUEST_TOO_LARGE_CODE;
}

export function isAiChatAttachmentUnsupportedTypeError(params: Readonly<{
  statusCode: number | null;
  code: string | null;
}>): boolean {
  return params.statusCode === 400 && params.code === CHAT_ATTACHMENT_UNSUPPORTED_TYPE_CODE;
}

export function toChatAttachmentLimitViolation(code: string | null): ChatAttachmentLimitViolation | null {
  switch (code) {
    case CHAT_FILE_UPLOAD_TOO_LARGE_CODE:
      return "attachment_too_large";
    case CHAT_FILE_UPLOADS_TOO_MANY_CODE:
      return "too_many_attachments";
    case CHAT_FILE_UPLOAD_IMAGES_TOO_LARGE_CODE:
      return "images_too_large";
  }

  return null;
}

/** The backend states its limits in MB of 1024 * 1024 bytes, and so does this copy. */
export function formatChatAttachmentLimitMessages(params: Readonly<{
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatNumber: (value: number) => string;
}>): ChatAttachmentLimitMessages {
  const { t, formatNumber } = params;
  return {
    attachment_too_large: t("chatPanel.alerts.attachmentTooLarge", {
      fileLimit: formatNumber(AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES / MEBIBYTE),
      imageLimit: formatNumber(AI_CHAT_MAXIMUM_IMAGE_UPLOAD_BYTES / MEBIBYTE),
    }),
    too_many_attachments: t("chatPanel.alerts.attachmentsTooMany", {
      limit: formatNumber(AI_CHAT_MAXIMUM_UPLOADS_PER_TURN),
    }),
    images_too_large: t("chatPanel.alerts.attachmentImagesTooLarge", {
      limit: formatNumber(AI_CHAT_MAXIMUM_IMAGE_UPLOADS_PER_TURN_BYTES / MEBIBYTE),
    }),
  };
}
