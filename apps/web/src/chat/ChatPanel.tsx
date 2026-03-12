import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { createLocalChatRequestBody, streamLocalChat } from "../api";
import { webAppVersion } from "../clientIdentity";
import { DEFAULT_MODEL_ID } from "../chatModels";
import { useAppData } from "../appData";
import { ensurePersistentStorage } from "../syncStorage";
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
import { useChatHistory } from "./useChatHistory";

type Props = Readonly<{
  mode: "sidebar" | "fullscreen";
}>;

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
    clearHistory,
  } = useChatHistory();

  const [inputText, setInputText] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
  const [pendingAttachments, setPendingAttachments] = useState<ReadonlyArray<PendingAttachment>>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pendingAttachmentsRef = useRef<ReadonlyArray<PendingAttachment>>([]);
  const dragCounterRef = useRef<number>(0);
  const dragWidthRef = useRef<number>(chatWidth);
  const abortRef = useRef<AbortController | null>(null);

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
    return createLocalChatRequestBody(draftWireMessages, selectedModel, timezone);
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
    if (isStreaming) {
      return;
    }

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
    const initialRequestBody = createLocalChatRequestBody(initialWireMessages, selectedModel, timezone);
    if (toRequestBodySizeBytes(initialRequestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      markAssistantError(ATTACHMENT_LIMIT_ERROR_MESSAGE);
      return;
    }

    appendUserMessage(contentParts);
    setInputText("");
    setPendingAttachmentsState([]);
    setIsStreaming(true);

    let hasStartedAssistant = false;
    startAssistantMessage();
    hasStartedAssistant = true;

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const storageState = await ensurePersistentStorage();
      console.info("chat_local_storage_state", storageState);

      const localToolExecutor = createLocalToolExecutor(appData);
      await runLocalChatRuntime(
        {
          createRequestBody: createLocalChatRequestBody,
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
          signal: abortController.signal,
          callbacks: {
            onAssistantStarted: () => {
              if (hasStartedAssistant) {
                return;
              }

              startAssistantMessage();
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
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const rootClassName = mode === "sidebar" ? "chat-sidebar" : "chat-sidebar-fullscreen";

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
              if (abortRef.current !== null) {
                abortRef.current.abort();
                abortRef.current = null;
              }
              setIsStreaming(false);
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

        <textarea
          name="chatMessage"
          className="chat-textarea"
          placeholder="Ask about cards, review history, or attach notes..."
          value={inputText}
          rows={1}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="chat-controls">
          <ModelSelector
            value={selectedModel}
            onChange={handleModelChange}
            locked={messages.length > 0 || isStreaming}
          />
          <div className="chat-controls-right">
            <FileAttachment onAttach={handleAttach} />
            <button
              type="button"
              className="chat-send-btn"
              disabled={isStreaming}
              onClick={() => void sendMessage()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
