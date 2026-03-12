// @vitest-environment jsdom

import { act, createElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { calculateSidebarWidthFromPointer } from "./chatHelpers";
import { formatToolLabel } from "./chatMessageContent";

const {
  useChatLayoutMock,
  useAppDataMock,
  createLocalChatRequestBodyMock,
  sendLocalChatDiagnosticsMock,
  streamLocalChatMock,
  transcribeChatAudioMock,
  ensurePersistentStorageMock,
  executeLocalToolMock,
  checkFileSizeMock,
  prepareAttachmentMock,
  recompressImageAttachmentMock,
} = vi.hoisted(() => ({
  useChatLayoutMock: vi.fn(),
  useAppDataMock: vi.fn(),
  createLocalChatRequestBodyMock: vi.fn(),
  sendLocalChatDiagnosticsMock: vi.fn(),
  streamLocalChatMock: vi.fn(),
  transcribeChatAudioMock: vi.fn(),
  ensurePersistentStorageMock: vi.fn(),
  executeLocalToolMock: vi.fn(),
  checkFileSizeMock: vi.fn(),
  prepareAttachmentMock: vi.fn(),
  recompressImageAttachmentMock: vi.fn(),
}));

vi.mock("../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("./ChatLayoutContext", () => ({
  useChatLayout: useChatLayoutMock,
}));

vi.mock("../api", () => ({
  createLocalChatRequestBody: createLocalChatRequestBodyMock,
  sendLocalChatDiagnostics: sendLocalChatDiagnosticsMock,
  streamLocalChat: streamLocalChatMock,
  transcribeChatAudio: transcribeChatAudioMock,
}));

vi.mock("../syncStorage", () => ({
  ensurePersistentStorage: ensurePersistentStorageMock,
}));

vi.mock("./localToolExecutor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./localToolExecutor")>();
  return {
    ...actual,
    createLocalToolExecutor: () => ({
      execute: executeLocalToolMock,
    }),
  };
});

vi.mock("./FileAttachment", () => ({
  checkFileSize: checkFileSizeMock,
  prepareAttachment: prepareAttachmentMock,
  recompressImageAttachment: recompressImageAttachmentMock,
  EXTRA_AGGRESSIVE_IMAGE_COMPRESSION: {
    maxSidePixels: 1_280,
    quality: 0.55,
  },
  FileAttachment: ({ disabled, onAttach }: Readonly<{
    disabled?: boolean;
    onAttach: (attachment: {
      fileName: string;
      mediaType: string;
      base64Data: string;
    }) => Promise<void> | void;
  }>) => createElement(
    "button",
    {
      type: "button",
      className: "chat-attach-btn",
      "aria-label": "Add attachment",
      title: "Add attachment",
      disabled: disabled === true,
      onClick: () => {
        void onAttach({
          fileName: "attached.txt",
          mediaType: "text/plain",
          base64Data: "YXR0YWNoZWQ=",
        });
      },
    },
    createElement(
      "span",
      {
        className: "chat-attach-btn-icon",
        "aria-hidden": "true",
      },
    ),
  ),
}));

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextareaSelection(textarea: HTMLTextAreaElement, start: number, end: number): void {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  textarea.dispatchEvent(new Event("select", { bubbles: true }));
}

function configureMessagesScroller(element: HTMLDivElement): void {
  let scrollTop = 600;

  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => 1_000,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
}

function streamDeltaPayload(text: string): string {
  return `data: ${JSON.stringify({ type: "delta", text })}\n`;
}

function createSSELine(event: object): string {
  return `data: ${JSON.stringify(event)}\n`;
}

function createStreamResponse(payloads: ReadonlyArray<string>, status: number = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(payload));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "x-chat-request-id": "request-1",
    },
  });
}

function createTimedStreamResponse(
  chunks: ReadonlyArray<Readonly<{ atMs: number; payload: string }>>,
  closeAtMs: number,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) {
        window.setTimeout(() => {
          controller.enqueue(encoder.encode(chunk.payload));
        }, chunk.atMs);
      }

      window.setTimeout(() => {
        controller.close();
      }, closeAtMs);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "x-chat-request-id": "request-1",
    },
  });
}

