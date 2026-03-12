import type { ContentPart } from "../types";
import type { PendingAttachment } from "./FileAttachment";

export const STORAGE_MODEL_KEY = "flashcards-chat-model";
export const IMAGE_MEDIA_TYPE_PREFIX = "image/";
export const ATTACHMENT_PAYLOAD_LIMIT_BYTES = 9_961_472;
export const USER_VISIBLE_ATTACHMENT_LIMIT_MB = 10;
export const ATTACHMENT_LIMIT_ERROR_MESSAGE = `Attachment payload limit is ${USER_VISIBLE_ATTACHMENT_LIMIT_MB} MB after compression.`;
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 600;
export const AUTO_SCROLL_INTERVAL_MS = 2_000;
export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24;

/**
 * Clamps the draggable chat sidebar width to the supported layout bounds.
 * The pointer is measured from the sidebar left edge, not the viewport.
 */
export function calculateSidebarWidthFromPointer(
  pointerClientX: number,
  sidebarLeft: number,
  minimumWidth: number,
  maximumWidth: number,
): number {
  const nextWidth = Math.round(pointerClientX - sidebarLeft);
  return Math.max(minimumWidth, Math.min(nextWidth, maximumWidth));
}

/**
 * Builds local chat content parts while preserving attachment order and only
 * appending user text when its trimmed value is non-empty.
 */
export function buildContentParts(
  text: string,
  attachments: ReadonlyArray<PendingAttachment>,
): ReadonlyArray<ContentPart> {
  const parts: Array<ContentPart> = [];

  for (const attachment of attachments) {
    if (attachment.mediaType.startsWith(IMAGE_MEDIA_TYPE_PREFIX)) {
      parts.push({ type: "image", mediaType: attachment.mediaType, base64Data: attachment.base64Data });
      continue;
    }

    parts.push({
      type: "file",
      mediaType: attachment.mediaType,
      base64Data: attachment.base64Data,
      fileName: attachment.fileName,
    });
  }

  if (text.trim().length > 0) {
    parts.push({ type: "text", text: text.trim() });
  }

  return parts;
}

/**
 * Measures the UTF-8 byte length of a serialized request body so the browser
 * can enforce the shared local-chat payload ceiling before streaming starts.
 */
export function toRequestBodySizeBytes(requestBody: unknown): number {
  const jsonBody = JSON.stringify(requestBody);
  return new TextEncoder().encode(jsonBody).length;
}

/**
 * Rewrites backend error text into actionable browser-facing messages when the
 * upstream response body is empty or unexpectedly HTML.
 */
export function sanitizeErrorText(status: number, raw: string): string {
  if (raw.trim().length === 0 && status === 500) {
    return "The backend returned an empty error response.";
  }

  if (raw.includes("<html") || raw.includes("<!DOCTYPE")) {
    return "The request was blocked by an upstream HTML response.";
  }

  return raw;
}
