import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { createChatRequestBody, sendChatDiagnostics, streamChat, type ChatRequestBody } from "../api";
import { DEFAULT_MODEL_ID } from "../chatModels";
import type { ChatDiagnosticsPayload, ChatStreamEvent, ContentPart } from "../types";
import { useChatLayout } from "./ChatLayoutContext";
import {
  checkFileSize,
  FileAttachment,
  prepareAttachment,
  type PendingAttachment,
} from "./FileAttachment";
import { ModelSelector } from "./ModelSelector";
import { useChatHistory, type StoredMessage } from "./useChatHistory";

type Props = Readonly<{
  mode: "sidebar" | "fullscreen";
}>;

const STORAGE_MODEL_KEY = "flashcards-chat-model";
const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BODY_BYTES = 90 * 1024 * 1024;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;

type ChatResponseMetadata = Readonly<{
  statusCode: number | null;
  responseRequestId: string | null;
  responseContentType: string | null;
  responseContentLength: string | null;
  responseContentEncoding: string | null;
  responseCacheControl: string | null;
  responseAmznRequestId: string | null;
  responseApiGatewayId: string | null;
  responseBodyMissing: boolean;
}>;

/**
 * Normalizes exposed response headers so diagnostics can distinguish truly
 * missing values from empty strings returned by intermediate infrastructure.
 */