function createAbortableTimedStreamResponse(
  signal: AbortSignal,
  chunks: ReadonlyArray<Readonly<{ atMs: number; payload: string }>>,
  closeAtMs: number,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      const timeoutIds = chunks.map((chunk) => window.setTimeout(() => {
        controller.enqueue(encoder.encode(chunk.payload));
      }, chunk.atMs));
      const closeTimeoutId = window.setTimeout(() => {
        controller.close();
      }, closeAtMs);

      signal.addEventListener("abort", () => {
        timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
        window.clearTimeout(closeTimeoutId);
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "x-chat-request-id": "request-1",
    },
  });
}

function readScrollBehavior(call: ReadonlyArray<unknown>): string | null {
  const firstArg = call[0];
  if (typeof firstArg !== "object" || firstArg === null) {
    return null;
  }

  if (!("behavior" in firstArg)) {
    return null;
  }

  const behavior = firstArg.behavior;
  return typeof behavior === "string" ? behavior : null;
}

function countSmoothCalls(scrollToCalls: ReadonlyArray<ReadonlyArray<unknown>>): number {
  return scrollToCalls.filter((call) => readScrollBehavior(call) === "smooth").length;
}

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.get(key) ?? null;
    },
    key(index: number): string | null {
      const keys = [...entries.keys()];
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      entries.set(key, value);
    },
  };
}

function createDeferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  if (resolvePromise === null) {
    throw new Error("Expected deferred promise resolver");
  }

  return {
    promise,
    resolve: resolvePromise,
  };
}

function createMediaStreamMock(): MediaStream {
  return {
    getTracks: () => [{
      stop: vi.fn(),
    } as unknown as MediaStreamTrack],
  } as unknown as MediaStream;
}

class MockMediaRecorder {
  static nextBlob: Blob = new Blob(["dictation"], { type: "audio/webm" });

  readonly mimeType: string;
  state: RecordingState;
  private readonly listeners: Map<string, Set<(event: Event) => void>>;

  constructor(_stream: MediaStream) {
    this.mimeType = "audio/webm";
    this.state = "inactive";
    this.listeners = new Map();
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === "function"
      ? listener
      : (event: Event) => listener.handleEvent(event);
    const currentListeners = this.listeners.get(type) ?? new Set();
    currentListeners.add(callback);
    this.listeners.set(type, currentListeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const currentListeners = this.listeners.get(type);
    if (currentListeners === undefined) {
      return;
    }

    const callback = typeof listener === "function"
      ? listener
      : (event: Event) => listener.handleEvent(event);
    currentListeners.delete(callback);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    const dataListeners = [...(this.listeners.get("dataavailable") ?? [])];
    dataListeners.forEach((listener) => listener({ data: MockMediaRecorder.nextBlob } as unknown as Event));
    const stopListeners = [...(this.listeners.get("stop") ?? [])];
    stopListeners.forEach((listener) => listener(new Event("stop")));
  }
}

describe("formatToolLabel", () => {
  it("renders labels for the reduced local tool surface", () => {
    expect(formatToolLabel("sql")).toBe("SQL");
    expect(formatToolLabel("get_cloud_settings")).toBe("Cloud settings");
    expect(formatToolLabel("list_outbox")).toBe("Outbox");
  });
});

describe("ChatPanel autoscroll", () => {
  let container: HTMLDivElement | null;
  let root: ReactDOM.Root | null;
  let scrollToMock: ReturnType<typeof vi.fn>;
  let clipboardWriteTextMock: ReturnType<typeof vi.fn>;
  let alertMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("localStorage", createMemoryStorage());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    alertMock = vi.fn();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
    vi.stubGlobal("alert", alertMock);

    useChatLayoutMock.mockReset();
    useAppDataMock.mockReset();
    createLocalChatRequestBodyMock.mockReset();
    sendLocalChatDiagnosticsMock.mockReset();
    streamLocalChatMock.mockReset();
    transcribeChatAudioMock.mockReset();
    ensurePersistentStorageMock.mockReset();
    executeLocalToolMock.mockReset();
    checkFileSizeMock.mockReset();
    prepareAttachmentMock.mockReset();
    recompressImageAttachmentMock.mockReset();

    useChatLayoutMock.mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });
    useAppDataMock.mockReturnValue({
      getLocalSnapshot: () => ({
        cards: [
          { cardId: "card-active", deletedAt: null },
          { cardId: "card-deleted", deletedAt: "2026-03-09T00:00:00.000Z" },
        ],
        decks: [],
        reviewEvents: [],
        workspaceSettings: null,
        cloudSettings: null,
        outbox: [],
        lastAppliedChangeId: 0,
      }),
    });
    createLocalChatRequestBodyMock.mockImplementation(
      (messages: ReadonlyArray<unknown>, model: string, timezone: string, userContext: unknown) => ({
        messages,
        model,
        timezone,
        userContext,
      }),
    );
    sendLocalChatDiagnosticsMock.mockResolvedValue(undefined);
    ensurePersistentStorageMock.mockResolvedValue({
      persistence: "granted",
    });
    executeLocalToolMock.mockResolvedValue({
      output: "{}",
    });
    streamLocalChatMock.mockResolvedValue(
      createTimedStreamResponse([{ atMs: 0, payload: streamDeltaPayload("done") }], 1),
    );
    transcribeChatAudioMock.mockResolvedValue("dictated text");
    checkFileSizeMock.mockReturnValue(null);
    prepareAttachmentMock.mockResolvedValue({
      fileName: "test-file.txt",
      mediaType: "application/pdf",
      base64Data: "dGVzdA==",
    });
    recompressImageAttachmentMock.mockResolvedValue({
      fileName: "test-image.jpg",
      mediaType: "image/jpeg",
      base64Data: "dGVzdA==",
    });

