// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveChatSession,
  deleteArchivedChat,
  getArchivedChat,
  listArchivedChats,
  makeAutoTitle,
  renameArchivedChat,
} from "./chatArchive";
import type { StoredMessage } from "./useChatHistory";

function makeMessage(
  role: "user" | "assistant",
  text: string,
  timestamp: number,
): StoredMessage {
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

const WORKSPACE = "workspace-1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("makeAutoTitle", () => {
  it("uses the first user message text", () => {
    const messages = [
      makeMessage("user", "Why does the Bohr model fail?", 1000),
      makeMessage("assistant", "Because...", 2000),
    ];
    expect(makeAutoTitle(messages, "Fallback")).toBe("Why does the Bohr model fail?");
  });

  it("truncates long titles", () => {
    const longText = "a".repeat(100);
    const title = makeAutoTitle([makeMessage("user", longText, 1000)], "Fallback");
    expect(title.length).toBeLessThanOrEqual(51);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back when there is no user text", () => {
    expect(makeAutoTitle([], "Fallback")).toBe("Fallback");
    expect(
      makeAutoTitle([makeMessage("assistant", "Hello", 1000)], "Fallback"),
    ).toBe("Fallback");
  });
});

describe("archiveChatSession", () => {
  it("returns null for empty message lists", () => {
    expect(archiveChatSession(WORKSPACE, [], "Fallback")).toBeNull();
    expect(listArchivedChats(WORKSPACE)).toEqual([]);
  });

  it("archives a chat and lists it newest-first", () => {
    const first = archiveChatSession(
      WORKSPACE,
      [makeMessage("user", "First chat", 1000)],
      "Fallback",
    );
    const second = archiveChatSession(
      WORKSPACE,
      [makeMessage("user", "Second chat", 2000)],
      "Fallback",
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const listed = listArchivedChats(WORKSPACE);
    expect(listed).toHaveLength(2);
    expect(listed[0]?.id).toBe(second?.id);
    expect(listed[1]?.id).toBe(first?.id);
  });

  it("scopes archives by workspace", () => {
    archiveChatSession(WORKSPACE, [makeMessage("user", "WS1", 1000)], "Fallback");
    expect(listArchivedChats("workspace-2")).toEqual([]);
    expect(listArchivedChats(WORKSPACE)).toHaveLength(1);
  });

  it("stores the full messages for later read-only viewing", () => {
    const messages = [
      makeMessage("user", "Question", 1000),
      makeMessage("assistant", "Answer", 2000),
    ];
    const summary = archiveChatSession(WORKSPACE, messages, "Fallback");
    expect(summary).not.toBeNull();
    const archived = getArchivedChat(WORKSPACE, summary?.id ?? "");
    expect(archived).not.toBeNull();
    expect(archived?.messages).toHaveLength(2);
    expect(archived?.messages[1]?.role).toBe("assistant");
  });
});

describe("renameArchivedChat", () => {
  it("renames an archived chat", () => {
    const summary = archiveChatSession(
      WORKSPACE,
      [makeMessage("user", "Original", 1000)],
      "Fallback",
    );
    expect(renameArchivedChat(WORKSPACE, summary?.id ?? "", "Renamed title")).toBe(true);
    expect(listArchivedChats(WORKSPACE)[0]?.title).toBe("Renamed title");
  });

  it("rejects blank titles and unknown ids", () => {
    const summary = archiveChatSession(
      WORKSPACE,
      [makeMessage("user", "Original", 1000)],
      "Fallback",
    );
    expect(renameArchivedChat(WORKSPACE, summary?.id ?? "", "   ")).toBe(false);
    expect(renameArchivedChat(WORKSPACE, "missing", "New")).toBe(false);
    expect(listArchivedChats(WORKSPACE)[0]?.title).toBe("Original");
  });
});

describe("deleteArchivedChat", () => {
  it("deletes an archived chat", () => {
    const summary = archiveChatSession(
      WORKSPACE,
      [makeMessage("user", "To delete", 1000)],
      "Fallback",
    );
    expect(deleteArchivedChat(WORKSPACE, summary?.id ?? "")).toBe(true);
    expect(listArchivedChats(WORKSPACE)).toEqual([]);
    expect(getArchivedChat(WORKSPACE, summary?.id ?? "")).toBeNull();
  });

  it("returns false for unknown ids", () => {
    expect(deleteArchivedChat(WORKSPACE, "missing")).toBe(false);
  });
});
