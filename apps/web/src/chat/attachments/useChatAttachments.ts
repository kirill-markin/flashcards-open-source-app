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
import { IMAGE_MEDIA_TYPE_PREFIX } from "../shared/chatHelpers";
import type { ChatAttachmentLimitMessages } from "../shared/chatSizePolicy";
import {
  EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
  checkFileSize,
  findPendingAttachmentLimitViolation,
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
  attachmentLimitMessages: ChatAttachmentLimitMessages;
  attachmentUnsupportedMessage: string;
  canAttachDraftFiles: boolean;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  onTechnicalError: (error: unknown) => void;
  pastedFileIconOnlyMessage: string;
  pendingAttachmentsRef: MutableRefObject<ReadonlyArray<PendingAttachment>>;
  setPendingAttachmentsState: (nextAttachments: ReadonlyArray<PendingAttachment>) => boolean;
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

const FILE_NAME_TEXT_PATTERN = /^[^\r\n/]+\.[a-z0-9]+$/i;

/**
 * Chrome on macOS has pasted a file copied in Finder as a PNG of the file's icon, with the file's
 * name as the clipboard text. A screenshot carries no such text, and a pasted image file is named
 * exactly like it, so both still attach.
 */
function isPastedFileIconOnly(files: ReadonlyArray<File>, clipboardText: string): boolean {
  const [file] = files;
  if (files.length !== 1 || file === undefined || !isImageFileCandidate(file)) {
    return false;
  }

  const fileNameText = clipboardText.trim();
  return FILE_NAME_TEXT_PATTERN.test(fileNameText)
    && fileNameText.normalize("NFC") !== file.name.normalize("NFC");
}

/**
 * Excel, Word and similar apps put a picture of the copied selection beside its HTML; when that
 * HTML has text, the paste is text. A browser "Copy Image" or a lone Office picture carries no
 * text, so its image attaches. The plain-text check first skips parsing HTML that has no text.
 */
function hasPastedRichText(clipboardText: string, clipboardHtml: string): boolean {
  if (clipboardText.trim().length === 0) {
    return false;
  }

  const body = new DOMParser().parseFromString(clipboardHtml, "text/html").body;
  return (body.textContent ?? "").trim().length > 0;
}

export function useChatAttachments(params: UseChatAttachmentsParams): ChatAttachmentControls {
  const {
    attachmentLimitMessages,
    attachmentUnsupportedMessage,
    canAttachDraftFiles,
    indexedDbOpenRecoveryState,
    onTechnicalError,
    pastedFileIconOnlyMessage,
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

    let finalAttachment = attachment;
    let candidateAttachments = [...pendingAttachmentsRef.current, finalAttachment];
    let limitViolation = findPendingAttachmentLimitViolation(candidateAttachments);

    if (
      limitViolation === "images_too_large"
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
      limitViolation = findPendingAttachmentLimitViolation(candidateAttachments);
    }

    if (indexedDbOpenRecoveryState.hasFailed() || !canAttachDraftFilesRef.current) {
      return { kind: "abandoned" };
    }

    if (limitViolation !== null) {
      window.alert(attachmentLimitMessages[limitViolation]);
      return { kind: "failed", reason: "too_large" };
    }

    return setPendingAttachmentsState(candidateAttachments) ? { kind: "attached" } : { kind: "abandoned" };
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
        window.alert(attachmentLimitMessages.attachment_too_large);
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
          window.alert(attachmentLimitMessages.attachment_too_large);
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

    const fileItems = Array.from(event.clipboardData.items).filter((item) => item.kind === "file");
    const files: ReadonlyArray<File> = fileItems.flatMap((item) => {
      try {
        const file = item.getAsFile();
        if (file === null) {
          throw new Error(
            `Failed to read pasted file from clipboard item with MIME type "${item.type}".`,
          );
        }

        return item.type.startsWith(IMAGE_MEDIA_TYPE_PREFIX)
          ? [ensureClipboardImageFileName(file, item.type)]
          : [file];
      } catch (error) {
        onTechnicalError(error);
        return [];
      }
    });

    if (files.length === 0) {
      return;
    }

    const clipboardText = event.clipboardData.getData("text/plain");
    if (isPastedFileIconOnly(files, clipboardText)) {
      event.preventDefault();
      window.alert(pastedFileIconOnlyMessage);
      return;
    }

    if (
      files.some(isImageFileCandidate)
      && hasPastedRichText(clipboardText, event.clipboardData.getData("text/html"))
    ) {
      const nonImageFiles = files.filter((file) => !isImageFileCandidate(file));
      if (nonImageFiles.length > 0) {
        void ingestFiles(nonImageFiles, null);
      }
      return;
    }

    event.preventDefault();
    // A pasted file has no origin the shared vocabulary can name either.
    void ingestFiles(files, null);
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
