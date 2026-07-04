// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BinaryPendingAttachment, CardPendingAttachment } from "../../attachments/FileAttachment";
import {
  clearStoredChatDraftForSessionIfUnchanged,
  loadChatDraftWorkspaceState,
  readChatDraftForSession,
  readStoredChatDraftForSession,
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

afterEach(() => {
  vi.restoreAllMocks();
});

function createBinaryAttachment(): BinaryPendingAttachment {
  return {
    type: "binary",
    fileName: "diagram.png",
    mediaType: "image/png",
    base64Data: "base64-payload",
  };
}

function createCardAttachment(): CardPendingAttachment {
  return {
    type: "card",
    attachmentId: "card-attachment-1",
    cardId: "card-1",
    frontText: "Question",
    backText: "Answer",
    tags: ["tag-1"],
  };
}

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

  it("keeps draft revisions monotonic after a session draft is deleted", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const firstDrafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "same draft",
      pendingAttachments: [],
    });
    const firstUpdatedAt = readStoredChatDraftForSession(firstDrafts, "session-1")?.updatedAt;
    const clearedDrafts = replaceChatDraftForSession(firstDrafts, "session-1", {
      inputText: "",
      pendingAttachments: [],
    });
    const secondDrafts = replaceChatDraftForSession(clearedDrafts, "session-1", {
      inputText: "same draft",
      pendingAttachments: [],
    });
    const secondUpdatedAt = readStoredChatDraftForSession(secondDrafts, "session-1")?.updatedAt;

    expect(typeof firstUpdatedAt).toBe("number");
    expect(typeof secondUpdatedAt).toBe("number");
    expect(secondUpdatedAt).toBeGreaterThan(firstUpdatedAt as number);
  });

  it("does not persist binary attachment payloads to localStorage", () => {
    const drafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "saved text",
      pendingAttachments: [createBinaryAttachment()],
    });

    storeChatDraftWorkspaceState("workspace-1", drafts);

    const rawValue = window.localStorage.getItem("flashcards-chat-drafts::workspace-1");
    expect(rawValue).not.toBeNull();
    expect(rawValue).not.toContain("base64-payload");
    expect(readChatDraftForSession(loadChatDraftWorkspaceState("workspace-1"), "session-1")).toEqual({
      inputText: "saved text",
      pendingAttachments: [],
    });
  });

  it("prunes drafts that only have binary attachments after storage projection", () => {
    const drafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "",
      pendingAttachments: [createBinaryAttachment()],
    });

    storeChatDraftWorkspaceState("workspace-1", drafts);

    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  });

  it("persists card attachments and drops binary attachments from mixed drafts", () => {
    const cardAttachment = createCardAttachment();
    const drafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "mixed draft",
      pendingAttachments: [createBinaryAttachment(), cardAttachment],
    });

    storeChatDraftWorkspaceState("workspace-1", drafts);

    const rawValue = window.localStorage.getItem("flashcards-chat-drafts::workspace-1");
    expect(rawValue).not.toBeNull();
    expect(rawValue).not.toContain("base64-payload");
    expect(readChatDraftForSession(loadChatDraftWorkspaceState("workspace-1"), "session-1")).toEqual({
      inputText: "mixed draft",
      pendingAttachments: [cardAttachment],
    });
  });

  it("ignores legacy stored binary attachments when loading drafts", () => {
    const cardAttachment = createCardAttachment();
    window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
      version: 1,
      draftsBySessionId: {
        "session-1": {
          inputText: "legacy draft",
          pendingAttachments: [
            createBinaryAttachment(),
            cardAttachment,
          ],
          updatedAt: 1000,
        },
      },
    }));

    expect(readChatDraftForSession(loadChatDraftWorkspaceState("workspace-1"), "session-1")).toEqual({
      inputText: "legacy draft",
      pendingAttachments: [cardAttachment],
    });
    const cleanedRawValue = window.localStorage.getItem("flashcards-chat-drafts::workspace-1");
    expect(cleanedRawValue).not.toBeNull();
    expect(cleanedRawValue).not.toContain("base64-payload");
  });

  it("ignores legacy stored drafts that only contain binary attachments", () => {
    window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
      version: 1,
      draftsBySessionId: {
        "session-1": {
          inputText: "",
          pendingAttachments: [createBinaryAttachment()],
          updatedAt: 1000,
        },
      },
    }));

    const loadedDrafts = loadChatDraftWorkspaceState("workspace-1");
    expect(readChatDraftForSession(loadedDrafts, "session-1")).toBeNull();
    expect(readStoredChatDraftForSession(loadedDrafts, "session-1")).toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  });

  it("rethrows non-quota cleanup errors when loading legacy binary attachments", () => {
    const cardAttachment = createCardAttachment();
    window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
      version: 1,
      draftsBySessionId: {
        "session-1": {
          inputText: "legacy draft",
          pendingAttachments: [
            createBinaryAttachment(),
            cardAttachment,
          ],
          updatedAt: 1000,
        },
      },
    }));
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable.", "SecurityError");
    });

    expect(() => loadChatDraftWorkspaceState("workspace-1")).toThrow("Storage is unavailable.");
  });

  it("clears stored text drafts when the accepted draft also had binary attachments", () => {
    const drafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "accepted draft",
      pendingAttachments: [],
    });
    storeChatDraftWorkspaceState("workspace-1", drafts);
    const storedDraft = readStoredChatDraftForSession(loadChatDraftWorkspaceState("workspace-1"), "session-1");
    if (storedDraft === null) {
      throw new Error("Expected stored draft to exist.");
    }

    clearStoredChatDraftForSessionIfUnchanged(
      "workspace-1",
      "session-1",
      {
        inputText: "accepted draft",
        pendingAttachments: [createBinaryAttachment()],
      },
      storedDraft.updatedAt,
    );

    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  });

  it("clears the workspace draft key when localStorage quota blocks persistence", () => {
    window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
      version: 1,
      draftsBySessionId: {
        "session-1": {
          inputText: "previous draft",
          pendingAttachments: [],
          updatedAt: 1000,
        },
      },
    }));
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded.", "QuotaExceededError");
    });

    const drafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "next draft",
      pendingAttachments: [createCardAttachment()],
    });

    expect(() => storeChatDraftWorkspaceState("workspace-1", drafts)).not.toThrow();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  });

  it("rethrows non-quota localStorage persistence errors", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable.", "SecurityError");
    });

    const drafts = replaceChatDraftForSession({}, "session-1", {
      inputText: "next draft",
      pendingAttachments: [createCardAttachment()],
    });

    expect(() => storeChatDraftWorkspaceState("workspace-1", drafts)).toThrow("Storage is unavailable.");
  });
});
