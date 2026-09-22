import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type MutableRefObject,
} from "react";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../appError/AppErrorContext";
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
import { isImageFileCandidate } from "../../media/imagePreparation";
import {
  readCurrentAnalyticsSurface,
  toAnalyticsMediaUploadFailureReason,
  track,
  type AnalyticsMediaSource,
  type AnalyticsMediaUploadFailureReason,
  type AnalyticsSurface,
} from "../../analytics";

type DraftAttachmentRequestBody = Readonly<{
  content: ReturnType<typeof buildContentParts>;
  sessionId?: string;
  timezone: string;
}>;

/**
 * What became of one attachment.
 *
 * `abandoned` is not a failure: the composer went away or the app entered storage recovery
 * underneath it, so nothing was attempted for a person to see fail and nothing is reported.
 */
type ChatAttachOutcome =
  | Readonly<{ kind: "attached" }>
  | Readonly<{ kind: "failed"; reason: AnalyticsMediaUploadFailureReason }>
  | Readonly<{ kind: "abandoned" }>;

/**
 * What this client reports about one attachment, or null where it reports nothing about it.
 *
 * Holding both fields together is what keeps the two halves of the pair from drifting apart: a
 * success this client cannot report and a failure it can would be read later as a failure rate
 * rather than as the one-sided count it is, permanently, in an append-only table.
 *
 * Only the file chooser is reported, and only for an image. A drag and a clipboard paste have no
 * honest `source` in the shared vocabulary, and a document is not the fact these two events record.
 */
type ChatAttachReport = Readonly<{
  source: AnalyticsMediaSource;
  screen: AnalyticsSurface;
}>;

type UseChatAttachmentsParams = Readonly<{
  attachmentLimitMessage: string;
  attachmentUnsupportedMessage: string;
  canAttachDraftFiles: boolean;
  currentSessionId: string | null;
  draftInputText: string;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
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
  /**
   * `attachSource` is what the person attached from, or null where the shared vocabulary has no
   * honest value for it. It decides only what is reported; every file is ingested the same way.
   */
  ingestFiles: (
    files: ReadonlyArray<File>,
    attachSource: AnalyticsMediaSource | null,
  ) => Promise<void>;
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
    indexedDbOpenRecoveryState,
    onTechnicalError,
    pendingAttachmentsRef,
    setPendingAttachmentsState,
  } = params;
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const dragCounterRef = useRef<number>(0);
  const canAttachDraftFilesRef = useRef<boolean>(false);
  canAttachDraftFilesRef.current = canAttachDraftFiles;

  async function handleAttach(attachment: PendingAttachment): Promise<ChatAttachOutcome> {
    if (indexedDbOpenRecoveryState.hasFailed() || !canAttachDraftFilesRef.current) {
      return { kind: "abandoned" };
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let finalAttachment = attachment;
    if (binaryPendingAttachmentExceedsSizeLimit(finalAttachment)) {
      window.alert(attachmentLimitMessage);
      return { kind: "failed", reason: "too_large" };
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
        indexedDbOpenRecoveryState.throwIfFailed();
        finalAttachment = await recompressImageAttachment(
          attachment,
          EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
        );
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return { kind: "abandoned" };
        }
        onTechnicalError(error);
        return { kind: "failed", reason: toAnalyticsMediaUploadFailureReason(error) };
      }

      candidateAttachments = [...pendingAttachmentsRef.current, finalAttachment];
      if (binaryPendingAttachmentExceedsSizeLimit(finalAttachment)) {
        window.alert(attachmentLimitMessage);
        return { kind: "failed", reason: "too_large" };
      }
      projectedSizeBytes = measureDraftRequestBodySize({
        attachments: candidateAttachments,
        currentSessionId,
        draftInputText,
        timezone,
      });
    }

    if (indexedDbOpenRecoveryState.hasFailed() || !canAttachDraftFilesRef.current) {
      return { kind: "abandoned" };
    }

    if (projectedSizeBytes > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      window.alert(attachmentLimitMessage);
      return { kind: "failed", reason: "too_large" };
    }

    setPendingAttachmentsState(candidateAttachments);
    return { kind: "attached" };
  }

  async function ingestFiles(
    files: ReadonlyArray<File>,
    attachSource: AnalyticsMediaSource | null,
  ): Promise<void> {
    // The surface is read once, here, rather than at each report: the composer is the sidebar of
    // whatever route is open, and preparing a large image spans seconds, so a route change mid-
    // ingest would otherwise file the attachment against a screen the person had already left. A
    // null surface names nothing the catalog accepts on `media_attached`, so an ingest started from
    // one reports neither half rather than the failures alone.
    const ingestScreen = readCurrentAnalyticsSurface();
    const ingestReport: ChatAttachReport | null = attachSource !== null && ingestScreen !== null
      ? { source: attachSource, screen: ingestScreen }
      : null;

    for (const file of files) {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      // The same predicate the preparation path decides image-ness with. A media type alone is
      // narrower than it: a `.heic` or `.jpg` arrives with an empty `file.type` in several desktop
      // browsers, and it is attached as an image, so it has to be counted as one.
      const fileReport: ChatAttachReport | null = isImageFileCandidate(file)
        ? ingestReport
        : null;

      const sizeError = checkFileSize(file);
      if (sizeError !== null) {
        window.alert(attachmentLimitMessage);
        if (fileReport !== null) {
          track({ name: "media_upload_failed", reason: "too_large" });
        }
        continue;
      }

      try {
        indexedDbOpenRecoveryState.throwIfFailed();
        const attachment = await prepareAttachment(file);
        indexedDbOpenRecoveryState.throwIfFailed();
        const outcome = await handleAttach(attachment);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (fileReport !== null && outcome.kind === "attached") {
          // Emitted where the asset reaches the draft, never where the chooser opened.
          track({
            name: "media_attached",
            source: fileReport.source,
            screen: fileReport.screen,
          });
        }
        if (fileReport !== null && outcome.kind === "failed") {
          track({ name: "media_upload_failed", reason: outcome.reason });
        }
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }

        if (fileReport !== null) {
          track({
            name: "media_upload_failed",
            reason: toAnalyticsMediaUploadFailureReason(error),
          });
        }

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
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const currentAttachments = pendingAttachmentsRef.current;
    setPendingAttachmentsState([
      ...currentAttachments.slice(0, index),
      ...currentAttachments.slice(index + 1),
    ]);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
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
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
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
    event.dataTransfer.dropEffect = canAttachDraftFiles && indexedDbOpenRecoveryState.hasFailed() === false
      ? "copy"
      : "none";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    dragCounterRef.current = 0;
    setIsDragOver(false);

    if (!canAttachDraftFiles) {
      return;
    }

    // A dropped file is neither `photo_library` nor `camera`, so neither half of the pair is
    // reported for it; see `ChatAttachReport`.
    await ingestFiles(Array.from(event.dataTransfer.files), null);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (indexedDbOpenRecoveryState.hasFailed() || !canAttachDraftFiles) {
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
    // A pasted image has no origin the shared vocabulary can name either.
    void ingestFiles(imageFiles, null);
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