    scrollToMock = vi.fn(function thisBoundScrollTo(
      this: HTMLElement,
      options: ScrollToOptions | number,
      y?: number,
    ): void {
      if (typeof options === "number") {
        if (typeof y === "number") {
          this.scrollTop = y;
        }
        return;
      }

      if (typeof options.top === "number") {
        this.scrollTop = options.top;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollToMock,
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => createMediaStreamMock()),
      },
    });
    Object.defineProperty(window.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    const mountedRoot = root;
    if (mountedRoot !== null) {
      act(() => mountedRoot.unmount());
      root = null;
    }
    if (container !== null) {
      container.remove();
      container = null;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderChatPanel(): Promise<void> {
    expect(root).not.toBeNull();
    await act(async () => {
      root?.render(createElement(ChatPanel, { mode: "fullscreen" }));
    });
  }

  async function sendMessage(text: string): Promise<void> {
    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }
    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();
    const sendButton = mountedContainer.querySelector(".chat-send-btn");
    expect(sendButton).not.toBeNull();

    await act(async () => {
      const input = textarea as HTMLTextAreaElement;
      setTextareaValue(input, text);
    });

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function stopStreaming(): Promise<void> {
    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const stopButton = mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]');
    expect(stopButton).not.toBeNull();

    await act(async () => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("snaps to bottom without smooth animation after loading persisted history", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{ type: "text", text: "Persisted answer" }],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const behaviors = scrollToMock.mock.calls.map((call) => readScrollBehavior(call));
    expect(behaviors).toContain("auto");
    expect(behaviors).not.toContain("smooth");
  });

  it("renders a blank line between attachment markers and following text", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "user",
      content: [
        {
          type: "image",
          mediaType: "image/jpeg",
          base64Data: "abc",
        },
        {
          type: "text",
          text: "what do you see here?",
        },
      ],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const userMessage = mountedContainer.querySelector(".chat-msg-user");
    expect(userMessage).not.toBeNull();
    if (userMessage === null) {
      throw new Error("Expected user message");
    }

    expect(userMessage.querySelectorAll("br")).toHaveLength(2);
    expect(userMessage.textContent).toContain("[image attached]");
    expect(userMessage.textContent).toContain("what do you see here?");
  });

  it("preserves persisted assistant text whitespace", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{ type: "text", text: "\n\n   You're right to ask.\n\n\n\n**What I have:**   \n" }],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const assistantMessage = mountedContainer.querySelector(".chat-msg-assistant");
    expect(assistantMessage).not.toBeNull();
    if (assistantMessage === null) {
      throw new Error("Expected assistant message");
    }

    expect(assistantMessage.textContent).toBe("\n\n   You're right to ask.\n\n\n\n**What I have:**   \n");
  });

  it("preserves streamed assistant text whitespace before rendering the bubble", async () => {
    streamLocalChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 0, payload: streamDeltaPayload("\n\n   First paragraph") },
      { atMs: 10, payload: streamDeltaPayload("\n\n\n\nSecond paragraph   \n") },
    ], 20));

    await renderChatPanel();
    await sendMessage("normalize assistant");

    await act(async () => {
      vi.advanceTimersByTime(25);
      await Promise.resolve();
    });

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const assistantMessages = mountedContainer.querySelectorAll(".chat-msg-assistant");
    expect(assistantMessages.length).toBeGreaterThan(0);
    const assistantMessage = assistantMessages[assistantMessages.length - 1];
    expect(assistantMessage?.textContent).toBe("\n\n   First paragraph\n\n\n\nSecond paragraph   \n");
  });

  it("preserves paragraph boundaries between consecutive persisted assistant text parts", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [
        { type: "text", text: "Точный план изменений:\n- не менять остальные теги\n\n" },
        { type: "text", text: "Подтверди, и я выполню объединение `DSA -> dsa`." },
      ],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const assistantMessage = mountedContainer.querySelector(".chat-msg-assistant");
    expect(assistantMessage).not.toBeNull();
    if (assistantMessage === null) {
      throw new Error("Expected assistant message");
    }

    expect(assistantMessage.children).toHaveLength(1);
    expect(assistantMessage.textContent).toBe(
      "Точный план изменений:\n- не менять остальные теги\n\nПодтверди, и я выполню объединение `DSA -> dsa`.",
    );
  });

  it("preserves paragraph boundaries across streamed assistant deltas", async () => {
    streamLocalChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 0, payload: streamDeltaPayload("Точный план изменений:\n- не менять остальные теги\n\n") },
      { atMs: 10, payload: streamDeltaPayload("Подтверди, и я выполню объединение `DSA -> dsa`.") },
    ], 20));

    await renderChatPanel();
    await sendMessage("merge tags");

    await act(async () => {
      vi.advanceTimersByTime(25);
      await Promise.resolve();
    });

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const assistantMessages = mountedContainer.querySelectorAll(".chat-msg-assistant");
    expect(assistantMessages.length).toBeGreaterThan(0);
    const assistantMessage = assistantMessages[assistantMessages.length - 1];
    expect(assistantMessage?.textContent).toBe(
      "Точный план изменений:\n- не менять остальные теги\n\nПодтверди, и я выполню объединение `DSA -> dsa`.",
    );
  });

  it("replaces send with stop while streaming and allows sending again after stop", async () => {
    streamLocalChatMock
      .mockImplementationOnce((_body: unknown, signal: AbortSignal) => Promise.resolve(
        createAbortableTimedStreamResponse(
          signal,
          [{ atMs: 50, payload: streamDeltaPayload("Partial response") }],
          5_000,
        ),
      ))
      .mockResolvedValueOnce(createTimedStreamResponse([{ atMs: 0, payload: streamDeltaPayload("Second response") }], 1));

    await renderChatPanel();
    await sendMessage("first");

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    expect(mountedContainer.querySelector('.chat-send-btn[aria-label="Send message"]')).toBeNull();
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).not.toBeNull();
    expect((mountedContainer.querySelector(".chat-attach-btn") as HTMLButtonElement | null)?.disabled).toBe(false);
    expect((mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]') as HTMLButtonElement | null)?.disabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });

    expect(mountedContainer.textContent).toContain("Partial response");

    await stopStreaming();

    expect(streamLocalChatMock.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect((streamLocalChatMock.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).toBeNull();
    expect(mountedContainer.querySelector('.chat-send-btn[aria-label="Send message"]')).not.toBeNull();
    expect((mountedContainer.querySelector(".chat-attach-btn") as HTMLButtonElement | null)?.disabled).toBe(false);
    expect(mountedContainer.textContent).toContain("Partial response");

    await sendMessage("second");

    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    expect(streamLocalChatMock).toHaveBeenCalledTimes(2);
    expect(mountedContainer.textContent).toContain("Second response");
  });

  it("keeps tool call blocks in order relative to assistant text without trimming", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [
        { type: "text", text: "Before tool\n\n" },
        {
          type: "tool_call",
          toolCallId: "tool-1",
          name: "sql",
          status: "completed",
          input: "{\"sql\":\"SHOW TABLES\"}",
          output: "{\"rows\":[{\"table_name\":\"cards\"}]}",
        },
        { type: "text", text: "\n\nAfter tool\n\n" },
      ],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const assistantMessage = mountedContainer.querySelector(".chat-msg-assistant");
    expect(assistantMessage).not.toBeNull();
    if (assistantMessage === null) {
      throw new Error("Expected assistant message");
    }

    const children = [...assistantMessage.children];
    expect(children).toHaveLength(3);
    expect(children[0]?.tagName).toBe("SPAN");
    expect(children[0]?.textContent).toBe("Before tool\n\n");
    expect(children[1]?.tagName).toBe("DETAILS");
    const toolDetails = children[1] as HTMLDetailsElement;
    expect(toolDetails.querySelector(".chat-tool-call-summary-main")?.textContent).toBe("SQL: SHOW TABLES");
    expect(toolDetails.querySelector(".chat-tool-call-section-title")?.textContent).toBe("Request");
    expect(toolDetails.querySelector(".chat-tool-call-input")?.textContent).toBe("{\"sql\":\"SHOW TABLES\"}");
    expect(toolDetails.querySelector(".chat-tool-call-output")?.textContent).toBe("{\"rows\":[{\"table_name\":\"cards\"}]}");
    expect(children[2]?.tagName).toBe("SPAN");
    expect(children[2]?.textContent).toBe("\n\nAfter tool\n\n");
  });

  it("renders a pending tool block immediately and upgrades it in place after completion", async () => {
    const deferredToolResult = createDeferred<Readonly<{
      output: string;
      didMutateAppState: boolean;
    }>>();
    executeLocalToolMock.mockImplementationOnce(() => deferredToolResult.promise);
    streamLocalChatMock
      .mockResolvedValueOnce(createStreamResponse([
        createSSELine({ type: "tool_call_request", toolCallId: "tool-1", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}" }),
        createSSELine({ type: "await_tool_results" }),
      ]))
      .mockResolvedValueOnce(createTimedStreamResponse([{ atMs: 0, payload: streamDeltaPayload("Done") }], 1));

    await renderChatPanel();
    await sendMessage("run sql");

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const pendingToolCall = mountedContainer.querySelector(".chat-tool-call-started");
    expect(pendingToolCall).not.toBeNull();
    expect(pendingToolCall?.querySelector(".chat-tool-call-summary-main")?.textContent).toBe("SQL: SHOW TABLES");
    expect(pendingToolCall?.textContent).toContain("Running");
    expect(mountedContainer.querySelectorAll(".chat-tool-call")).toHaveLength(1);

    await act(async () => {
      deferredToolResult.resolve({
        output: "{\"rows\":[]}",
        didMutateAppState: false,
      });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    expect(mountedContainer.querySelectorAll(".chat-tool-call")).toHaveLength(1);
    expect(mountedContainer.querySelector(".chat-tool-call-started")).toBeNull();
    expect(mountedContainer.querySelector(".chat-tool-call-completed")?.textContent).toContain("Done");
    expect(mountedContainer.textContent).toContain("Done");
  });

  it("keeps the collapsed tool call preview in a single summary row and toggles details open and closed", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SELECT cards.front_text, cards.back_text FROM cards WHERE workspace_id = 'workspace-123' ORDER BY updated_at DESC LIMIT 100\"}",
        output: "{\"rows\":[{\"front_text\":\"Question\",\"back_text\":\"Answer\"}]}",
      }],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const toolCall = mountedContainer.querySelector(".chat-tool-call");
    expect(toolCall).not.toBeNull();
    if (toolCall === null) {
      throw new Error("Expected tool call");
    }

    const summaryMain = toolCall.querySelector(".chat-tool-call-summary-main");
    expect(summaryMain).not.toBeNull();
    expect(summaryMain?.getAttribute("title")).toContain("SELECT cards.front_text");

    const summary = toolCall.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(toolCall.hasAttribute("open")).toBe(false);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(toolCall.hasAttribute("open")).toBe(true);
    expect(toolCall.querySelectorAll(".chat-tool-call-section")).toHaveLength(2);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(toolCall.hasAttribute("open")).toBe(false);
  });

  it("shows only the request section for a pending tool call without output", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "started",
        input: "{\"sql\":\"SHOW TABLES\"}",
        output: null,
      }],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const toolCall = mountedContainer.querySelector(".chat-tool-call");
    expect(toolCall).not.toBeNull();
    if (toolCall === null) {
      throw new Error("Expected tool call");
    }

    toolCall.setAttribute("open", "");
    expect(toolCall.querySelectorAll(".chat-tool-call-section")).toHaveLength(1);
    expect(toolCall.querySelector(".chat-tool-call-section-title")?.textContent).toBe("Request");
    expect(toolCall.querySelector(".chat-tool-call-output")).toBeNull();
  });

  it("copies the request and response text from expanded tool call sections", async () => {
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SHOW TABLES\"}",
        output: "{\"rows\":[]}",
      }],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const copyButtons = mountedContainer.querySelectorAll(".chat-tool-call-copy");
    expect(copyButtons).toHaveLength(2);

    await act(async () => {
      copyButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(clipboardWriteTextMock).toHaveBeenNthCalledWith(1, "{\"sql\":\"SHOW TABLES\"}");

    await act(async () => {
      copyButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(clipboardWriteTextMock).toHaveBeenNthCalledWith(2, "{\"rows\":[]}");
  });

  it("alerts when copying a tool call section fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    clipboardWriteTextMock.mockRejectedValueOnce(new Error("Permission denied"));
    localStorage.setItem("flashcards-chat-messages", JSON.stringify([{
      role: "assistant",
      content: [{
        type: "tool_call",
        toolCallId: "tool-1",
        name: "sql",
        status: "completed",
        input: "{\"sql\":\"SHOW TABLES\"}",
        output: "{\"rows\":[]}",
      }],
      timestamp: 1,
      isError: false,
    }]));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const copyButton = mountedContainer.querySelector(".chat-tool-call-copy");
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith("Failed to copy request. Permission denied");
    alertSpy.mockRestore();
  });

  it("batches streaming autoscroll to one smooth scroll every 2 seconds", async () => {
    streamLocalChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 100, payload: streamDeltaPayload("A") },
      { atMs: 300, payload: streamDeltaPayload("B") },
      { atMs: 700, payload: streamDeltaPayload("C") },
    ], 2_600));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }
    const messagesElement = mountedContainer.querySelector(".chat-messages");
    expect(messagesElement).not.toBeNull();
    configureMessagesScroller(messagesElement as HTMLDivElement);
    scrollToMock.mockClear();

    await sendMessage("hello");

    await act(async () => {
      vi.advanceTimersByTime(1_999);
      await Promise.resolve();
    });
    expect(countSmoothCalls(scrollToMock.mock.calls)).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(countSmoothCalls(scrollToMock.mock.calls)).toBe(1);
  });

  it("disables autoscroll when user scrolls up and keeps it off during streaming", async () => {
    streamLocalChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 100, payload: streamDeltaPayload("A") },
      { atMs: 500, payload: streamDeltaPayload("B") },
      { atMs: 900, payload: streamDeltaPayload("C") },
    ], 5_000));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }
    const messagesElement = mountedContainer.querySelector(".chat-messages");
    expect(messagesElement).not.toBeNull();
    const chatMessages = messagesElement as HTMLDivElement;
    configureMessagesScroller(chatMessages);
    scrollToMock.mockClear();

    await sendMessage("keep reading");

    await act(async () => {
      vi.advanceTimersByTime(300);
      chatMessages.scrollTop = 250;
      chatMessages.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1_900);
      await Promise.resolve();
    });

    expect(countSmoothCalls(scrollToMock.mock.calls)).toBe(0);
  });

  it("re-enables autoscroll after returning to bottom and catches up on the next tick", async () => {
    streamLocalChatMock.mockResolvedValueOnce(createTimedStreamResponse([
      { atMs: 100, payload: streamDeltaPayload("A") },
      { atMs: 500, payload: streamDeltaPayload("B") },
      { atMs: 900, payload: streamDeltaPayload("C") },
    ], 6_000));

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }
    const messagesElement = mountedContainer.querySelector(".chat-messages");
    expect(messagesElement).not.toBeNull();
    const chatMessages = messagesElement as HTMLDivElement;
    configureMessagesScroller(chatMessages);
    scrollToMock.mockClear();

    await sendMessage("resume autoscroll");

    await act(async () => {
      vi.advanceTimersByTime(300);
      chatMessages.scrollTop = 250;
      chatMessages.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1_900);
      await Promise.resolve();
    });
    expect(countSmoothCalls(scrollToMock.mock.calls)).toBe(0);

    await act(async () => {
      chatMessages.scrollTop = 600;
      chatMessages.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });

    expect(countSmoothCalls(scrollToMock.mock.calls)).toBe(1);
  });

  it("blocks send before network when post-compression payload exceeds the 9.5 MB safety limit", async () => {
    const oversizedPayload = "x".repeat(10_100_000);
    createLocalChatRequestBodyMock.mockImplementation(
      (messages: ReadonlyArray<unknown>, model: string, timezone: string, userContext: unknown) => ({
        messages,
        model,
        timezone,
        userContext,
        oversizedPayload,
      }),
    );

    await renderChatPanel();
    await sendMessage("trigger limit");

    expect(streamLocalChatMock).not.toHaveBeenCalled();
    expect(ensurePersistentStorageMock).not.toHaveBeenCalled();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }
    expect(mountedContainer.textContent).toContain("Attachment payload limit is 10 MB after compression.");
  });

  it("rejects oversized projected attachment payload before send and keeps pending list unchanged", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    prepareAttachmentMock.mockResolvedValue({
      fileName: "photo.png",
      mediaType: "image/jpeg",
      base64Data: "x".repeat(9_970_000),
    });
    recompressImageAttachmentMock.mockResolvedValue({
      fileName: "photo.png",
      mediaType: "image/jpeg",
      base64Data: "x".repeat(9_970_000),
    });

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const chatRoot = mountedContainer.querySelector(".chat-sidebar-fullscreen");
    expect(chatRoot).not.toBeNull();
    if (chatRoot === null) {
      throw new Error("Expected chat root");
    }

    await act(async () => {
      const file = new File(["123"], "photo.png", { type: "image/png" });
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(dropEvent, "dataTransfer", {
        value: {
          files: [file],
        },
      });
      chatRoot.dispatchEvent(dropEvent);
      await Promise.resolve();
    });

    expect(recompressImageAttachmentMock).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("Attachment payload limit is 10 MB after compression.");
    expect(mountedContainer.querySelector(".chat-attachment-chip")).toBeNull();
    alertSpy.mockRestore();
  });

  it("passes active card totals into local chat request bodies for sends and attachment draft checks", async () => {
    prepareAttachmentMock.mockResolvedValue({
      fileName: "notes.txt",
      mediaType: "text/plain",
      base64Data: "dGVzdA==",
    });

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const chatRoot = mountedContainer.querySelector(".chat-sidebar-fullscreen");
    expect(chatRoot).not.toBeNull();
    if (chatRoot === null) {
      throw new Error("Expected chat root");
    }

    await act(async () => {
      const file = new File(["hello"], "notes.txt", { type: "text/plain" });
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(dropEvent, "dataTransfer", {
        value: {
          files: [file],
        },
      });
      chatRoot.dispatchEvent(dropEvent);
      await Promise.resolve();
    });

    expect(createLocalChatRequestBodyMock.mock.calls[0]?.[3]).toEqual({
      totalCards: 1,
    });

    await sendMessage("hello");

    expect(createLocalChatRequestBodyMock.mock.calls.some((call) => JSON.stringify(call[3]) === JSON.stringify({
      totalCards: 1,
    }))).toBe(true);
  });

  it("aborts the active stream before clearing history when starting a new chat", async () => {
    streamLocalChatMock.mockImplementationOnce((_body: unknown, signal: AbortSignal) => Promise.resolve(
      createAbortableTimedStreamResponse(
        signal,
        [{ atMs: 50, payload: streamDeltaPayload("Partial response") }],
        5_000,
      ),
    ));

    await renderChatPanel();
    await sendMessage("first");

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });

    const newButton = [...mountedContainer.querySelectorAll("button")].find((button) => button.textContent === "New");
    expect(newButton).not.toBeUndefined();

    await act(async () => {
      newButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(streamLocalChatMock.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect((streamLocalChatMock.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
    expect(mountedContainer.textContent).not.toContain("Partial response");
    expect(mountedContainer.querySelectorAll(".chat-msg")).toHaveLength(0);
  });

  it("renders the microphone button immediately to the right of attach", async () => {
    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const controlsRight = mountedContainer.querySelector(".chat-controls-right");
    const controls = Array.from(controlsRight?.children ?? []).map((element) => element.className);
    expect(controls[0]).toContain("chat-attach-btn");
    expect(controls[1]).toContain("chat-mic-btn");
  });

  it("renders the attach control as an icon button with an accessible label", async () => {
    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const attachButton = mountedContainer.querySelector(".chat-attach-btn");
    expect(attachButton?.getAttribute("aria-label")).toBe("Add attachment");
    expect(attachButton?.textContent).toBe("");
    expect(attachButton?.querySelector(".chat-attach-btn-icon")).not.toBeNull();
  });

  it("swaps the textarea for dictation UI and inserts the recognized transcript at the caret", async () => {
    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();
    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, "hello world");
      setTextareaSelection(textarea as HTMLTextAreaElement, 5, 5);
    });

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mountedContainer.querySelector(".chat-dictation-surface-recording")).not.toBeNull();
    expect(mountedContainer.querySelector('textarea[name="chatMessage"]')).toBeNull();
    expect((mountedContainer.querySelector(".chat-send-btn") as HTMLButtonElement | null)?.disabled).toBe(true);

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();

    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const restoredTextarea = mountedContainer.querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(restoredTextarea).not.toBeNull();
    expect(restoredTextarea?.value).toBe("hello dictated text world");
    expect(restoredTextarea?.selectionStart).toBe("hello dictated text".length);
    expect(restoredTextarea?.selectionEnd).toBe("hello dictated text".length);
    expect(transcribeChatAudioMock).toHaveBeenCalledTimes(1);
  });

  it("replaces the selected textarea range with the recognized transcript", async () => {
    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();
    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, "hello brave world");
      setTextareaSelection(textarea as HTMLTextAreaElement, 6, 11);
    });

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();

    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const restoredTextarea = mountedContainer.querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(restoredTextarea?.value).toBe("hello dictated text world");
    expect(restoredTextarea?.selectionStart).toBe("hello dictated text".length);
    expect(restoredTextarea?.selectionEnd).toBe("hello dictated text".length);
  });

  it("lets the user keep building the next draft while the assistant is streaming", async () => {
    streamLocalChatMock.mockImplementationOnce((_body: unknown, signal: AbortSignal) => Promise.resolve(
      createAbortableTimedStreamResponse(
        signal,
        [{ atMs: 50, payload: streamDeltaPayload("Partial response") }],
        5_000,
      ),
    ));

    await renderChatPanel();
    await sendMessage("first");

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();

    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, "next steps");
      setTextareaSelection(textarea as HTMLTextAreaElement, 4, 4);
    });

    const attachButton = mountedContainer.querySelector(".chat-attach-btn");
    expect((attachButton as HTMLButtonElement | null)?.disabled).toBe(false);
    await act(async () => {
      attachButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect((micButton as HTMLButtonElement | null)?.disabled).toBe(false);
    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mountedContainer.querySelector(".chat-dictation-surface-recording")).not.toBeNull();
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).not.toBeNull();

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();
    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const restoredTextarea = mountedContainer.querySelector('textarea[name="chatMessage"]') as HTMLTextAreaElement | null;
    expect(restoredTextarea?.value).toBe("next dictated text steps");
    expect(restoredTextarea?.selectionStart).toBe("next dictated text".length);
    expect(restoredTextarea?.selectionEnd).toBe("next dictated text".length);
    expect(mountedContainer.textContent).toContain("attached.txt");
    expect(mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]')).not.toBeNull();
  });

  it("shows browser guidance when microphone permission is blocked", async () => {
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        }),
      },
    });
    Object.defineProperty(window.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({ state: "denied" })),
      },
    });

    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(alertMock).toHaveBeenCalledWith(
      "Flashcards cannot use your microphone. Click the site controls in your browser bar and enable microphone access, then try again.",
    );
  });

  it("shows the transcription failure message when upload fails", async () => {
    transcribeChatAudioMock.mockRejectedValueOnce(new Error("There is a network problem. Fix it and try again."));
    await renderChatPanel();

    const mountedContainer = container;
    expect(mountedContainer).not.toBeNull();
    if (mountedContainer === null) {
      throw new Error("Expected container to be mounted");
    }

    const micButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Start dictation"]');
    expect(micButton).not.toBeNull();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const stopDictationButton = mountedContainer.querySelector('.chat-mic-btn[aria-label="Stop dictation"]');
    expect(stopDictationButton).not.toBeNull();

    await act(async () => {
      stopDictationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(alertMock).toHaveBeenCalledWith("There is a network problem. Fix it and try again.");
  });
});

describe("calculateSidebarWidthFromPointer", () => {
  it("measures the dragged width from the sidebar left edge instead of the viewport", () => {
    expect(calculateSidebarWidthFromPointer(452, 128, 280, 600)).toBe(324);
  });

  it("clamps the dragged width to the configured min and max values", () => {
    expect(calculateSidebarWidthFromPointer(200, 32, 280, 600)).toBe(280);
    expect(calculateSidebarWidthFromPointer(900, 32, 280, 600)).toBe(600);
  });
});
