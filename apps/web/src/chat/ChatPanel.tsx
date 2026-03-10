import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  createLocalChatRequestBody,
  sendLocalChatDiagnostics,
  streamLocalChat,
} from "../api";
import { webAppVersion } from "../clientIdentity";
import { DEFAULT_MODEL_ID } from "../chatModels";
import { useAppData } from "../appData";
import { ensurePersistentStorage } from "../syncStorage";
import type {
  ContentPart,
  LocalChatDiagnosticsPayload,
  LocalChatStreamEvent,
} from "../types";
import { useChatLayout } from "./ChatLayoutContext";
import {
  checkFileSize,
  FileAttachment,
  prepareAttachment,
  type PendingAttachment,
} from "./FileAttachment";
import { createLocalToolExecutor } from "./localToolExecutor";
import { parseLocalSSELine, toLocalChatMessages } from "./localRuntime";
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

async function reportLocalChatDiagnostics(payload: LocalChatDiagnosticsPayload): Promise<void> {
  console.info("chat_local_frontend_diagnostics", payload);

  try {
    await sendLocalChatDiagnostics(payload);
  } catch (error) {
    console.error("chat_local_frontend_diagnostics_failed", {
      clientRequestId: payload.clientRequestId,
      backendRequestId: payload.backendRequestId,
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
  if (name === "get_workspace_context") return "Workspace context";
  if (name === "list_cards") return "List cards";
  if (name === "get_cards") return "Get cards";
  if (name === "search_cards") return "Search cards";
  if (name === "list_due_cards") return "List due cards";
  if (name === "list_decks") return "List decks";
  if (name === "search_decks") return "Search decks";
  if (name === "get_decks") return "Get decks";
  if (name === "list_review_history") return "Review history";
  if (name === "get_scheduler_settings") return "Scheduler settings";
  if (name === "get_cloud_settings") return "Cloud settings";
  if (name === "list_outbox") return "Outbox";
  if (name === "summarize_deck_state") return "Deck summary";
  if (name === "create_cards") return "Create cards";
  if (name === "update_cards") return "Update cards";
  if (name === "delete_cards") return "Delete cards";
  if (name === "create_decks") return "Create decks";
  if (name === "update_decks") return "Update decks";
  if (name === "delete_decks") return "Delete decks";
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
  const appData = useAppData();
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

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef<number>(0);
  const dragWidthRef = useRef<number>(chatWidth);
  const abortRef = useRef<AbortController | null>(null);

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

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const storageState = await ensurePersistentStorage();
      console.info("chat_local_storage_state", storageState);

      const localToolExecutor = createLocalToolExecutor(appData);
      const clientRequestId = globalThis.crypto.randomUUID();
      const requestStartedAt = Date.now();
      const wireMessages = [...toLocalChatMessages([
        ...messages,
        {
          role: "user",
          content: contentParts,
          timestamp: Date.now(),
          isError: false,
        },
      ])];
      let receivedContent = false;
      let backendRequestId: string | null = null;
      let bufferLength = 0;
      let lastEventType: string | null = null;

      while (true) {
        const requestBody = createLocalChatRequestBody(wireMessages, selectedModel, timezone);
        if (JSON.stringify(requestBody).length > MAX_BODY_BYTES) {
          markAssistantError("Request is too large for the local chat endpoint.");
          return;
        }

        let response: Response | null = null;
        let buffer = "";
        let lineNumber = 0;
        let responseStatusCode: number | null = null;

        function reportLocalDiagnostics(
          stage: string,
          errorKind: string,
          extra: Readonly<{
            eventType: string | null;
            toolName: string | null;
            toolCallId: string | null;
            lineNumber: number | null;
            rawSnippet: string | null;
            decoderSummary: string | null;
          }>,
        ): void {
          const responseMetadata = buildChatResponseMetadata(response);
          backendRequestId = responseMetadata.responseRequestId;
          responseStatusCode = responseMetadata.statusCode;
          bufferLength = buffer.length;
          lastEventType = extra.eventType;

          void reportLocalChatDiagnostics({
            clientRequestId,
            backendRequestId: responseMetadata.responseRequestId,
            stage,
            errorKind,
            statusCode: responseMetadata.statusCode,
            eventType: extra.eventType,
            toolName: extra.toolName,
            toolCallId: extra.toolCallId,
            lineNumber: extra.lineNumber,
            rawSnippet: extra.rawSnippet,
            decoderSummary: extra.decoderSummary,
            selectedModel,
            messageCount: requestBody.messages.length,
            appVersion: webAppVersion,
            devicePlatform: "web",
          });
        }

        response = await streamLocalChat(requestBody, abortController.signal);
        responseStatusCode = response.status;
        backendRequestId = buildChatResponseMetadata(response).responseRequestId;
        if (!response.ok) {
          const message = `Error ${response.status}: ${sanitizeErrorText(response.status, await response.text())}`;
          markAssistantError(message);
          reportLocalDiagnostics("response_not_ok", "response_not_ok", {
            eventType: null,
            toolName: null,
            toolCallId: null,
            lineNumber: null,
            rawSnippet: null,
            decoderSummary: message,
          });
          return;
        }

        const reader = response.body?.getReader();
        if (reader === undefined) {
          markAssistantError("The local chat response stream is missing.");
          reportLocalDiagnostics("missing_reader", "missing_reader", {
            eventType: null,
            toolName: null,
            toolCallId: null,
            lineNumber: null,
            rawSnippet: null,
            decoderSummary: "ReadableStream reader is unavailable",
          });
          return;
        }

        const decoder = new TextDecoder();
        const pendingToolCalls: Array<Extract<LocalChatStreamEvent, { type: "tool_call_request" }>> = [];
        const assistantContentParts: Array<ContentPart> = [];
        let shouldAwaitToolResults = false;

        function upsertAssistantToolCallPart(
          part: Extract<ContentPart, { type: "tool_call" }>,
        ): void {
          const existingIndex = assistantContentParts.findIndex(
            (contentPart) => contentPart.type === "tool_call" && contentPart.toolCallId === part.toolCallId,
          );
          if (existingIndex >= 0) {
            assistantContentParts[existingIndex] = part;
            return;
          }

          assistantContentParts.push(part);
        }

        function appendAssistantText(text: string): void {
          const lastPart = assistantContentParts[assistantContentParts.length - 1];
          if (lastPart !== undefined && lastPart.type === "text") {
            assistantContentParts[assistantContentParts.length - 1] = {
              ...lastPart,
              text: lastPart.text + text,
            };
          } else {
            assistantContentParts.push({ type: "text", text });
          }

          appendAssistantChunk(text);
        }

        function ensureVisibleToolCall(
          toolCallId: string,
          name: string,
          status: "started" | "completed",
          input: string | null,
          output: string | null,
        ): void {
          const hasExistingToolCall = assistantContentParts.some(
            (part) => part.type === "tool_call" && part.toolCallId === toolCallId,
          );

          if (status === "started" || hasExistingToolCall === false) {
            appendToolCall(name, toolCallId);
          }

          upsertAssistantToolCallPart({
            type: "tool_call",
            toolCallId,
            name,
            status,
            input,
            output,
          });

          if (status === "completed") {
            completeToolCall(toolCallId, input, output);
          }
        }

        function processLocalStreamLine(line: string): string | null {
          lineNumber += 1;
          const trimmedLine = line.trim();
          if (trimmedLine === "") {
            return null;
          }

          const event = parseLocalSSELine(trimmedLine);
          if (event === null) {
            reportLocalDiagnostics("decoding_event_json", "invalid_sse_event_json", {
              eventType: null,
              toolName: null,
              toolCallId: null,
              lineNumber,
              rawSnippet: trimmedLine,
              decoderSummary: "The local SSE event JSON could not be decoded",
            });
            return "The local chat stream returned an invalid event.";
          }

          lastEventType = event.type;

          if (event.type === "delta") {
            receivedContent = true;
            appendAssistantText(event.text);
            return null;
          }

          if (event.type === "repair_attempt") {
            return null;
          }

          if (event.type === "tool_call") {
            receivedContent = true;
            ensureVisibleToolCall(event.toolCallId, event.name, event.status, event.input, event.output);
            return null;
          }

          if (event.type === "tool_call_request") {
            receivedContent = true;
            ensureVisibleToolCall(event.toolCallId, event.name, "started", event.input, null);
            pendingToolCalls.push(event);
            return null;
          }

          if (event.type === "await_tool_results") {
            shouldAwaitToolResults = true;
            return null;
          }

          if (event.type === "done") {
            return null;
          }

          reportLocalDiagnostics(event.stage, event.code, {
            eventType: event.type,
            toolName: null,
            toolCallId: null,
            lineNumber,
            rawSnippet: trimmedLine,
            decoderSummary: event.message,
          });
          return event.message;
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const errorMessage = processLocalStreamLine(line);
            if (errorMessage !== null) {
              markAssistantError(errorMessage);
              return;
            }
          }
        }

        buffer += decoder.decode();
        if (buffer !== "") {
          const lines = buffer.split("\n");
          buffer = "";
          for (const line of lines) {
            const errorMessage = processLocalStreamLine(line);
            if (errorMessage !== null) {
              markAssistantError(errorMessage);
              return;
            }
          }
        }

        if (shouldAwaitToolResults) {
          if (pendingToolCalls.length === 0) {
            const message = "The local chat runtime requested tool results without any tool call.";
            markAssistantError(message);
            reportLocalDiagnostics("await_tool_results", "missing_tool_call_request", {
              eventType: "await_tool_results",
              toolName: null,
              toolCallId: null,
              lineNumber: null,
              rawSnippet: null,
              decoderSummary: "await_tool_results without tool_call_request",
            });
            return;
          }

          wireMessages.push({
            role: "assistant",
            content: assistantContentParts,
          });

          for (const toolCall of pendingToolCalls) {
            try {
              const result = await localToolExecutor.execute({
                toolCallId: toolCall.toolCallId,
                name: toolCall.name,
                input: toolCall.input,
              });
              completeToolCall(toolCall.toolCallId, toolCall.input, result.output);
              wireMessages.push({
                role: "tool",
                toolCallId: toolCall.toolCallId,
                name: toolCall.name,
                output: result.output,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              markAssistantError(message);
              reportLocalDiagnostics("tool_execution", "tool_execution_failed", {
                eventType: "tool_call_request",
                toolName: toolCall.name,
                toolCallId: toolCall.toolCallId,
                lineNumber: null,
                rawSnippet: toolCall.input,
                decoderSummary: message,
              });
              return;
            }
          }

          continue;
        }

        if (receivedContent) {
          finalizeAssistant();
          void reportLocalChatDiagnostics({
            clientRequestId,
            backendRequestId,
            stage: "success",
            errorKind: "success",
            statusCode: responseStatusCode,
            eventType: lastEventType,
            toolName: null,
            toolCallId: null,
            lineNumber: null,
            rawSnippet: null,
            decoderSummary: null,
            selectedModel,
            messageCount: requestBody.messages.length,
            appVersion: webAppVersion,
            devicePlatform: "web",
          });
        } else {
          markAssistantError("The assistant returned an empty response.");
          void reportLocalChatDiagnostics({
            clientRequestId,
            backendRequestId,
            stage: "empty_response",
            errorKind: "empty_response",
            statusCode: responseStatusCode,
            eventType: lastEventType,
            toolName: null,
            toolCallId: null,
            lineNumber: null,
            rawSnippet: null,
            decoderSummary: `Empty local response after ${Date.now() - requestStartedAt}ms with buffer length ${bufferLength}`,
            selectedModel,
            messageCount: requestBody.messages.length,
            appVersion: webAppVersion,
            devicePlatform: "web",
          });
        }
        return;
      }
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
