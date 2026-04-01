import { act, createElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { ChatSessionSnapshot } from "../types";
import { defaultChatConfig } from "./chatConfig";
import { ChatDraftProvider } from "./ChatDraftContext";

const {
  ApiErrorMock,
  useChatLayoutMock,
  useAppDataMock,
  getChatSnapshotMock,
  startChatRunMock,
  createNewChatSessionMock,
  stopChatRunMock,
  transcribeChatAudioMock,
  consumeChatLiveStreamMock,
  listOutboxRecordsMock,
  checkFileSizeMock,
  prepareAttachmentMock,
  recompressImageAttachmentMock,
} = vi.hoisted(() => ({
  ApiErrorMock: class ApiError extends Error {
    readonly statusCode: number;
    readonly code: string | null;

    constructor(statusCode: number, message: string, code: string | null = null) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  useChatLayoutMock: vi.fn(),
  useAppDataMock: vi.fn(),
  getChatSnapshotMock: vi.fn(),
  startChatRunMock: vi.fn(),
  createNewChatSessionMock: vi.fn(),
  stopChatRunMock: vi.fn(),
  transcribeChatAudioMock: vi.fn(),
  consumeChatLiveStreamMock: vi.fn(),
  listOutboxRecordsMock: vi.fn(),
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
  ApiError: ApiErrorMock,
  getChatSnapshot: getChatSnapshotMock,
  startChatRun: startChatRunMock,
  createNewChatSession: createNewChatSessionMock,
  stopChatRun: stopChatRunMock,
  transcribeChatAudio: transcribeChatAudioMock,
}));

vi.mock("../localDb/outbox", () => ({
  listOutboxRecords: listOutboxRecordsMock,
}));

vi.mock("./liveStream", () => ({
  consumeChatLiveStream: consumeChatLiveStreamMock,
}));

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

type ChatPanelTestHarness = Readonly<{
  getContainer: () => HTMLDivElement;
  getScrollToMock: () => ReturnType<typeof vi.fn>;
  getClipboardWriteTextMock: () => ReturnType<typeof vi.fn>;
  getAlertMock: () => ReturnType<typeof vi.fn>;
  flushAsync: () => Promise<void>;
  renderChatPanel: (mode?: "sidebar" | "fullscreen") => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  clickNewConversation: () => Promise<void>;
  clickStop: () => Promise<void>;
  clickAddAttachment: () => Promise<void>;
}>;

export {
  ApiErrorMock,
  checkFileSizeMock,
  getChatSnapshotMock,
  listOutboxRecordsMock,
  prepareAttachmentMock,
  recompressImageAttachmentMock,
  createNewChatSessionMock,
  startChatRunMock,
  stopChatRunMock,
  transcribeChatAudioMock,
  consumeChatLiveStreamMock,
  useAppDataMock,
  useChatLayoutMock,
};

export function createChatSnapshot(
  overrides?: Partial<ChatSessionSnapshot>,
): ChatSessionSnapshot {
  return {
    sessionId: "session-1",
    runState: "idle",
    updatedAt: 1,
    mainContentInvalidationVersion: 0,
    liveCursor: null,
    liveStream: null,
    chatConfig: defaultChatConfig,
    messages: [],
    ...overrides,
  };
}

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

export function createDropEvent(file: File): DragEvent {
  const dropEvent = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(dropEvent, "dataTransfer", {
    value: {
      files: [file],
    },
  });
  return dropEvent;
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
    const localStorageState = new Map<string, string>();
    const localStorageMock: Storage = {
      get length(): number {
        return localStorageState.size;
      },
      clear(): void {
        localStorageState.clear();
      },
      getItem(key: string): string | null {
        return localStorageState.get(key) ?? null;
      },
      key(index: number): string | null {
        return [...localStorageState.keys()][index] ?? null;
      },
      removeItem(key: string): void {
        localStorageState.delete(key);
      },
      setItem(key: string, value: string): void {
        localStorageState.set(key, value);
      },
    };

    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
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
    getChatSnapshotMock.mockReset();
    startChatRunMock.mockReset();
    createNewChatSessionMock.mockReset();
    stopChatRunMock.mockReset();
    transcribeChatAudioMock.mockReset();
    consumeChatLiveStreamMock.mockReset();
    listOutboxRecordsMock.mockReset();
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
      sessionVerificationState: "verified",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      isSessionVerified: true,
      localCardCount: 1,
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(async (): Promise<void> => undefined),
      setErrorMessage: vi.fn(),
    });
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot());
    startChatRunMock.mockResolvedValue({
      ok: true,
      sessionId: "session-1",
      runId: "run-1",
      clientRequestId: "client-request-1",
      runState: "running",
      liveStream: {
        url: "https://chat-live.example.com",
        authorization: "Live mock-token",
        expiresAt: Date.now() + 60_000,
      },
      chatConfig: defaultChatConfig,
    });
    createNewChatSessionMock.mockResolvedValue({
      ok: true,
      sessionId: "session-reset",
      chatConfig: defaultChatConfig,
    });
    stopChatRunMock.mockResolvedValue({
      ok: true,
      sessionId: "session-1",
      runId: "run-1",
      stopped: true,
      stillRunning: false,
    });
    transcribeChatAudioMock.mockResolvedValue({
      text: "dictated text",
      sessionId: "session-1",
    });
    consumeChatLiveStreamMock.mockImplementation(() => new Promise(() => undefined));
    listOutboxRecordsMock.mockResolvedValue([]);
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

  async function flushAsync(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function renderChatPanel(mode: "sidebar" | "fullscreen" = "fullscreen"): Promise<void> {
    expect(root).not.toBeNull();
    await act(async () => {
      root?.render(
        createElement(
          ChatDraftProvider,
          null,
          createElement(ChatPanel, { key: mode, mode }),
        ),
      );
      await Promise.resolve();
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

  async function clickNewConversation(): Promise<void> {
    const mountedContainer = getContainer();
    const buttons = [...mountedContainer.querySelectorAll(".chat-close-btn")];
    const newButton = buttons.find((button) => button.textContent === "New");
    expect(newButton).toBeDefined();

    await act(async () => {
      newButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function clickStop(): Promise<void> {
    const mountedContainer = getContainer();
    const stopButton = mountedContainer.querySelector('.chat-stop-btn[aria-label="Stop response"]');
    expect(stopButton).not.toBeNull();

    await act(async () => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function clickAddAttachment(): Promise<void> {
    const mountedContainer = getContainer();
    const addAttachmentButton = mountedContainer.querySelector('.chat-attach-btn[aria-label="Add attachment"]');
    expect(addAttachmentButton).not.toBeNull();

    await act(async () => {
      addAttachmentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  return {
    getContainer,
    getScrollToMock,
    getClipboardWriteTextMock,
    getAlertMock,
    flushAsync,
    renderChatPanel,
    sendMessage,
    clickNewConversation,
    clickStop,
    clickAddAttachment,
  };
}