function readResponseHeader(response: Response, headerName: string): string | null {
  const value = response.headers.get(headerName);
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

/**
 * Captures the subset of response metadata needed to correlate browser stream
 * behavior with API Gateway and backend logs.
 */
function buildChatResponseMetadata(response: Response | null): ChatResponseMetadata {
  if (response === null) {
    return {
      statusCode: null,
      responseRequestId: null,
      responseContentType: null,
      responseContentLength: null,
      responseContentEncoding: null,
      responseCacheControl: null,
      responseAmznRequestId: null,
      responseApiGatewayId: null,
      responseBodyMissing: true,
    };
  }

  return {
    statusCode: response.status,
    responseRequestId: readResponseHeader(response, "x-chat-request-id"),
    responseContentType: readResponseHeader(response, "content-type"),
    responseContentLength: readResponseHeader(response, "content-length"),
    responseContentEncoding: readResponseHeader(response, "content-encoding"),
    responseCacheControl: readResponseHeader(response, "cache-control"),
    responseAmznRequestId: readResponseHeader(response, "x-amzn-requestid"),
    responseApiGatewayId: readResponseHeader(response, "x-amz-apigw-id"),
    responseBodyMissing: response.body === null,
  };
}

/**
 * Reports diagnostics both to the local console and to the backend endpoint so
 * production-only stream failures can be compared with CloudWatch logs.
 */
async function reportChatDiagnostics(payload: ChatDiagnosticsPayload): Promise<void> {
  console.info("chat_frontend_diagnostics", payload);

  try {
    await sendChatDiagnostics(payload);
  } catch (error) {
    console.error("chat_frontend_diagnostics_failed", {
      clientRequestId: payload.clientRequestId,
      responseRequestId: payload.responseRequestId,
      stage: payload.stage,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildContentParts(
  text: string,
  attachments: ReadonlyArray<PendingAttachment>,
): ReadonlyArray<ContentPart> {
  const parts: Array<ContentPart> = [];

  for (const attachment of attachments) {
    if (IMAGE_MEDIA_TYPES.has(attachment.mediaType)) {
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

function parseSSELine(line: string): ChatStreamEvent | null {
  if (!line.startsWith("data: ")) {
    return null;
  }

  try {
    return JSON.parse(line.slice(6)) as ChatStreamEvent;
  } catch {
    return null;
  }
}

function sanitizeErrorText(status: number, raw: string): string {
  if (raw.trim().length === 0 && status === 500) {
    return "The backend returned an empty error response.";
  }

  if (raw.includes("<html") || raw.includes("<!DOCTYPE")) {
    return "The request was blocked by an upstream HTML response.";
  }

  return raw;
}

export function formatToolLabel(name: string): string {
  if (name === "list_cards") return "List cards";
  if (name === "get_cards") return "Get cards";
  if (name === "search_cards") return "Search cards";
  if (name === "list_due_cards") return "List due cards";
  if (name === "list_review_history") return "Review history";
  if (name === "summarize_deck_state") return "Deck summary";
  if (name === "create_cards") return "Create cards";
  if (name === "update_cards") return "Update cards";
  if (name === "delete_cards") return "Delete cards";
  if (name === "code_execution" || name === "code_interpreter") return "Code execution";
  if (name === "web_search") return "Web search";
  return name;
}

function renderMessageContent(message: StoredMessage): ReactElement {
  const elements: Array<ReactElement> = [];

  for (let index = 0; index < message.content.length; index++) {
    const part = message.content[index];
    if (part.type === "text") {
      elements.push(<span key={`text-${index}`}>{part.text}</span>);
      continue;
    }

    if (part.type === "image") {
      elements.push(<span key={`image-${index}`}>[image attached]</span>);
      continue;
    }

    if (part.type === "file") {
      elements.push(<span key={`file-${index}`}>[{part.fileName}]</span>);
      continue;
    }

    elements.push(
      <details
        key={`tool-${index}`}
        className={`chat-tool-call${part.status === "started" ? " chat-tool-call-started" : ""}`}
      >
        <summary className="chat-tool-call-summary">{formatToolLabel(part.name)}</summary>
        {part.input !== null ? <pre className="chat-tool-call-input">{part.input}</pre> : null}
        {part.output !== null ? <pre className="chat-tool-call-output">{part.output}</pre> : null}
      </details>,
    );
  }

  return <>{elements}</>;
}

export function ChatPanel(props: Props): ReactElement {
  const { mode } = props;
  const { setIsOpen, chatWidth, setChatWidth } = useChatLayout();
  const [localWidth, setLocalWidth] = useState<number>(chatWidth);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const {
    messages,
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

  const messagesRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const savedModel = localStorage.getItem(STORAGE_MODEL_KEY);
    if (savedModel !== null) {
      setSelectedModel(savedModel);
    }
  }, []);

  useEffect(() => {
    setLocalWidth(chatWidth);
  }, [chatWidth]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element !== null) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      const isRtl = document.documentElement.dir === "rtl";
      const rawWidth = isRtl ? window.innerWidth - event.clientX : event.clientX;
      setLocalWidth(Math.max(MIN_WIDTH, Math.min(rawWidth, MAX_WIDTH)));
    }

    function handleMouseUp(): void {
      setIsDragging(false);
      setChatWidth(localWidth);
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
  }, [isDragging, localWidth, setChatWidth]);

  function handleModelChange(modelId: string): void {
    setSelectedModel(modelId);
    localStorage.setItem(STORAGE_MODEL_KEY, modelId);
  }

  function handleAttach(attachment: PendingAttachment): void {
    setPendingAttachments((currentAttachments) => [...currentAttachments, attachment]);
  }

  function removeAttachment(index: number): void {
    setPendingAttachments((currentAttachments) => [
      ...currentAttachments.slice(0, index),
      ...currentAttachments.slice(index + 1),
    ]);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const files = event.dataTransfer.files;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const sizeError = checkFileSize(file);
      if (sizeError !== null) {
        window.alert(sizeError);
        continue;
      }

      handleAttach(await prepareAttachment(file));
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

    appendUserMessage(contentParts);
    setInputText("");
    setPendingAttachments([]);
    setIsStreaming(true);
    startAssistantMessage();

    const allMessages = [
      ...messages.map((message) => ({ role: message.role, content: message.content })),
      { role: "user" as const, content: contentParts },
    ];

    const requestBody: ChatRequestBody = createChatRequestBody(
      allMessages,
      selectedModel,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );

    if (JSON.stringify(requestBody).length > MAX_BODY_BYTES) {
      markAssistantError("Request is too large for the chat endpoint.");
      setIsStreaming(false);
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    const clientRequestId = globalThis.crypto.randomUUID();
    const requestStartedAt = Date.now();
    let response: Response | null = null;
    let buffer = "";
    let chunkCount = 0;
    let bytesReceived = 0;
    let lineCount = 0;
    let nonEmptyLineCount = 0;
    let parseNullCount = 0;
    let deltaEventCount = 0;
    let toolCallEventCount = 0;
    let errorEventCount = 0;
    let doneEventCount = 0;
    let receivedContent = false;
    let streamEnded = false;
    let readerMissing = false;
    let lastEventType: string | null = null;

    function reportDiagnostics(stage: ChatDiagnosticsPayload["stage"], errorName: string | null): void {
      const responseMetadata = buildChatResponseMetadata(response);
      const payload: ChatDiagnosticsPayload = {
        clientRequestId,
        responseRequestId: responseMetadata.responseRequestId,
        model: requestBody.model,
        stage,
        statusCode: responseMetadata.statusCode,
        responseContentType: responseMetadata.responseContentType,
        responseContentLength: responseMetadata.responseContentLength,
        responseContentEncoding: responseMetadata.responseContentEncoding,
        responseCacheControl: responseMetadata.responseCacheControl,
        responseAmznRequestId: responseMetadata.responseAmznRequestId,
        responseApiGatewayId: responseMetadata.responseApiGatewayId,
        responseBodyMissing: responseMetadata.responseBodyMissing,
        chunkCount,
        bytesReceived,
        lineCount,
        nonEmptyLineCount,
        parseNullCount,
        deltaEventCount,
        toolCallEventCount,
        errorEventCount,
        doneEventCount,
        receivedContent,
        streamEnded,
        readerMissing,
        aborted: abortController.signal.aborted,
        durationMs: Date.now() - requestStartedAt,
        bufferLength: buffer.length,
        errorName,
        lastEventType,
      };

      void reportChatDiagnostics(payload);
    }

    function processStreamLine(line: string): string | null {
      lineCount += 1;
      const trimmedLine = line.trim();
      if (trimmedLine === "") {
        return null;
      }

      nonEmptyLineCount += 1;
      const event = parseSSELine(trimmedLine);
      if (event === null) {
        parseNullCount += 1;
        return null;
      }

      lastEventType = event.type;

      if (event.type === "delta") {
        deltaEventCount += 1;
        receivedContent = true;
        appendAssistantChunk(event.text);
        return null;
      }

      if (event.type === "tool_call") {
        toolCallEventCount += 1;
        receivedContent = true;
        if (event.status === "started") {
          appendToolCall(event.name);
        } else {
          completeToolCall(event.name, event.input ?? null, event.output ?? null);
        }

        return null;
      }

      if (event.type === "done") {
        doneEventCount += 1;
        return null;
      }

      errorEventCount += 1;
      markAssistantError(event.message);
      return event.message;
    }

    try {
      response = await streamChat(requestBody, abortController.signal);
      if (!response.ok) {
        markAssistantError(`Error ${response.status}: ${sanitizeErrorText(response.status, await response.text())}`);
        reportDiagnostics("response_not_ok", null);
        return;
      }

      const reader = response.body?.getReader();
      if (reader === undefined) {
        readerMissing = true;
        markAssistantError("The chat response stream is missing.");
        reportDiagnostics("missing_reader", null);
        return;
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamEnded = true;
          break;
        }

        chunkCount += 1;
        bytesReceived += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const errorMessage = processStreamLine(line);
          if (errorMessage !== null) {
            reportDiagnostics("stream_error_event", "stream_error_event");
            return;
          }
        }
      }

      buffer += decoder.decode();
      if (buffer !== "") {
        const lines = buffer.split("\n");
        buffer = "";
        for (const line of lines) {
          const errorMessage = processStreamLine(line);
          if (errorMessage !== null) {
            reportDiagnostics("stream_error_event", "stream_error_event");
            return;
          }
        }
      }

      if (receivedContent) {
        finalizeAssistant();
        reportDiagnostics("success", null);
      } else {
        markAssistantError("The assistant returned an empty response.");
        reportDiagnostics("empty_response", null);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        reportDiagnostics("aborted", error instanceof Error ? error.name : null);
      } else {
        markAssistantError(error instanceof Error ? error.message : String(error));
        reportDiagnostics("fetch_throw", error instanceof Error ? error.name : null);
      }
    } finally {
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
            Clear
          </button>
          {mode === "sidebar" ? (
            <button type="button" className="chat-close-btn" onClick={() => setIsOpen(false)}>
              &laquo;
            </button>
          ) : null}
        </div>
      </div>

      <div className="chat-messages" ref={messagesRef}>
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
              {renderMessageContent(message)}
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
