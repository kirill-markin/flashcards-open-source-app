import { act, createElement, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { I18nProvider, useI18n } from "../i18n";
import type { Locale, LocalePreference } from "../i18n/types";
import type { ChatSessionSnapshot, StartChatRunRequestBody } from "../types";
import { defaultChatConfig } from "./sessionController/config";
import { ChatDraftProvider } from "./ChatDraftContext";
import { ChatSessionControllerProvider } from "./sessionController";

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
  isBinaryPendingAttachmentMock,
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
  isBinaryPendingAttachmentMock: vi.fn(),
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
  getChatSnapshotWithResumeDiagnostics: getChatSnapshotMock,
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
  isBinaryPendingAttachment: isBinaryPendingAttachmentMock,
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
          type: "binary",
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
  setMobileViewport: (isMobile: boolean) => void;
  flushAsync: () => Promise<void>;
  renderChatPanel: (mode?: "sidebar" | "fullscreen") => Promise<void>;
  setLocalePreference: (localePreference: LocalePreference) => Promise<void>;
  unmountChatPanel: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  clickNewConversation: () => Promise<void>;
  clickStop: () => Promise<void>;
  clickAddAttachment: () => Promise<void>;
  clickMicrophone: () => Promise<void>;
}>;

type TextareaKeyboardParams = Readonly<{
  key: string;
  shiftKey: boolean;
  repeat: boolean;
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

export function createChatActiveRun(
  overrides?: Partial<NonNullable<ChatSessionSnapshot["activeRun"]>>,
): NonNullable<ChatSessionSnapshot["activeRun"]> {
  return {
    runId: "run-1",
    status: "running",
    live: {
      cursor: null,
      stream: {
        url: "https://chat-live.example.com",
        authorization: "Live mock-token",
        expiresAt: Date.now() + 60_000,
      },
    },
    ...overrides,
  };
}

export function createChatSnapshot(
  overrides?: Partial<ChatSessionSnapshot>,
): ChatSessionSnapshot {
  return {
    sessionId: "session-1",
    conversationScopeId: "session-1",
    conversation: {
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      messages: [],
    },
    composerSuggestions: [],
    chatConfig: defaultChatConfig,
    activeRun: null,
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

export function pressTextareaKey(
  textarea: HTMLTextAreaElement,
  params: TextareaKeyboardParams,
): KeyboardEvent {
  const keyboardEvent = new KeyboardEvent("keydown", {
    key: params.key,
    shiftKey: params.shiftKey,
    repeat: params.repeat,
    bubbles: true,
    cancelable: true,
  });

  textarea.dispatchEvent(keyboardEvent);

  if (keyboardEvent.defaultPrevented || params.key !== "Enter") {
    return keyboardEvent;
  }

  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const nextValue = `${textarea.value.slice(0, selectionStart)}\n${textarea.value.slice(selectionEnd)}`;
  setTextareaValue(textarea, nextValue);
  const nextSelection = selectionStart + 1;
  textarea.setSelectionRange(nextSelection, nextSelection);
  textarea.dispatchEvent(new Event("select", { bubbles: true }));
  return keyboardEvent;
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
  let setLocalePreferenceRef: ((localePreference: LocalePreference) => void) | null = null;
  let isMobileViewport = false;
  const matchMediaListeners = new Set<(event: MediaQueryListEvent) => void>();

  beforeEach(() => {
    isMobileViewport = false;
    matchMediaListeners.clear();
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
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: query === "(max-width: 768px)" ? isMobileViewport : false,
        media: query,
        onchange: null,
        addEventListener: (eventName: string, listener: EventListenerOrEventListenerObject): void => {
          if (eventName !== "change") {
            return;
          }

          const callback = typeof listener === "function"
            ? listener
            : (event: Event) => listener.handleEvent(event);
          matchMediaListeners.add(callback as (event: MediaQueryListEvent) => void);
        },
        removeEventListener: (eventName: string, listener: EventListenerOrEventListenerObject): void => {
          if (eventName !== "change") {
            return;
          }

          const callback = typeof listener === "function"
            ? listener
            : (event: Event) => listener.handleEvent(event);
          matchMediaListeners.delete(callback as (event: MediaQueryListEvent) => void);
        },
        addListener: (listener: ((event: MediaQueryListEvent) => void) | null): void => {
          if (listener === null) {
            return;
          }

          matchMediaListeners.add(listener);
        },
        removeListener: (listener: ((event: MediaQueryListEvent) => void) | null): void => {
          if (listener === null) {
            return;
          }

          matchMediaListeners.delete(listener);
        },
        dispatchEvent: (event: Event): boolean => {
          matchMediaListeners.forEach((listener) => listener(event as MediaQueryListEvent));
          return true;
        },
      }),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    setLocalePreferenceRef = null;
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
    isBinaryPendingAttachmentMock.mockReset();

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
    getChatSnapshotMock.mockImplementation(async (sessionId: string) => createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
    }));
    startChatRunMock.mockImplementation(async (requestBody: StartChatRunRequestBody) => ({
      accepted: true,
      sessionId: requestBody.sessionId,
      conversationScopeId: requestBody.sessionId,
      conversation: {
        updatedAt: 1,
        mainContentInvalidationVersion: 0,
        messages: [],
      },
      composerSuggestions: [],
      chatConfig: defaultChatConfig,
      activeRun: createChatActiveRun(),
    }));
    createNewChatSessionMock.mockImplementation(async (sessionId: string, _uiLocale: Locale) => ({
      ok: true,
      sessionId,
      composerSuggestions: [],
      chatConfig: defaultChatConfig,
    }));
    stopChatRunMock.mockResolvedValue({
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      stopped: true,
      stillRunning: false,
    });
    transcribeChatAudioMock.mockImplementation(async (
      _blob: Blob,
      _source: "web",
      sessionId: string,
    ) => ({
      text: "dictated text",
      sessionId,
    }));
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
    isBinaryPendingAttachmentMock.mockImplementation((attachment) => attachment.type === "binary");

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

  function setMobileViewport(nextIsMobile: boolean): void {
    isMobileViewport = nextIsMobile;
    const changeEvent = { matches: isMobileViewport, media: "(max-width: 768px)" } as MediaQueryListEvent;
    matchMediaListeners.forEach((listener) => listener(changeEvent));
  }

  async function flushAsync(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  function LocalePreferenceProbe(): null {
    const { setLocalePreference } = useI18n();

    useEffect(() => {
      setLocalePreferenceRef = setLocalePreference;
      return () => {
        if (setLocalePreferenceRef === setLocalePreference) {
          setLocalePreferenceRef = null;
        }
      };
    }, [setLocalePreference]);

    return null;
  }

  async function renderChatPanel(mode: "sidebar" | "fullscreen" = "fullscreen"): Promise<void> {
    expect(root).not.toBeNull();
    await act(async () => {
      root?.render(
        createElement(
          I18nProvider,
          null,
          createElement(
            ChatSessionControllerProvider,
            null,
            createElement(
              ChatDraftProvider,
              null,
              createElement(LocalePreferenceProbe),
              createElement(ChatPanel, { key: mode, mode }),
            ),
          ),
        ),
      );
      await Promise.resolve();
    });
  }

  async function setLocalePreference(localePreference: LocalePreference): Promise<void> {
    expect(setLocalePreferenceRef).not.toBeNull();
    if (setLocalePreferenceRef === null) {
      throw new Error("Expected locale preference setter");
    }

    await act(async () => {
      setLocalePreferenceRef?.(localePreference);
      await Promise.resolve();
    });
  }

  async function unmountChatPanel(): Promise<void> {
    expect(root).not.toBeNull();
    await act(async () => {
      root?.render(null);
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
      (sendButton as HTMLButtonElement | null)?.focus();
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
      (newButton as HTMLButtonElement | undefined)?.focus();
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

  async function clickMicrophone(): Promise<void> {
    const mountedContainer = getContainer();
    const microphoneButton = mountedContainer.querySelector('.chat-mic-btn');
    expect(microphoneButton).not.toBeNull();

    await act(async () => {
      microphoneButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  return {
    getContainer,
    getScrollToMock,
    getClipboardWriteTextMock,
    getAlertMock,
    setMobileViewport,
    flushAsync,
    renderChatPanel,
    setLocalePreference,
    unmountChatPanel,
    sendMessage,
    clickNewConversation,
    clickStop,
    clickAddAttachment,
    clickMicrophone,
  };
}
