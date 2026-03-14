import { act, createElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";

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

import { ChatPanel } from "./ChatPanel";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

type TimedStreamChunk = Readonly<{
  atMs: number;
  payload: string;
}>;

type ChatPanelTestHarness = Readonly<{
  getContainer: () => HTMLDivElement;
  getScrollToMock: () => ReturnType<typeof vi.fn>;
  getClipboardWriteTextMock: () => ReturnType<typeof vi.fn>;
  getAlertMock: () => ReturnType<typeof vi.fn>;
  renderChatPanel: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => Promise<void>;
}>;

export {
  checkFileSizeMock,
  createLocalChatRequestBodyMock,
  ensurePersistentStorageMock,
  executeLocalToolMock,
  prepareAttachmentMock,
  recompressImageAttachmentMock,
  sendLocalChatDiagnosticsMock,
  streamLocalChatMock,
  transcribeChatAudioMock,
  useAppDataMock,
  useChatLayoutMock,
};

export function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function setTextareaSelection(textarea: HTMLTextAreaElement, start: number, end: number): void {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  textarea.dispatchEvent(new Event("select", { bubbles: true }));
}

export function configureMessagesScroller(element: HTMLDivElement): void {
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

export function streamDeltaPayload(text: string): string {
  return `data: ${JSON.stringify({ type: "delta", text })}\n`;
}

export function createSSELine(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n`;
}

export function createStreamResponse(payloads: ReadonlyArray<string>, status: number): Response {
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

export function createTimedStreamResponse(
  chunks: ReadonlyArray<TimedStreamChunk>,
  closeAtMs: number,
  status: number,
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
    status,
    headers: {
      "x-chat-request-id": "request-1",
    },
  });
}

export function createAbortableTimedStreamResponse(
  signal: AbortSignal,
  chunks: ReadonlyArray<TimedStreamChunk>,
  closeAtMs: number,
  status: number,
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
    status,
    headers: {
      "x-chat-request-id": "request-1",
    },
  });
}

export function readScrollBehavior(call: ReadonlyArray<unknown>): string | null {
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

export function countSmoothCalls(scrollToCalls: ReadonlyArray<ReadonlyArray<unknown>>): number {
  return scrollToCalls.filter((call) => readScrollBehavior(call) === "smooth").length;
}

export function createDeferred<T>(): Deferred<T> {
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

export function createDropEvent(file: File): DragEvent {
  const dropEvent = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(dropEvent, "dataTransfer", {
    value: {
      files: [file],
    },
  });
  return dropEvent;
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

export function setupChatPanelTest(): ChatPanelTestHarness {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let scrollToMock: ReturnType<typeof vi.fn> | null = null;
  let clipboardWriteTextMock: ReturnType<typeof vi.fn> | null = null;
  let alertMock: ReturnType<typeof vi.fn> | null = null;

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
      createTimedStreamResponse([{ atMs: 0, payload: streamDeltaPayload("done") }], 1, 200),
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

  function getContainer(): HTMLDivElement {
    expect(container).not.toBeNull();
    if (container === null) {
      throw new Error("Expected container to be mounted");
    }
    return container;
  }

  function getScrollToMock(): ReturnType<typeof vi.fn> {
    expect(scrollToMock).not.toBeNull();
    if (scrollToMock === null) {
      throw new Error("Expected scrollTo mock");
    }
    return scrollToMock;
  }

  function getClipboardWriteTextMock(): ReturnType<typeof vi.fn> {
    expect(clipboardWriteTextMock).not.toBeNull();
    if (clipboardWriteTextMock === null) {
      throw new Error("Expected clipboard mock");
    }
    return clipboardWriteTextMock;
  }

  function getAlertMock(): ReturnType<typeof vi.fn> {
    expect(alertMock).not.toBeNull();
    if (alertMock === null) {
      throw new Error("Expected alert mock");
    }
    return alertMock;
  }

  async function renderChatPanel(): Promise<void> {
    expect(root).not.toBeNull();
    await act(async () => {
      root?.render(createElement(ChatPanel, { mode: "fullscreen" }));
    });
  }

  async function sendMessage(text: string): Promise<void> {
    const mountedContainer = getContainer();
    const textarea = mountedContainer.querySelector('textarea[name="chatMessage"]');
    expect(textarea).not.toBeNull();
    const sendButton = mountedContainer.querySelector(".chat-send-btn");
    expect(sendButton).not.toBeNull();

    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, text);
    });

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function stopStreaming(): Promise<void> {
    const mountedContainer = getContainer();
    const stopButton = mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]');
    expect(stopButton).not.toBeNull();

    await act(async () => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  return {
    getContainer,
    getScrollToMock,
    getClipboardWriteTextMock,
    getAlertMock,
    renderChatPanel,
    sendMessage,
    stopStreaming,
  };
}
