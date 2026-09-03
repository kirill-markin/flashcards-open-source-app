import { expect, vi } from "vitest";

type ChatPanelTestBrowserEnvironment = Readonly<{
  install: () => void;
  clearTimers: () => void;
  restore: () => void;
  getScrollToMock: () => ReturnType<typeof vi.fn>;
  getClipboardWriteTextMock: () => ReturnType<typeof vi.fn>;
  getAlertMock: () => ReturnType<typeof vi.fn>;
  setMobileViewport: (isMobile: boolean) => void;
}>;

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

export function createChatPanelTestBrowserEnvironment(): ChatPanelTestBrowserEnvironment {
  let scrollToMock: ReturnType<typeof vi.fn> | null = null;
  let clipboardWriteTextMock: ReturnType<typeof vi.fn> | null = null;
  let alertMock: ReturnType<typeof vi.fn> | null = null;
  let isMobileViewport = false;
  const matchMediaListeners = new Set<(event: MediaQueryListEvent) => void>();

  function install(): void {
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
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    alertMock = vi.fn();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
    vi.stubGlobal("alert", alertMock);

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
  }

  function clearTimers(): void {
    vi.clearAllTimers();
  }

  function restore(): void {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  return {
    install,
    clearTimers,
    restore,
    getScrollToMock,
    getClipboardWriteTextMock,
    getAlertMock,
    setMobileViewport,
  };
}
