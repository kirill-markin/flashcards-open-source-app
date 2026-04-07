// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadChatDraftWorkspaceState,
  readChatDraftForSession,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
} from "./chatDraftStorage";

beforeEach(() => {
  const storageState = new Map<string, string>();
  const localStorageMock: Storage = {
    get length(): number {
      return storageState.size;
    },
    clear(): void {
      storageState.clear();
    },
    getItem(key: string): string | null {
      return storageState.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...storageState.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      storageState.delete(key);
    },
    setItem(key: string, value: string): void {
      storageState.set(key, value);
    },
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
});

describe("chatDraftStorage", () => {
  it("prunes empty drafts and ignores unresolved null session ids", () => {
    const ignoredDrafts = replaceChatDraftForSession({}, null, {
      inputText: "pending draft",
      pendingAttachments: [],
    });

    expect(readChatDraftForSession(ignoredDrafts, null)).toBeNull();

    const storedDrafts = replaceChatDraftForSession(ignoredDrafts, "session-1", {
      inputText: "saved draft",
      pendingAttachments: [],
    });

    expect(readChatDraftForSession(storedDrafts, "session-1")?.inputText).toBe("saved draft");

    const prunedDrafts = replaceChatDraftForSession(storedDrafts, "session-1", {
      inputText: "",
      pendingAttachments: [],
    });

    expect(readChatDraftForSession(prunedDrafts, "session-1")).toBeNull();
  });

  it("stores drafts per workspace and preserves older sessions when writing a fresh session draft", () => {
    const initialDrafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "keep me",
      pendingAttachments: [],
    });

    const nextDrafts = replaceChatDraftForSession(initialDrafts, "session-2", {
      inputText: "",
      pendingAttachments: [],
    });

    storeChatDraftWorkspaceState("workspace-1", nextDrafts);

    const storedDrafts = loadChatDraftWorkspaceState("workspace-1");
    expect(readChatDraftForSession(storedDrafts, "session-1")?.inputText).toBe("keep me");
    expect(readChatDraftForSession(storedDrafts, "session-2")).toBeNull();
  });
});
