import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { createLocalChatRequestBody, streamLocalChat, transcribeChatAudio } from "../api";
import { webAppVersion } from "../clientIdentity";
import { DEFAULT_MODEL_ID } from "../chatModels";
import { useAppData } from "../appData";
import { ensurePersistentStorage } from "../syncStorage";
import {
  explainBrowserMediaPermissionError,
  queryBrowserPermissionState,
} from "../access/browserAccess";
import { useChatLayout } from "./ChatLayoutContext";
import {
  checkFileSize,
  EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
  FileAttachment,
  prepareAttachment,
  recompressImageAttachment,
  type PendingAttachment,
} from "./FileAttachment";
import {
  ATTACHMENT_LIMIT_ERROR_MESSAGE,
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  IMAGE_MEDIA_TYPE_PREFIX,
  MAX_WIDTH,
  MIN_WIDTH,
  STORAGE_MODEL_KEY,
  buildContentParts,
  calculateSidebarWidthFromPointer,
  toRequestBodySizeBytes,
} from "./chatHelpers";
import { renderStoredMessageContent } from "./chatMessageContent";
import { reportLocalChatDiagnostics } from "./localChatDiagnostics";
import { runLocalChatRuntime } from "./localChatRuntime";
import { createLocalToolExecutor } from "./localToolExecutor";
import { toLocalChatMessages } from "./localRuntime";
import { ModelSelector } from "./ModelSelector";
import { useChatAutoScroll } from "./useChatAutoScroll";
import {
  OPTIMISTIC_ASSISTANT_STATUS_TEXT,
  useChatHistory,
} from "./useChatHistory";
import {
  insertDictationTranscriptIntoDraft,
  type ChatDraftSelection,
  type ChatDictationState,
} from "./chatDictation";

type Props = Readonly<{
  mode: "sidebar" | "fullscreen";
}>;

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

      reject(new Error("Microphone recording failed."));
    }

    recorder.addEventListener("stop", handleStop, { once: true });
    recorder.addEventListener("error", handleError as EventListener, { once: true });
    recorder.stop();
  });
}

