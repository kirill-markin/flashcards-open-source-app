// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { archiveChatSession } from "./chatArchive";
import type { StoredMessage } from "./useChatHistory";

vi.mock("../../i18n", () => {
  const translations: Record<string, string> = {
    "chatPanel.history.title": "Chat history",
    "chatPanel.history.readOnlyNotice": "Read-only",
    "chatPanel.history.close": "Close",
    "chatPanel.history.searchPlaceholder": "Search chats",
    "chatPanel.history.empty": "No saved chats yet.",
    "chatPanel.history.noSearchResults": "No matches.",
    "chatPanel.history.rename": "Rename",
    "chatPanel.history.delete": "Delete",
    "chatPanel.history.deleteConfirm": "Delete?",
    "chatPanel.history.save": "Save",
    "chatPanel.history.cancel": "Cancel",
    "chatPanel.history.back": "Back",
    "chatPanel.history.untitledChat": "Untitled chat",
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      formatDate: (value: number) => new Date(value).toISOString(),
      formatCount: (value: number) => `${value}`,
      messages: {
        chatPanel: {
          history: {
            messageCountLabels: {
              message: { one: "message", other: "messages" },
            },
          },
        },
      },
    }),
  };
});

function makeMessage(role: "user" | "assistant", text: string, timestamp: number): StoredMessage {
  return {
    role,
    content: [{ type: "text", text }],
    timestamp,
    isError: false,
    isStopped: false,
    cursor: null,
    itemId: null,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderPanel(workspaceId: string | null = "ws-1"): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ChatHistoryPanel workspaceId={workspaceId} onClose={() => {}} />);
  });
}

function queryByTestId(id: string): HTMLElement | null {
  return container?.querySelector(`[data-testid="${id}"]`) ?? null;
}

function queryAllByTestId(id: string): HTMLElement[] {
  return Array.from(container?.querySelectorAll(`[data-testid="${id}"]`) ?? []);
}

function click(element: HTMLElement | null): void {
  if (element === null) {
    throw new Error("Expected element to exist for click.");
  }
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
});

describe("ChatHistoryPanel", () => {
  it("shows an empty state when there are no archived chats", () => {
    renderPanel();
    expect(queryByTestId("chat-history-empty")?.textContent).toBe("No saved chats yet.");
  });

  it("lists archived chats newest-first", () => {
    archiveChatSession("ws-1", [makeMessage("user", "First question", 1000)], "Untitled chat");
    archiveChatSession("ws-1", [makeMessage("user", "Second question", 2000)], "Untitled chat");
    renderPanel();
    const items = queryAllByTestId("chat-history-item");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Second question");
    expect(items[1]?.textContent).toContain("First question");
  });

  it("filters the list by search query", () => {
    archiveChatSession("ws-1", [makeMessage("user", "Bohr model question", 1000)], "Untitled chat");
    archiveChatSession("ws-1", [makeMessage("user", "Pasta recipe", 2000)], "Untitled chat");
    renderPanel();
    const search = queryByTestId("chat-history-search") as HTMLInputElement | null;
    expect(search).not.toBeNull();
    act(() => {
      search?.focus();
    });
    // Simulate typing via native setter to trigger React's onChange.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      nativeSetter?.call(search, "bohr");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(queryAllByTestId("chat-history-item")).toHaveLength(1);
    expect(queryByTestId("chat-history-item")?.textContent).toContain("Bohr model question");
  });

  it("opens a chat in read-only view and goes back", () => {
    archiveChatSession(
      "ws-1",
      [
        makeMessage("user", "What is fission?", 1000),
        makeMessage("assistant", "Fission splits atoms.", 2000),
      ],
      "Untitled chat",
    );
    renderPanel();
    click(queryByTestId("chat-history-open"));
    expect(queryByTestId("chat-history-reader")).not.toBeNull();
    expect(queryByTestId("chat-history-messages")?.textContent).toContain("Fission splits atoms.");
    // No composer in read-only view.
    expect(container?.querySelector("textarea")).toBeNull();
    click(queryByTestId("chat-history-back"));
    expect(queryByTestId("chat-history-panel")).not.toBeNull();
  });

  it("renames a chat", () => {
    archiveChatSession("ws-1", [makeMessage("user", "Old title text", 1000)], "Untitled chat");
    renderPanel();
    click(queryByTestId("chat-history-rename"));
    const input = queryByTestId("chat-history-rename-input") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      nativeSetter?.call(input, "Physics review");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Submit via change event so React picks up the value.
    act(() => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(queryByTestId("chat-history-rename-save"));
    expect(queryByTestId("chat-history-item")?.textContent).toContain("Physics review");
  });

  it("deletes a chat after confirmation", () => {
    archiveChatSession("ws-1", [makeMessage("user", "Delete me", 1000)], "Untitled chat");
    renderPanel();
    expect(queryAllByTestId("chat-history-item")).toHaveLength(1);
    click(queryByTestId("chat-history-delete"));
    click(queryByTestId("chat-history-delete-confirm"));
    expect(queryAllByTestId("chat-history-item")).toHaveLength(0);
  });
});
