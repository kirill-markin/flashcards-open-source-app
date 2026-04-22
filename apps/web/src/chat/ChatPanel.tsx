import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { transcribeChatAudio } from "../api";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import { listOutboxRecords } from "../localDb/outbox";
import {
  explainBrowserMediaPermissionError,
  queryBrowserPermissionState,
} from "../access/browserAccess";
import { useChatDraft } from "./ChatDraftContext";
import { useChatLayout } from "./ChatLayoutContext";
import {
  checkFileSize,
  EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
  FileAttachment,
  isBinaryPendingAttachment,
  prepareAttachment,
  recompressImageAttachment,
  type PendingAttachment,
} from "./FileAttachment";
import { formatCardAttachmentLabel } from "./chatCardParts";
import {
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  IMAGE_MEDIA_TYPE_PREFIX,
  MAX_WIDTH,
  MIN_WIDTH,
  USER_VISIBLE_ATTACHMENT_LIMIT_MB,
  buildContentParts,
  calculateSidebarWidthFromPointer,
  toRequestBodySizeBytes,
} from "./chatHelpers";
import { renderStoredMessageContent } from "./chatMessageContent";
import { useChatAutoScroll } from "./useChatAutoScroll";
import {
  insertDictationTranscriptIntoDraft,
  type ChatDraftSelection,
  type ChatDictationState,
} from "./chatDictation";
import { useChatSession } from "./sessionController";
import type { ChatComposerAction } from "./sessionController/runState";

type Props = Readonly<{
  mode: "sidebar" | "fullscreen";
}>;

type ChatSendPhase = "idle" | "preparingSend" | "startingRun";
type ChatComposerState = "idle" | "preparingSend" | "startingRun" | "running" | "stopping";
const MOBILE_CHAT_BREAKPOINT_QUERY = "(max-width: 768px)";

function getChatComposerState(params: Readonly<{
  composerAction: ChatComposerAction;
  isAssistantRunActive: boolean;
  isStopping: boolean;
  sendPhase: ChatSendPhase;
}>): ChatComposerState {
  const {
    composerAction,
    isAssistantRunActive,
    isStopping,
    sendPhase,
  } = params;

  if (sendPhase === "preparingSend") {
    return "preparingSend";
  }

  if (sendPhase === "startingRun") {
    return "startingRun";
  }

  if (isStopping) {
    return "stopping";
  }

  if (composerAction === "stop" || isAssistantRunActive) {
    return "running";
  }

  return "idle";
}

function matchesMobileChatBreakpoint(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(MOBILE_CHAT_BREAKPOINT_QUERY).matches;
}

function stopMediaStream(stream: MediaStream | null): void {
  if (stream === null) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function chooseSupportedRecordingMimeType(): string | null {
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }

  const supportedMimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  for (const mimeType of supportedMimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

function cleanupDictationResources(
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>,
  mediaStreamRef: MutableRefObject<MediaStream | null>,
  recordedChunksRef: MutableRefObject<Array<Blob>>,
): void {
  stopMediaStream(mediaStreamRef.current);
  mediaRecorderRef.current = null;
  mediaStreamRef.current = null;
  recordedChunksRef.current = [];
}

function stopMediaRecorder(
  recorder: MediaRecorder,
  recordedChunksRef: MutableRefObject<Array<Blob>>,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    function handleStop(): void {
      recorder.removeEventListener("error", handleError as EventListener);
      resolve(new Blob(recordedChunksRef.current, {
        type: recorder.mimeType === "" ? "audio/webm" : recorder.mimeType,
      }));
    }

    function handleError(event: Event): void {
      recorder.removeEventListener("stop", handleStop);
      if (event instanceof ErrorEvent && event.error instanceof Error) {
        reject(event.error);
        return;
      }

      reject(new Error("MICROPHONE_RECORDING_FAILED"));
    }

    recorder.addEventListener("stop", handleStop, { once: true });
    recorder.addEventListener("error", handleError as EventListener, { once: true });
    recorder.stop();
  });
}