export function ChatPanel(props: Props): ReactElement {
  const { mode } = props;
  const appData = useAppData();
  const { setIsOpen, chatWidth, setChatWidth } = useChatLayout();
  const [localWidth, setLocalWidth] = useState<number>(chatWidth);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const {
    messages,
    isHydrated,
    appendUserMessage,
    startAssistantMessage,
    appendAssistantChunk,
    appendToolCall,
    completeToolCall,
    finalizeAssistant,
    markAssistantError,
    clearOptimisticAssistantStatus,
    clearHistory,
  } = useChatHistory();

  const [inputText, setInputText] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
  const [pendingAttachments, setPendingAttachments] = useState<ReadonlyArray<PendingAttachment>>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [dictationState, setDictationState] = useState<ChatDictationState>("idle");

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingAttachmentsRef = useRef<ReadonlyArray<PendingAttachment>>([]);
  const dragCounterRef = useRef<number>(0);
  const dragWidthRef = useRef<number>(chatWidth);
  const abortRef = useRef<AbortController | null>(null);
  const activeStreamIdRef = useRef<number>(0);
  const nextStreamIdRef = useRef<number>(1);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Array<Blob>>([]);
  const draftSelectionRef = useRef<ChatDraftSelection | null>(null);
  const pendingTextareaSelectionRef = useRef<ChatDraftSelection | null>(null);
  const shouldRestoreTextareaFocusAfterDictationRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  const { handleMessagesScroll } = useChatAutoScroll({
    isHydrated,
    isStreaming,
    messages,
    messagesRef,
  });

  function setPendingAttachmentsState(nextAttachments: ReadonlyArray<PendingAttachment>): void {
    pendingAttachmentsRef.current = nextAttachments;
    setPendingAttachments(nextAttachments);
  }

  function buildDraftRequestBodyForAttachments(
    attachments: ReadonlyArray<PendingAttachment>,
    timezone: string,
  ): ReturnType<typeof createLocalChatRequestBody> | null {
    const draftContentParts = buildContentParts(inputText, attachments);
    if (draftContentParts.length === 0) {
      return null;
    }

    const draftWireMessages = toLocalChatMessages([
      ...messages,
      {
        role: "user",
        content: draftContentParts,
        timestamp: Date.now(),
        isError: false,
      },
    ]);
    return createLocalChatRequestBody(
      draftWireMessages,
      selectedModel,
      timezone,
      { totalCards: appData.localCardCount },
    );
  }

  useEffect(() => {
    const savedModel = localStorage.getItem(STORAGE_MODEL_KEY);
    if (savedModel !== null) {
      setSelectedModel(savedModel);
    }
  }, []);

  useEffect(() => {
    setLocalWidth(chatWidth);
    dragWidthRef.current = chatWidth;
  }, [chatWidth]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

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

  function handleModelChange(modelId: string): void {
    setSelectedModel(modelId);
    localStorage.setItem(STORAGE_MODEL_KEY, modelId);
  }

  async function handleAttach(attachment: PendingAttachment): Promise<void> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let finalAttachment = attachment;
    let candidateAttachments = [...pendingAttachmentsRef.current, finalAttachment];
    let projectedRequestBody = buildDraftRequestBodyForAttachments(candidateAttachments, timezone);
    let projectedSizeBytes = projectedRequestBody === null ? 0 : toRequestBodySizeBytes(projectedRequestBody);

    if (
      projectedSizeBytes > ATTACHMENT_PAYLOAD_LIMIT_BYTES
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
      window.alert(ATTACHMENT_LIMIT_ERROR_MESSAGE);
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

  function stopActiveStream(): void {
    const currentAbortController = abortRef.current;
    if (currentAbortController === null) {
      return;
    }

    currentAbortController.abort();
    abortRef.current = null;
    activeStreamIdRef.current = 0;
    setIsStreaming(false);
    clearOptimisticAssistantStatus();
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
      window.alert("Microphone recording is unavailable in this browser.");
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== "function") {
      window.alert("Microphone recording is unavailable in this browser.");
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
        window.alert(explainBrowserMediaPermissionError("microphone", error, permissionState));
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

      const transcript = await transcribeChatAudio(audioBlob, "web");
      if (isMountedRef.current) {
        setInputText((currentText) => {
          const insertionResult = insertDictationTranscriptIntoDraft(currentText, transcript, draftSelectionRef.current);
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
        window.alert(error instanceof Error ? error.message : String(error));
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

  async function sendMessage(): Promise<void> {
    if (isStreaming || dictationState !== "idle") {
      return;
    }

    const tapStartedAt = Date.now();

    const contentParts = buildContentParts(inputText, pendingAttachments);
    if (contentParts.length === 0) {
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const initialWireMessages = toLocalChatMessages([
      ...messages,
      {
        role: "user",
        content: contentParts,
        timestamp: Date.now(),
        isError: false,
      },
    ]);
    const initialRequestBody = createLocalChatRequestBody(
      initialWireMessages,
      selectedModel,
      timezone,
      { totalCards: appData.localCardCount },
    );
    if (toRequestBodySizeBytes(initialRequestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      markAssistantError(ATTACHMENT_LIMIT_ERROR_MESSAGE);
      return;
    }

    appendUserMessage(contentParts);
    setInputText("");
    draftSelectionRef.current = null;
    pendingTextareaSelectionRef.current = null;
    setPendingAttachmentsState([]);
    setIsStreaming(true);

    let hasStartedAssistant = false;
    startAssistantMessage(OPTIMISTIC_ASSISTANT_STATUS_TEXT);
    hasStartedAssistant = true;

    const streamId = nextStreamIdRef.current;
    nextStreamIdRef.current += 1;
    const abortController = new AbortController();
    abortRef.current = abortController;
    activeStreamIdRef.current = streamId;

    try {
      const storageState = await ensurePersistentStorage();
      console.info("chat_local_storage_state", storageState);

      const localToolExecutor = createLocalToolExecutor(appData);
      await runLocalChatRuntime(
        {
          createRequestBody: (
            runtimeMessages: ReadonlyArray<ReturnType<typeof toLocalChatMessages>[number]>,
            runtimeModel: string,
            runtimeTimezone: string,
          ) => createLocalChatRequestBody(
            runtimeMessages,
            runtimeModel,
            runtimeTimezone,
            { totalCards: appData.localCardCount },
          ),
          streamChat: streamLocalChat,
          executeTool: localToolExecutor.execute,
          reportDiagnostics: reportLocalChatDiagnostics,
          generateRequestId: () => globalThis.crypto.randomUUID(),
          now: () => Date.now(),
          appVersion: webAppVersion,
          devicePlatform: "web",
        },
        {
          initialMessages: initialWireMessages,
          selectedModel,
          timezone,
          tapStartedAt,
          signal: abortController.signal,
          callbacks: {
            onAssistantStarted: () => {
              if (hasStartedAssistant) {
                return;
              }

              startAssistantMessage(OPTIMISTIC_ASSISTANT_STATUS_TEXT);
              hasStartedAssistant = true;
            },
            onAssistantText: appendAssistantChunk,
            onToolCallStarted: appendToolCall,
            onToolCallCompleted: completeToolCall,
            onAssistantCompleted: finalizeAssistant,
            onAssistantError: markAssistantError,
            onDiagnostics: () => undefined,
          },
        },
      );
    } catch (error) {
      if (abortController.signal.aborted === false) {
        markAssistantError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (abortController.signal.aborted) {
        console.info("chat_request_aborted", { model: selectedModel });
      }
      if (activeStreamIdRef.current === streamId) {
        setIsStreaming(false);
        abortRef.current = null;
        activeStreamIdRef.current = 0;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const rootClassName = mode === "sidebar" ? "chat-sidebar" : "chat-sidebar-fullscreen";
  const isDictationVisible = dictationState !== "idle";
  const isDraftInputBlocked = dictationState !== "idle";
  const microphoneAriaLabel = dictationState === "recording" ? "Stop dictation" : "Start dictation";
  const dictationStatusLabel = dictationState === "requesting_permission"
    ? "Waiting for microphone access..."
    : dictationState === "recording"
      ? "Listening..."
      : "Transcribing...";

  return (
    <div
      ref={rootRef}
      className={rootClassName}
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
      {isDragOver ? <div className="chat-drop-overlay">Drop files to attach</div> : null}
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
        <span className="chat-header-title">AI chat</span>
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-close-btn"
            onClick={() => {
              discardDictation();
              stopActiveStream();
              clearHistory();
            }}
          >
            New
          </button>
          {mode === "sidebar" ? (
            <button type="button" className="chat-close-btn" onClick={() => setIsOpen(false)}>
              &laquo;
            </button>
          ) : null}
        </div>
      </div>

      <div className="chat-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p className="chat-empty-title">Try asking:</p>
            <ul className="chat-empty-list">
              <li>Draft 10 Spanish verb flashcards for beginners.</li>
              <li>Find due cards about biology and summarize weak areas.</li>
              <li>Clean up duplicated tags and propose a rename plan.</li>
            </ul>
            <p className="chat-empty-title">Attachments:</p>
            <ul className="chat-empty-list">
              <li>Paste screenshots of notes and ask for card extraction.</li>
              <li>Upload PDFs or text files and ask for flashcard drafts.</li>
              <li>Ask the assistant to propose edits before applying them.</li>
            </ul>
          </div>
        ) : null}

        {messages.map((message, index) => {
          const isLastAssistant = isStreaming && message.role === "assistant" && index === messages.length - 1;
          return (
            <div
              key={`${message.timestamp}-${index}`}
              className={`chat-msg chat-msg-${message.role}${message.isError ? " chat-msg-error" : ""}`}
            >
              {renderStoredMessageContent(message)}
              {isLastAssistant ? (
                <span className="chat-streaming-indicator">
                  <span className="chat-dots" />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="chat-input-area">
        {pendingAttachments.length > 0 ? (
          <div className="chat-attachment-preview">
            {pendingAttachments.map((attachment, index) => (
              <span key={`${attachment.fileName}-${index}`} className="chat-attachment-chip">
                {attachment.fileName}
                <button
                  type="button"
                  className="chat-attachment-remove"
                  onClick={() => removeAttachment(index)}
                >
                  &times;
                </button>
              </span>
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
            placeholder="Ask about cards, review history, or attach notes..."
            value={inputText}
            rows={1}
            onChange={(event) => {
              setInputText(event.target.value);
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
          <ModelSelector
            value={selectedModel}
            onChange={handleModelChange}
            locked={messages.length > 0 || isDraftInputBlocked}
          />
          <div className="chat-controls-right">
            <FileAttachment onAttach={handleAttach} disabled={isDraftInputBlocked} />
            <button
              type="button"
              className={`chat-mic-btn${dictationState === "recording" ? " chat-mic-btn-recording" : ""}`}
              aria-label={microphoneAriaLabel}
              onClick={() => void handleMicrophoneClick()}
              disabled={dictationState === "requesting_permission" || dictationState === "transcribing"}
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
            {isStreaming ? (
              <button
                type="button"
                className="chat-stop-btn"
                aria-label="Stop response"
                onClick={stopActiveStream}
              >
                <span className="chat-stop-btn-icon" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send-btn"
                aria-label="Send message"
                onClick={() => void sendMessage()}
                disabled={dictationState !== "idle"}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
