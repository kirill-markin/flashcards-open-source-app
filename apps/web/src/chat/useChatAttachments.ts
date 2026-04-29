import { useRef, useState, type DragEvent, type MutableRefObject } from "react";
import {
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  IMAGE_MEDIA_TYPE_PREFIX,
  buildContentParts,
  toRequestBodySizeBytes,
} from "./chatHelpers";
import {
  EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
  checkFileSize,
  isBinaryPendingAttachment,
  prepareAttachment,
  recompressImageAttachment,
  type PendingAttachment,
} from "./FileAttachment";

type DraftAttachmentRequestBody = Readonly<{
  content: ReturnType<typeof buildContentParts>;
  sessionId?: string;
  timezone: string;
}>;

type UseChatAttachmentsParams = Readonly<{
  attachmentLimitMessage: string;
  canAttachDraftFiles: boolean;
  currentSessionId: string | null;
  draftInputText: string;
  pendingAttachmentsRef: MutableRefObject<ReadonlyArray<PendingAttachment>>;
  setPendingAttachmentsState: (nextAttachments: ReadonlyArray<PendingAttachment>) => void;
}>;

export type ChatAttachmentControls = Readonly<{
  handleAttach: (attachment: PendingAttachment) => Promise<void>;
  handleDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  handleDragOver: (event: DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => Promise<void>;
  isDragOver: boolean;
  removeAttachment: (index: number) => void;
}>;

function buildDraftRequestBodyForAttachments(params: Readonly<{
  attachments: ReadonlyArray<PendingAttachment>;
  currentSessionId: string | null;
  draftInputText: string;
  timezone: string;
}>): DraftAttachmentRequestBody | null {
  const {
    attachments,
    currentSessionId,
    draftInputText,
    timezone,
  } = params;
  const draftContentParts = buildContentParts(draftInputText, attachments);
  if (draftContentParts.length === 0) {
    return null;
  }

  return {
    sessionId: currentSessionId ?? undefined,
    content: draftContentParts,
    timezone,
  };
}

function measureDraftRequestBodySize(params: Readonly<{
  attachments: ReadonlyArray<PendingAttachment>;
  currentSessionId: string | null;
  draftInputText: string;
  timezone: string;
}>): number {
  const projectedRequestBody = buildDraftRequestBodyForAttachments(params);
  return projectedRequestBody === null ? 0 : toRequestBodySizeBytes(projectedRequestBody);
}

export function useChatAttachments(params: UseChatAttachmentsParams): ChatAttachmentControls {
  const {
    attachmentLimitMessage,
    canAttachDraftFiles,
    currentSessionId,
    draftInputText,
    pendingAttachmentsRef,
    setPendingAttachmentsState,
  } = params;
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const dragCounterRef = useRef<number>(0);
  const canAttachDraftFilesRef = useRef<boolean>(false);
  canAttachDraftFilesRef.current = canAttachDraftFiles;

  async function handleAttach(attachment: PendingAttachment): Promise<void> {
    if (!canAttachDraftFilesRef.current) {
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let finalAttachment = attachment;
    let candidateAttachments = [...pendingAttachmentsRef.current, finalAttachment];
    let projectedSizeBytes = measureDraftRequestBodySize({
      attachments: candidateAttachments,
      currentSessionId,
      draftInputText,
      timezone,
    });

    if (
      projectedSizeBytes > ATTACHMENT_PAYLOAD_LIMIT_BYTES
      && isBinaryPendingAttachment(attachment)
      && attachment.mediaType.startsWith(IMAGE_MEDIA_TYPE_PREFIX)
    ) {
      try {
        finalAttachment = await recompressImageAttachment(
          attachment,
          EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
        return;
      }

      candidateAttachments = [...pendingAttachmentsRef.current, finalAttachment];
      projectedSizeBytes = measureDraftRequestBodySize({
        attachments: candidateAttachments,
        currentSessionId,
        draftInputText,
        timezone,
      });
    }

    if (!canAttachDraftFilesRef.current) {
      return;
    }

    if (projectedSizeBytes > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      window.alert(attachmentLimitMessage);
      return;
    }

    setPendingAttachmentsState(candidateAttachments);
  }

  function removeAttachment(index: number): void {
    const currentAttachments = pendingAttachmentsRef.current;
    setPendingAttachmentsState([
      ...currentAttachments.slice(0, index),
      ...currentAttachments.slice(index + 1),
    ]);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = canAttachDraftFiles ? "copy" : "none";
    if (!canAttachDraftFiles) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
      return;
    }

    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDragOver(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (!canAttachDraftFiles) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
      return;
    }

    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = canAttachDraftFiles ? "copy" : "none";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    if (!canAttachDraftFiles) {
      return;
    }

    const files = event.dataTransfer.files;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const sizeError = checkFileSize(file);
      if (sizeError !== null) {
        window.alert(sizeError);
        continue;
      }

      try {
        await handleAttach(await prepareAttachment(file));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
      }
    }
  }

  return {
    handleAttach,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isDragOver,
    removeAttachment,
  };
}
