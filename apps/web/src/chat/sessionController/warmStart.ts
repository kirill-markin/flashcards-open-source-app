import { parseChatSessionSnapshotResponse } from "../../apiContracts";
import type { ChatConfig, ChatSessionSnapshot } from "../../types";

const CHAT_SESSION_WARM_START_STORAGE_KEY = "flashcards-chat-session-snapshot";
const CHAT_SESSION_WARM_START_VERSION = 4;

type PersistedChatSessionWarmStartSnapshot = Readonly<{
  version: 3 | 4;
  workspaceId: string;
  snapshot: ChatSessionSnapshot;
  savedAt: string;
  pendingToolRunPostSync?: boolean;
}>;

export type WarmStartChatSessionSnapshot = Readonly<{
  workspaceId: string;
  sessionId: string;
  updatedAt: number;
  mainContentInvalidationVersion: number;
  chatConfig: ChatConfig;
  messages: ChatSessionSnapshot["conversation"]["messages"];
  pendingToolRunPostSync: boolean;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function parsePendingToolRunPostSync(
  value: unknown,
  version: number,
): boolean | undefined {
  if (version === 3) {
    return undefined;
  }

  return value === true;
}

function getBrowserStorage(): Storage | null {
  const storageValue = window.localStorage;
  if (
    typeof storageValue?.getItem !== "function"
    || typeof storageValue?.setItem !== "function"
    || typeof storageValue?.removeItem !== "function"
  ) {
    return null;
  }

  return storageValue;
}

function parsePersistedChatSessionWarmStartSnapshot(
  rawValue: string | null,
): PersistedChatSessionWarmStartSnapshot | null {
  if (rawValue === null) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (
      isRecord(parsedValue) === false
      || (parsedValue.version !== 3 && parsedValue.version !== CHAT_SESSION_WARM_START_VERSION)
      || typeof parsedValue.workspaceId !== "string"
      || parsedValue.workspaceId === ""
      || typeof parsedValue.savedAt !== "string"
      || (
        parsedValue.version === CHAT_SESSION_WARM_START_VERSION
        && typeof parsedValue.pendingToolRunPostSync !== "boolean"
      )
    ) {
      return null;
    }

    const snapshot = parseChatSessionSnapshotResponse(parsedValue.snapshot, "local chat warm start snapshot");
    return {
      version: parsedValue.version,
      workspaceId: parsedValue.workspaceId,
      snapshot,
      savedAt: parsedValue.savedAt,
      pendingToolRunPostSync: parsePendingToolRunPostSync(
        parsedValue.pendingToolRunPostSync,
        parsedValue.version,
      ),
    };
  } catch {
    return null;
  }
}

function toWarmStartChatSessionSnapshot(
  persistedSnapshot: PersistedChatSessionWarmStartSnapshot,
): WarmStartChatSessionSnapshot {
  return {
    workspaceId: persistedSnapshot.workspaceId,
    sessionId: persistedSnapshot.snapshot.sessionId,
    updatedAt: persistedSnapshot.snapshot.conversation.updatedAt,
    mainContentInvalidationVersion: persistedSnapshot.snapshot.conversation.mainContentInvalidationVersion,
    chatConfig: persistedSnapshot.snapshot.chatConfig,
    messages: persistedSnapshot.snapshot.conversation.messages,
    pendingToolRunPostSync: persistedSnapshot.pendingToolRunPostSync === true,
  };
}

export function loadChatSessionWarmStartSnapshot(
  workspaceId: string | null,
): WarmStartChatSessionSnapshot | null {
  if (workspaceId === null) {
    return null;
  }

  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return null;
  }

  const persistedSnapshot = parsePersistedChatSessionWarmStartSnapshot(
    browserStorage.getItem(CHAT_SESSION_WARM_START_STORAGE_KEY),
  );
  if (persistedSnapshot === null || persistedSnapshot.workspaceId !== workspaceId) {
    return null;
  }

  return toWarmStartChatSessionSnapshot(persistedSnapshot);
}

export function storeChatSessionWarmStartSnapshot(
  workspaceId: string,
  snapshot: ChatSessionSnapshot,
  pendingToolRunPostSync: boolean,
): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  const persistedSnapshot: PersistedChatSessionWarmStartSnapshot = {
    version: 4,
    workspaceId,
    savedAt: new Date().toISOString(),
    pendingToolRunPostSync,
    snapshot: {
      ...snapshot,
      composerSuggestions: [],
      activeRun: null,
    },
  };

  browserStorage.setItem(CHAT_SESSION_WARM_START_STORAGE_KEY, JSON.stringify(persistedSnapshot));
}

export function clearChatSessionWarmStartSnapshot(): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  browserStorage.removeItem(CHAT_SESSION_WARM_START_STORAGE_KEY);
}
