import type { ContentPart } from "../../types";
import type { StoredMessage } from "./useChatHistory";

export type ArchivedChatSummary = Readonly<{
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}>;

export type ArchivedChat = Readonly<{
  summary: ArchivedChatSummary;
  messages: ReadonlyArray<StoredMessage>;
}>;

const ARCHIVE_STORAGE_KEY = "flashcards-ai-chat-archive-v1";
const ARCHIVE_VERSION = 1;
const MAX_ARCHIVED_CHATS_PER_WORKSPACE = 100;
const AUTO_TITLE_MAX_LENGTH = 50;

type PersistedArchive = {
  version: number;
  workspaces: Record<string, ArchivedChat[]>;
};

function getBrowserStorage(): Storage | null {
  try {
    const storageValue = window.localStorage;
    if (
      typeof storageValue?.getItem !== "function" ||
      typeof storageValue?.setItem !== "function" ||
      typeof storageValue?.removeItem !== "function"
    ) {
      return null;
    }
    return storageValue;
  } catch {
    return null;
  }
}

function makeEmptyArchive(): PersistedArchive {
  return { version: ARCHIVE_VERSION, workspaces: {} };
}

function loadArchive(): PersistedArchive {
  const storage = getBrowserStorage();
  if (storage === null) {
    return makeEmptyArchive();
  }
  try {
    const raw = storage.getItem(ARCHIVE_STORAGE_KEY);
    if (raw === null || raw === "") {
      return makeEmptyArchive();
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== ARCHIVE_VERSION ||
      typeof (parsed as { workspaces?: unknown }).workspaces !== "object" ||
      (parsed as { workspaces?: unknown }).workspaces === null
    ) {
      return makeEmptyArchive();
    }
    return parsed as PersistedArchive;
  } catch {
    return makeEmptyArchive();
  }
}

function saveArchive(archive: PersistedArchive): void {
  const storage = getBrowserStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive));
  } catch {
    // Storage full or unavailable — archiving is best-effort.
  }
}

function resolveWorkspaceKey(workspaceId: string | null): string {
  const trimmed = workspaceId?.trim();
  return trimmed !== undefined && trimmed !== "" ? trimmed : "default";
}

function extractTextContent(content: ReadonlyArray<ContentPart>): string {
  return content
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeAutoTitle(
  messages: ReadonlyArray<StoredMessage>,
  fallbackTitle: string,
): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const text = firstUserMessage !== undefined ? extractTextContent(firstUserMessage.content) : "";
  if (text === "") {
    return fallbackTitle;
  }
  if (text.length <= AUTO_TITLE_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, AUTO_TITLE_MAX_LENGTH).trimEnd()}…`;
}

function makePreview(messages: ReadonlyArray<StoredMessage>): string {
  const lastMessage = messages[messages.length - 1];
  if (lastMessage === undefined) {
    return "";
  }
  const text = extractTextContent(lastMessage.content);
  if (text.length <= 120) {
    return text;
  }
  return `${text.slice(0, 120).trimEnd()}…`;
}

function makeArchiveId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp-based fallback below.
  }
  return `archived-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function listArchivedChats(workspaceId: string | null): ArchivedChatSummary[] {
  const archive = loadArchive();
  const chats = archive.workspaces[resolveWorkspaceKey(workspaceId)] ?? [];
  return [...chats]
    .sort((a, b) => b.summary.updatedAt - a.summary.updatedAt)
    .map((chat) => chat.summary);
}

export function archiveChatSession(
  workspaceId: string | null,
  messages: ReadonlyArray<StoredMessage>,
  fallbackTitle: string,
): ArchivedChatSummary | null {
  if (messages.length === 0) {
    return null;
  }
  const now = Date.now();
  const firstTimestamp = messages[0]?.timestamp ?? now;
  const summary: ArchivedChatSummary = {
    id: makeArchiveId(),
    title: makeAutoTitle(messages, fallbackTitle),
    createdAt: firstTimestamp,
    updatedAt: now,
    messageCount: messages.length,
    preview: makePreview(messages),
  };
  const archive = loadArchive();
  const key = resolveWorkspaceKey(workspaceId);
  const existing = archive.workspaces[key] ?? [];
  const updated = [{ summary, messages: [...messages] }, ...existing].slice(
    0,
    MAX_ARCHIVED_CHATS_PER_WORKSPACE,
  );
  archive.workspaces[key] = updated;
  saveArchive(archive);
  return summary;
}

export function getArchivedChat(
  workspaceId: string | null,
  chatId: string,
): ArchivedChat | null {
  const archive = loadArchive();
  const chats = archive.workspaces[resolveWorkspaceKey(workspaceId)] ?? [];
  return chats.find((chat) => chat.summary.id === chatId) ?? null;
}

export function renameArchivedChat(
  workspaceId: string | null,
  chatId: string,
  title: string,
): boolean {
  const trimmed = title.trim();
  if (trimmed === "") {
    return false;
  }
  const archive = loadArchive();
  const key = resolveWorkspaceKey(workspaceId);
  const chats = archive.workspaces[key] ?? [];
  const index = chats.findIndex((chat) => chat.summary.id === chatId);
  if (index < 0) {
    return false;
  }
  const existing = chats[index];
  if (existing === undefined) {
    return false;
  }
  const updated = [...chats];
  updated[index] = {
    summary: { ...existing.summary, title: trimmed },
    messages: existing.messages,
  };
  archive.workspaces[key] = updated;
  saveArchive(archive);
  return true;
}

export function deleteArchivedChat(workspaceId: string | null, chatId: string): boolean {
  const archive = loadArchive();
  const key = resolveWorkspaceKey(workspaceId);
  const chats = archive.workspaces[key] ?? [];
  const filtered = chats.filter((chat) => chat.summary.id !== chatId);
  if (filtered.length === chats.length) {
    return false;
  }
  archive.workspaces[key] = filtered;
  saveArchive(archive);
  return true;
}
