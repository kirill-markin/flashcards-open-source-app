import type { CardContentPart, ContentPart, StartChatRunContentPart } from "../../types";
import type {
  BinaryPendingAttachment,
  CardPendingAttachment,
  PendingAttachment,
} from "../attachments/FileAttachment";
import { isBinaryPendingAttachment } from "../attachments/FileAttachment";

export const IMAGE_MEDIA_TYPE_PREFIX = "image/";
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

function buildCardContentPart(attachment: CardPendingAttachment): CardContentPart {
  return {
    type: "card",
    cardId: attachment.cardId,
    frontText: attachment.frontText,
    backText: attachment.backText,
    tags: attachment.tags,
  };
}

/**
 * Builds the local copy of a turn, preserving attachment order and only appending user text when its
 * trimmed value is non-empty. A file or image is the label the backend returns for it as well, because no
 * client holds attachment bytes once a turn is sent.
 */
export function buildContentParts(
  text: string,
  attachments: ReadonlyArray<PendingAttachment>,
): ReadonlyArray<ContentPart> {
  const parts: Array<ContentPart> = [];

  for (const attachment of attachments) {
    if (!isBinaryPendingAttachment(attachment)) {
      parts.push(buildCardContentPart(attachment));
      continue;
    }

    if (attachment.mediaType.startsWith(IMAGE_MEDIA_TYPE_PREFIX)) {
      parts.push({ type: "image", mediaType: attachment.mediaType, base64Data: "" });
      continue;
    }

    parts.push({
      type: "file",
      mediaType: attachment.mediaType,
      base64Data: "",
      fileName: attachment.fileName,
    });
  }

  if (text.trim().length > 0) {
    parts.push({ type: "text", text: text.trim() });
  }

  return parts;
}

function buildStartRunCardContentPart(part: CardContentPart): StartChatRunContentPart {
  const legacyPart = {
    ...part,
    // TODO: Remove effortLevel when the backend chat wire contract drops legacy card effort.
    effortLevel: "fast",
  } satisfies CardContentPart & Readonly<{ effortLevel: "fast" }>;

  return legacyPart;
}

/**
 * Builds the `POST /chat` content of the same turn as `buildContentParts`: each file or image is named by
 * the upload that staged its bytes.
 */
export function buildStartRunContentParts(
  text: string,
  attachments: ReadonlyArray<PendingAttachment>,
  uploadIdsByAttachment: ReadonlyMap<BinaryPendingAttachment, string>,
): ReadonlyArray<StartChatRunContentPart> {
  const parts = attachments.map((attachment, index): StartChatRunContentPart => {
    if (!isBinaryPendingAttachment(attachment)) {
      return buildStartRunCardContentPart(buildCardContentPart(attachment));
    }

    const uploadId = uploadIdsByAttachment.get(attachment);
    if (uploadId === undefined) {
      throw new Error(`Chat attachment was not uploaded before the turn started: attachmentIndex=${index}`);
    }

    return {
      type: "upload",
      uploadId,
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
    };
  });

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
