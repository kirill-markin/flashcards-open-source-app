// @vitest-environment jsdom

import { act, createElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel, calculateSidebarWidthFromPointer, formatToolLabel } from "./ChatPanel";

const {
  useChatLayoutMock,
  useAppDataMock,
  createLocalChatRequestBodyMock,
  sendLocalChatDiagnosticsMock,
  streamLocalChatMock,
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
  FileAttachment: () => createElement("button", { type: "button", className: "chat-attach-btn" }, "Attach"),
}));

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("formatToolLabel", () => {
  it("renders plural-only card and deck tool labels", () => {
    expect(formatToolLabel("get_cards")).toBe("Get cards");
    expect(formatToolLabel("create_cards")).toBe("Create cards");
    expect(formatToolLabel("update_cards")).toBe("Update cards");
    expect(formatToolLabel("delete_cards")).toBe("Delete cards");
    expect(formatToolLabel("list_decks")).toBe("List decks");
    expect(formatToolLabel("search_decks")).toBe("Search decks");
    expect(formatToolLabel("get_decks")).toBe("Get decks");
    expect(formatToolLabel("create_decks")).toBe("Create decks");
    expect(formatToolLabel("update_decks")).toBe("Update decks");
    expect(formatToolLabel("delete_decks")).toBe("Delete decks");
    expect(formatToolLabel("summarize_deck_state")).toBe("Deck summary");
  });
});

describe("ChatPanel autoscroll", () => {
  let container: HTMLDivElement | null;
  let root: ReactDOM.Root | null;
  let scrollToMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("localStorage", createMemoryStorage());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    useChatLayoutMock.mockReset();
    useAppDataMock.mockReset();
    createLocalChatRequestBodyMock.mockReset();
    sendLocalChatDiagnosticsMock.mockReset();
    streamLocalChatMock.mockReset();
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
    useAppDataMock.mockReturnValue({});
    createLocalChatRequestBodyMock.mockImplementation(
      (messages: ReadonlyArray<unknown>, model: string, timezone: string) => ({
        messages,
        model,
        timezone,
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
      (messages: ReadonlyArray<unknown>, model: string, timezone: string) => ({
        messages,
        model,
        timezone,
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
