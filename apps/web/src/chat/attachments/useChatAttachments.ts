import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type MutableRefObject,
} from "react";
import {
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  IMAGE_MEDIA_TYPE_PREFIX,
  buildContentParts,
  buildStartRunContentParts,
  toRequestBodySizeBytes,
} from "../shared/chatHelpers";
import {
  EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
  binaryPendingAttachmentExceedsSizeLimit,
  checkFileSize,
  isBinaryPendingAttachment,
  isChatAttachmentTooLargeError,
  isExpectedImageAttachmentPreparationError,
  prepareAttachment,
  recompressImageAttachment,
  type PendingAttachment,
} from "./FileAttachment";
import { isChatAttachmentUnsupportedTypeError } from "./attachmentMediaTypes";

type DraftAttachmentRequestBody = Readonly<{
  content: ReturnType<typeof buildContentParts>;
  sessionId?: string;
  timezone: string;
}>;

type UseChatAttachmentsParams = Readonly<{
  attachmentLimitMessage: string;
  attachmentUnsupportedMessage: string;
  canAttachDraftFiles: boolean;
  currentSessionId: string | null;
  draftInputText: string;
  onTechnicalError: (error: unknown) => void;
  pendingAttachmentsRef: MutableRefObject<ReadonlyArray<PendingAttachment>>;
  setPendingAttachmentsState: (nextAttachments: ReadonlyArray<PendingAttachment>) => void;
}>;

export type ChatAttachmentControls = Readonly<{
  handleDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  handleDragOver: (event: DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => Promise<void>;
  handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  ingestFiles: (files: ReadonlyArray<File>) => Promise<void>;
  isDragOver: boolean;
  removeAttachment: (index: number) => void;
}>;

function clipboardImageExtension(mediaType: string): string {
  const normalizedMediaType = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  const imageSubtype = normalizedMediaType.slice(IMAGE_MEDIA_TYPE_PREFIX.length);
  const extension = imageSubtype.split("+")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  if (extension.length === 0) {
    throw new Error(`Cannot name pasted image because clipboard MIME type "${mediaType}" has no usable subtype.`);
  }

  return extension === "jpeg" ? "jpg" : extension;
}

function ensureClipboardImageFileName(file: File, clipboardMediaType: string): File {
  if (file.name.trim().length > 0) {
    return file;
  }

  return new File(
    [file],
    `pasted-image.${clipboardImageExtension(clipboardMediaType)}`,
    {
      type: clipboardMediaType,
      lastModified: file.lastModified,
    },
  );
}

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
    content: buildStartRunContentParts(draftContentParts),
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
    attachmentUnsupportedMessage,
    canAttachDraftFiles,
    currentSessionId,
    draftInputText,
    onTechnicalError,
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
    if (binaryPendingAttachmentExceedsSizeLimit(finalAttachment)) {
      window.alert(attachmentLimitMessage);
      return;
    }

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
        onTechnicalError(error);
        return;
      }

      candidateAttachments = [...pendingAttachmentsRef.current, finalAttachment];
      if (binaryPendingAttachmentExceedsSizeLimit(finalAttachment)) {
        window.alert(attachmentLimitMessage);
        return;
      }
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

  async function ingestFiles(files: ReadonlyArray<File>): Promise<void> {
    for (const file of files) {
      const sizeError = checkFileSize(file);
      if (sizeError !== null) {
        window.alert(attachmentLimitMessage);
        continue;
      }

      try {
        await handleAttach(await prepareAttachment(file));
      } catch (error) {
        if (isChatAttachmentTooLargeError(error)) {
          window.alert(attachmentLimitMessage);
          continue;
        }

        if (isChatAttachmentUnsupportedTypeError(error)) {
          window.alert(attachmentUnsupportedMessage);
          continue;
        }

        if (isExpectedImageAttachmentPreparationError(error)) {
          window.alert(attachmentUnsupportedMessage);
          continue;
        }

        onTechnicalError(error);
      }
    }
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

    await ingestFiles(Array.from(event.dataTransfer.files));
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (!canAttachDraftFiles) {
      return;
    }

    const imageItems = Array.from(event.clipboardData.items).filter(
      (item) => item.kind === "file" && item.type.startsWith(IMAGE_MEDIA_TYPE_PREFIX),
    );
    const imageFiles: ReadonlyArray<File> = imageItems.flatMap((item) => {
      try {
        const file = item.getAsFile();
        if (file === null) {
          throw new Error(
            `Failed to read pasted image from clipboard item with MIME type "${item.type}".`,
          );
        }

        return [ensureClipboardImageFileName(file, item.type)];
      } catch (error) {
        onTechnicalError(error);
        return [];
      }
    });

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void ingestFiles(imageFiles);
  }

  return {
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    ingestFiles,
    isDragOver,
    removeAttachment,
  };
}
