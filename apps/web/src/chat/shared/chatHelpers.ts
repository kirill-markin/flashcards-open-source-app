import type { ContentPart } from "../../types";
import type { PendingAttachment } from "../attachments/FileAttachment";
import { isBinaryPendingAttachment } from "../attachments/FileAttachment";
import {
  AI_CHAT_MAXIMUM_START_RUN_REQUEST_BYTES,
  USER_VISIBLE_ATTACHMENT_LIMIT_MB as USER_VISIBLE_START_RUN_REQUEST_LIMIT_MB,
} from "./chatSizePolicy";

export const IMAGE_MEDIA_TYPE_PREFIX = "image/";
export const ATTACHMENT_PAYLOAD_LIMIT_BYTES = AI_CHAT_MAXIMUM_START_RUN_REQUEST_BYTES;
export const USER_VISIBLE_ATTACHMENT_LIMIT_MB = USER_VISIBLE_START_RUN_REQUEST_LIMIT_MB;
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 600;
export const AUTO_SCROLL_INTERVAL_MS = 2_000;
export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24;

export type ChatErrorFallbackMessages = Readonly<{
  emptyBackendResponse: string;
  upstreamHtmlResponse: string;
}>;

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
 * Builds AI chat content parts while preserving attachment order and only
 * appending user text when its trimmed value is non-empty.
 */
export function buildContentParts(
  text: string,
  attachments: ReadonlyArray<PendingAttachment>,
): ReadonlyArray<ContentPart> {
  const parts: Array<ContentPart> = [];

  for (const attachment of attachments) {
    if (!isBinaryPendingAttachment(attachment)) {
      parts.push({
        type: "card",
        cardId: attachment.cardId,
        frontText: attachment.frontText,
        backText: attachment.backText,
        tags: attachment.tags,
        effortLevel: attachment.effortLevel,
      });
      continue;
    }

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
export function sanitizeErrorTextWithFallbackMessages(
  status: number,
  raw: string,
  fallbackMessages: ChatErrorFallbackMessages,
): string {
  if (raw.trim().length === 0 && status === 500) {
    return fallbackMessages.emptyBackendResponse;
  }

  if (raw.includes("<html") || raw.includes("<!DOCTYPE")) {
    return fallbackMessages.upstreamHtmlResponse;
  }

  return raw;
}