export function ChatPanel(props: Props): ReactElement {
  const { mode } = props;
  const appData = useAppData();
  const { t, formatNumber } = useI18n();
  const {
    draft,
    focusComposerRequestVersion,
    replaceInputText,
    updateInputText,
    replacePendingAttachments,
    clearDraftForSession,
  } = useChatDraft();
  const { setIsOpen, chatWidth, setChatWidth } = useChatLayout();
  const [localWidth, setLocalWidth] = useState<number>(chatWidth);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [dictationState, setDictationState] = useState<ChatDictationState>("idle");
  const [sendPhase, setSendPhase] = useState<ChatSendPhase>("idle");
  const [isDraftOptimisticallyClearedForSend, setIsDraftOptimisticallyClearedForSend] = useState<boolean>(false);
  const [isMobileChatLayout, setIsMobileChatLayout] = useState<boolean>(matchesMobileChatBreakpoint);
  const draftInputText = draft.inputText;
  const draftPendingAttachments = draft.pendingAttachments;
  const inputText = isDraftOptimisticallyClearedForSend ? "" : draftInputText;
  const pendingAttachments = isDraftOptimisticallyClearedForSend ? [] : draftPendingAttachments;

  const activeWorkspaceId = appData.activeWorkspace?.workspaceId ?? null;
  const {
    runState,
    messages,
    isHistoryLoaded,
    isAssistantRunActive,
    isStopping,
    currentSessionId,
    chatConfig,
    composerSuggestions,
    composerAction,
    errorDialogMessage,
    dismissErrorDialog,
    ensureRemoteSession,
    sendMessage: sendChatMessage,
    stopMessage,
    clearConversation,
  } = useChatSession();

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingAttachmentsRef = useRef<ReadonlyArray<PendingAttachment>>([]);
  const dragCounterRef = useRef<number>(0);
  const dragWidthRef = useRef<number>(chatWidth);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Array<Blob>>([]);
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  const draftSelectionRef = useRef<ChatDraftSelection | null>(null);
  const pendingTextareaSelectionRef = useRef<ChatDraftSelection | null>(null);
  const pendingComposerFocusRestoreRef = useRef<boolean>(false);
  const shouldRestoreTextareaFocusAfterDictationRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const sendLifecycleRequestSequenceRef = useRef<number>(0);

  const { handleMessagesScroll } = useChatAutoScroll({
    isHydrated: isHistoryLoaded,
    isStreaming: isAssistantRunActive,
    messages,
    messagesRef,
    messagesContentRef,
  });
  const isInitialHistoryLoading = !isHistoryLoaded && messages.length === 0;

  function setPendingAttachmentsState(nextAttachments: ReadonlyArray<PendingAttachment>): void {
    pendingAttachmentsRef.current = nextAttachments;
    replacePendingAttachments(nextAttachments);
  }

  function buildDraftRequestBodyForAttachments(
    attachments: ReadonlyArray<PendingAttachment>,
    timezone: string,
  ): Readonly<{
    sessionId?: string;
    content: ReturnType<typeof buildContentParts>;
    timezone: string;
  }> | null {
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

  useEffect(() => {
    setLocalWidth(chatWidth);
    dragWidthRef.current = chatWidth;
  }, [chatWidth]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(MOBILE_CHAT_BREAKPOINT_QUERY);
    const handleChange = (event: MediaQueryListEvent): void => {
      setIsMobileChatLayout(event.matches);
    };

    setIsMobileChatLayout(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (pendingComposerFocusRestoreRef.current === false || dictationState !== "idle") {
      return;
    }

    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }

    pendingComposerFocusRestoreRef.current = false;
    textarea.focus();
  });

  useEffect(() => {
    if (dictationState !== "idle") {
      return;
    }

    textareaRef.current?.focus();
  }, [dictationState, focusComposerRequestVersion]);

  useEffect(() => {
    if (dictationState !== "idle") {
      return;
    }

    const textarea = textareaRef.current;
    const pendingSelection = pendingTextareaSelectionRef.current;
    if (textarea === null || pendingSelection === null) {
      return;
    }

    const start = Math.max(0, Math.min(pendingSelection.start, textarea.value.length));
    const end = Math.max(0, Math.min(pendingSelection.end, textarea.value.length));

    if (shouldRestoreTextareaFocusAfterDictationRef.current) {
      textarea.focus();
    }

    textarea.setSelectionRange(start, end);
    draftSelectionRef.current = { start, end };
    pendingTextareaSelectionRef.current = null;
    shouldRestoreTextareaFocusAfterDictationRef.current = false;
  }, [dictationState, inputText]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder !== null && recorder.state !== "inactive") {
        recorder.stop();
      }
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
    };
  }, []);

  function updateTrackedDraftSelection(textarea: HTMLTextAreaElement): void {
    draftSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function requestComposerFocusRestore(): void {
    pendingComposerFocusRestoreRef.current = true;
  }

  function clearComposerForPendingSend(): void {
    setIsDraftOptimisticallyClearedForSend(true);
    pendingAttachmentsRef.current = [];
    draftSelectionRef.current = null;
    pendingTextareaSelectionRef.current = null;
  }

  function restoreComposerAfterPendingSend(
    nextAttachments: ReadonlyArray<PendingAttachment>,
  ): void {
    setIsDraftOptimisticallyClearedForSend(false);
    pendingAttachmentsRef.current = nextAttachments;
  }

  function finalizeAcceptedSend(
    sourceSessionId: string | null,
    resultSessionId: string | null,
  ): void {
    clearDraftForSession(sourceSessionId);
    if (resultSessionId !== null && resultSessionId !== sourceSessionId) {
      clearDraftForSession(resultSessionId);
    }
    pendingAttachmentsRef.current = [];
    draftSelectionRef.current = null;
    pendingTextareaSelectionRef.current = null;
    setIsDraftOptimisticallyClearedForSend(false);
    requestComposerFocusRestore();
  }

  function invalidateSendLifecycleRequests(): number {
    const nextSequence = sendLifecycleRequestSequenceRef.current + 1;
    sendLifecycleRequestSequenceRef.current = nextSequence;
    return nextSequence;
  }

  function isSendLifecycleRequestCurrent(requestSequence: number): boolean {
    return sendLifecycleRequestSequenceRef.current === requestSequence;
  }

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      const sidebarElement = rootRef.current;
      if (sidebarElement === null) {
        return;
      }

      const sidebarBounds = sidebarElement.getBoundingClientRect();
      const nextWidth = calculateSidebarWidthFromPointer(
        event.clientX,
        sidebarBounds.left,
        MIN_WIDTH,
        MAX_WIDTH,
      );

      dragWidthRef.current = nextWidth;
      setLocalWidth(nextWidth);
    }

    function handleMouseUp(): void {
      setIsDragging(false);
      setChatWidth(dragWidthRef.current);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, setChatWidth]);

  async function handleAttach(attachment: PendingAttachment): Promise<void> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let finalAttachment = attachment;
    let candidateAttachments = [...pendingAttachmentsRef.current, finalAttachment];
    let projectedRequestBody = buildDraftRequestBodyForAttachments(candidateAttachments, timezone);
    let projectedSizeBytes = projectedRequestBody === null ? 0 : toRequestBodySizeBytes(projectedRequestBody);

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
      projectedRequestBody = buildDraftRequestBodyForAttachments(candidateAttachments, timezone);
      projectedSizeBytes = projectedRequestBody === null ? 0 : toRequestBodySizeBytes(projectedRequestBody);
    }

    if (projectedSizeBytes > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      window.alert(t("chatPanel.alerts.attachmentLimit", {
        count: formatNumber(USER_VISIBLE_ATTACHMENT_LIMIT_MB),
      }));
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

  function discardDictation(): void {
    const recorder = mediaRecorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop();
    }

    cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
    draftSelectionRef.current = null;
    pendingTextareaSelectionRef.current = null;
    shouldRestoreTextareaFocusAfterDictationRef.current = false;
    if (isMountedRef.current) {
      setDictationState("idle");
    }
  }

  async function startDictation(): Promise<void> {
    if (dictationState !== "idle") {
      return;
    }

    const textarea = textareaRef.current;
    const shouldRestoreFocus = textarea !== null && document.activeElement === textarea;
    shouldRestoreTextareaFocusAfterDictationRef.current = shouldRestoreFocus;
    draftSelectionRef.current = shouldRestoreFocus && textarea !== null
      ? {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      }
      : null;

    if (typeof MediaRecorder === "undefined") {
      window.alert(t("chatPanel.alerts.microphoneUnavailable"));
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== "function") {
      window.alert(t("chatPanel.alerts.microphoneUnavailable"));
      return;
    }

    setDictationState("requesting_permission");

    let stream: MediaStream | null = null;
    try {
      stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      const recorderMimeType = chooseSupportedRecordingMimeType();
      const recorder = recorderMimeType === null
        ? new MediaRecorder(stream)
        : new MediaRecorder(stream, { mimeType: recorderMimeType });
      recordedChunksRef.current = [];
      recorder.addEventListener("dataavailable", (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      });
      recorder.start();
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      if (isMountedRef.current) {
        setDictationState("recording");
      }
    } catch (error) {
      stopMediaStream(stream);
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      const permissionState = await queryBrowserPermissionState("microphone");
      if (isMountedRef.current) {
        window.alert(explainBrowserMediaPermissionError("microphone", error, permissionState, t));
        setDictationState("idle");
      }
    }
  }

  async function stopDictation(): Promise<void> {
    const recorder = mediaRecorderRef.current;
    if (recorder === null || recorder.state === "inactive") {
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      setDictationState("idle");
      return;
    }

    setDictationState("transcribing");

    try {
      const audioBlob = await stopMediaRecorder(recorder, recordedChunksRef);
      stopMediaStream(mediaStreamRef.current);
      if (audioBlob.size <= 0) {
        if (isMountedRef.current) {
          setDictationState("idle");
        }
        return;
      }

      const sessionId = await ensureRemoteSession();
      const transcription = await transcribeChatAudio(
        audioBlob,
        "web",
        sessionId,
      );
      if (transcription.sessionId !== sessionId) {
        throw new Error(t("chatPanel.errors.transcriptionUnexpectedSessionId"));
      }

      if (currentSessionIdRef.current !== sessionId) {
        return;
      }

      if (isMountedRef.current) {
        updateInputText((currentText) => {
          const insertionResult = insertDictationTranscriptIntoDraft(
            currentText,
            transcription.text,
            draftSelectionRef.current,
          );
          const nextSelection = shouldRestoreTextareaFocusAfterDictationRef.current
            ? insertionResult.selection
            : null;
          draftSelectionRef.current = nextSelection;
          pendingTextareaSelectionRef.current = nextSelection;
          return insertionResult.text;
        });
      }
    } catch (error) {
      if (isMountedRef.current) {
        const message = error instanceof Error && error.message === "MICROPHONE_RECORDING_FAILED"
          ? t("chatPanel.alerts.microphoneUnavailable")
          : error instanceof Error
            ? error.message
            : String(error);
        window.alert(message);
      }
    } finally {
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      if (isMountedRef.current) {
        setDictationState("idle");
      }
    }
  }

  async function handleMicrophoneClick(): Promise<void> {
    if (dictationState === "recording") {
      await stopDictation();
      return;
    }

    if (dictationState !== "idle") {
      return;
    }

    await startDictation();
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

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

  async function sendPendingMessage(): Promise<void> {
    if (dictationState !== "idle" || composerAction !== "send" || sendPhase !== "idle") {
      return;
    }

    if (appData.isSessionVerified === false) {
      appData.setErrorMessage(t("chatPanel.transientErrors.sessionRestoring"));
      return;
    }

    if (activeWorkspaceId === null) {
      appData.setErrorMessage(t("chatPanel.transientErrors.workspaceRequired"));
      return;
    }

    const nextText = draftInputText;
    const nextAttachments = pendingAttachmentsRef.current;
    const sourceSessionId = currentSessionId;
    const contentParts = buildContentParts(nextText, nextAttachments);
    if (contentParts.length === 0) {
      return;
    }

    const requestBody = {
      sessionId: currentSessionId ?? undefined,
      content: contentParts,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      window.alert(t("chatPanel.alerts.attachmentLimit", {
        count: formatNumber(USER_VISIBLE_ATTACHMENT_LIMIT_MB),
      }));
      return;
    }

    const requestSequence = sendLifecycleRequestSequenceRef.current;
    clearComposerForPendingSend();
    setSendPhase("preparingSend");

    try {
      await appData.runSync();
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      const outboxRecords = await listOutboxRecords(activeWorkspaceId);
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      if (outboxRecords.length > 0) {
        restoreComposerAfterPendingSend(nextAttachments);
        appData.setErrorMessage(t("chatPanel.transientErrors.pendingSync"));
        setSendPhase("idle");
        return;
      }
    } catch (error) {
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      restoreComposerAfterPendingSend(nextAttachments);
      appData.setErrorMessage(error instanceof Error ? error.message : String(error));
      setSendPhase("idle");
      return;
    }

    if (isSendLifecycleRequestCurrent(requestSequence) === false) {
      return;
    }

    setSendPhase("startingRun");

    try {
      const result = await sendChatMessage({
        clientRequestId: crypto.randomUUID().toLowerCase(),
        text: nextText,
        attachments: nextAttachments,
      });
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      if (result.accepted) {
        finalizeAcceptedSend(sourceSessionId, result.sessionId);
      } else {
        restoreComposerAfterPendingSend(nextAttachments);
      }
    } finally {
      if (isSendLifecycleRequestCurrent(requestSequence)) {
        setSendPhase("idle");
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter") {
      return;
    }

    if (isMobileChatLayout || event.shiftKey || event.repeat) {
      return;
    }

    event.preventDefault();

    if (composerAction === "stop") {
      void stopMessage();
      return;
    }

    void sendPendingMessage();
  }

  const rootClassName = mode === "sidebar" ? "chat-sidebar" : "chat-sidebar-fullscreen";
  const isDictationVisible = dictationState !== "idle";
  const isDraftInputBlocked = dictationState !== "idle" || sendPhase !== "idle";
  const isComposerTransientBusy = sendPhase !== "idle";
  const isChatActionLocked = appData.isSessionVerified === false;
  const areAttachmentsEnabled = chatConfig.features.attachmentsEnabled;
  const isDictationEnabled = chatConfig.features.dictationEnabled;
  const hasDraftContent = inputText.trim().length > 0 || pendingAttachments.length > 0;
  const composerState = getChatComposerState({
    composerAction,
    isAssistantRunActive,
    isStopping,
    sendPhase,
  });
  const canSendPendingMessage = isHistoryLoaded
    && composerAction === "send"
    && sendPhase === "idle"
    && !isStopping
    && !isChatActionLocked
    && dictationState === "idle"
    && hasDraftContent;
  const canShowComposerSuggestions = isHistoryLoaded
    && composerAction === "send"
    && sendPhase === "idle"
    && !isAssistantRunActive
    && !isStopping
    && !isChatActionLocked
    && dictationState === "idle"
    && pendingAttachments.length === 0
    && inputText.trim().length === 0
    && composerSuggestions.length > 0;
  const microphoneAriaLabel = dictationState === "recording" ? t("chatPanel.dictation.stop") : t("chatPanel.dictation.start");
  const dictationStatusLabel = dictationState === "requesting_permission"
    ? t("chatPanel.dictation.waitingForPermission")
    : dictationState === "recording"
      ? t("chatPanel.dictation.listening")
      : t("chatPanel.dictation.transcribing");

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-testid="chat-panel"
      style={mode === "sidebar" ? { width: localWidth } : undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        dragCounterRef.current += 1;
        if (dragCounterRef.current === 1) {
          setIsDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current === 0) {
          setIsDragOver(false);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => void handleDrop(event)}
    >
      {isDragOver ? <div className="chat-drop-overlay">{t("chatPanel.dropFiles")}</div> : null}
      {mode === "sidebar" ? (
        <div
          className={`chat-resize-handle${isDragging ? " dragging" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            dragWidthRef.current = localWidth;
            setIsDragging(true);
          }}
        />
      ) : null}

      <div className="chat-header">
        <div>
          <span className="chat-header-title">{t("chatPanel.providerTitle")}</span>
          <div className="chat-subtitle">{chatConfig.provider.label} · {chatConfig.model.badgeLabel}</div>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-close-btn"
            onClick={() => {
              invalidateSendLifecycleRequests();
              setIsDraftOptimisticallyClearedForSend(false);
              setSendPhase("idle");
              discardDictation();
              if (currentSessionId === null) {
                clearDraftForSession(null);
              }
              void clearConversation()
                .then((nextSessionId) => {
                  clearDraftForSession(nextSessionId);
                  pendingAttachmentsRef.current = [];
                  draftSelectionRef.current = null;
                  pendingTextareaSelectionRef.current = null;
                  requestComposerFocusRestore();
                });
            }}
            disabled={isStopping || isChatActionLocked}
            data-testid="chat-new-button"
          >
            {t("chatPanel.actions.newChat")}
          </button>
          {mode === "sidebar" ? (
            <button
              type="button"
              className="chat-close-btn"
              onClick={() => {
                discardDictation();
                setIsOpen(false);
              }}
            >
              &laquo;
            </button>
          ) : null}
        </div>
      </div>

      <div className="chat-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        <div className="chat-messages-content" ref={messagesContentRef}>
          {isInitialHistoryLoading ? (
            <div className="chat-empty chat-empty-loading" aria-live="polite">
              <p className="chat-empty-title" data-testid="chat-loading-title">{t("chatPanel.loadingTitle")}</p>
              <div className="chat-loading-lines" aria-hidden="true">
                <span className="chat-loading-line chat-loading-line-title" />
                <span className="chat-loading-line" />
                <span className="chat-loading-line" />
                <span className="chat-loading-line chat-loading-line-short" />
              </div>
            </div>
          ) : null}

          {!isInitialHistoryLoading && messages.length === 0 ? (
            <div className="chat-empty">
              <p className="chat-empty-title" data-testid="chat-empty-title">{t("chatPanel.empty.title")}</p>
              <p className="chat-empty-copy">{t("chatPanel.empty.copy")}</p>
            </div>
          ) : null}

          {messages.map((message, index) => {
            const isLastAssistant = isAssistantRunActive && message.role === "assistant" && index === messages.length - 1;
            return (
              <div
                key={`${message.timestamp}-${index}`}
                className={`chat-msg chat-msg-${message.role}`}
              >
                {renderStoredMessageContent(message, t)}
                {isLastAssistant ? (
                  <span className="chat-streaming-indicator">
                    <span className="chat-dots" />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="chat-input-area"
        data-testid="chat-composer-state"
        data-composer-state={composerState}
        data-composer-action={composerAction}
        data-chat-run-state={runState}
        data-send-phase={sendPhase}
        data-assistant-run-active={isAssistantRunActive ? "true" : "false"}
        data-stopping={isStopping ? "true" : "false"}
        data-draft-state={hasDraftContent ? "filled" : "empty"}
        data-can-send={canSendPendingMessage ? "true" : "false"}
      >
        {pendingAttachments.length > 0 ? (
          <div className="chat-attachment-preview">
            {pendingAttachments.map((attachment, index) => (
              <span
                key={isBinaryPendingAttachment(attachment)
                  ? `${attachment.fileName}-${index}`
                  : `${attachment.attachmentId}-${index}`}
                className={`chat-attachment-chip${isBinaryPendingAttachment(attachment) ? "" : " chat-attachment-chip-card"}`}
              >
                {isBinaryPendingAttachment(attachment)
                  ? attachment.fileName
                  : `${t("chatPanel.pendingAttachmentCardPrefix")} · ${formatCardAttachmentLabel(attachment)}`}
                <button
                  type="button"
                  className="chat-attachment-remove"
                  onClick={() => removeAttachment(index)}
                  disabled={isDraftInputBlocked}
                  aria-label={t("chatPanel.actions.removeAttachment")}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {canShowComposerSuggestions ? (
          <div
            className="chat-composer-suggestions"
            aria-label={t("chatPanel.suggestedReplies")}
            data-testid="chat-composer-suggestions"
            data-suggestion-count={composerSuggestions.length}
          >
            {composerSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className="chat-composer-suggestion"
                data-testid="chat-composer-suggestion"
                data-suggestion-id={suggestion.id}
                data-suggestion-index={index}
                onClick={() => {
                  updateInputText((currentText) =>
                    currentText.length === 0
                      ? suggestion.text
                      : `${currentText}${currentText.endsWith(" ") ? "" : " "}${suggestion.text}`);
                  requestComposerFocusRestore();
                }}
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        ) : null}

        {isDictationVisible ? (
          <div className={`chat-dictation-surface chat-dictation-surface-${dictationState}`} aria-live="polite">
            <div className="chat-dictation-wave" aria-hidden="true">
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
            </div>
            <span className="chat-dictation-label">{dictationStatusLabel}</span>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            name="chatMessage"
            className="chat-textarea"
            placeholder={t("chatPanel.composerPlaceholder")}
            value={inputText}
            rows={1}
            disabled={isDraftInputBlocked}
            data-testid="chat-composer-input"
            onChange={(event) => {
              replaceInputText(event.target.value);
              updateTrackedDraftSelection(event.target);
            }}
            onKeyDown={handleKeyDown}
            onSelect={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onClick={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onKeyUp={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onFocus={(event) => updateTrackedDraftSelection(event.currentTarget)}
          />
        )}

        <div className="chat-controls">
          <div className="chat-controls-right">
            <FileAttachment onAttach={handleAttach} disabled={isDraftInputBlocked || !areAttachmentsEnabled} />
            <button
              type="button"
              className={`chat-mic-btn${dictationState === "recording" ? " chat-mic-btn-recording" : ""}`}
              aria-label={microphoneAriaLabel}
              onClick={() => void handleMicrophoneClick()}
              disabled={isChatActionLocked || sendPhase !== "idle" || dictationState === "requesting_permission" || dictationState === "transcribing" || !isDictationEnabled}
            >
              {dictationState === "recording" ? (
                <span className="chat-stop-btn-icon" aria-hidden="true" />
              ) : (
                <svg
                  className="chat-mic-btn-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3.75a3 3 0 0 1 3 3v5.5a3 3 0 1 1-6 0v-5.5a3 3 0 0 1 3-3Z" />
                  <path d="M6.75 11.5a5.25 5.25 0 0 0 10.5 0" />
                  <path d="M12 16.75v3.5" />
                  <path d="M9.25 20.25h5.5" />
                </svg>
              )}
            </button>
            {composerAction === "stop" ? (
              <button
                type="button"
                className="chat-stop-btn"
                aria-label={t("chatPanel.actions.stopAriaLabel")}
                onClick={() => void stopMessage()}
                disabled={isStopping}
                data-testid="chat-stop-button"
              >
                <span className="chat-stop-btn-icon" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send-btn"
                aria-label={t("chatPanel.actions.sendAriaLabel")}
                onClick={() => void sendPendingMessage()}
                disabled={!canSendPendingMessage}
                data-testid="chat-send-button"
              >
                {t("chatPanel.actions.send")}
              </button>
            )}
          </div>
        </div>
      </div>

      {errorDialogMessage !== null ? (
        <div
          className="chat-error-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-error-dialog-title"
        >
          <div className="panel chat-error-dialog">
            <h2 id="chat-error-dialog-title">{t("chatPanel.errorTitle")}</h2>
            <p>{errorDialogMessage}</p>
            <button
              type="button"
              className="primary-btn"
              onClick={dismissErrorDialog}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
