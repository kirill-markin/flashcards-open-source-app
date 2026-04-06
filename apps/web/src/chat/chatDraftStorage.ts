import type { PendingAttachment } from "./FileAttachment";
import type { EffortLevel } from "../types";

export type ChatDraftContent = Readonly<{
  inputText: string;
  pendingAttachments: ReadonlyArray<PendingAttachment>;
}>;

export type StoredChatDraft = ChatDraftContent & Readonly<{
  updatedAt: number;
}>;

type StoredChatDraftWorkspaceState = Readonly<{
  version: 1;
  draftsBySessionId: Record<string, StoredChatDraft>;
}>;

const CHAT_DRAFT_STORAGE_KEY_PREFIX = "flashcards-chat-drafts::";
const CHAT_DRAFT_STORAGE_VERSION = 1;
export const CHAT_DRAFT_PENDING_SESSION_KEY = "__pending__";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function parseEffortLevel(value: unknown): EffortLevel | null {
  if (value === "fast" || value === "medium" || value === "long") {
    return value;
  }

  return null;
}

function parsePendingAttachment(value: unknown): PendingAttachment | null {
  if (isRecord(value) === false || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "binary") {
    if (
      typeof value.fileName !== "string"
      || typeof value.mediaType !== "string"
      || typeof value.base64Data !== "string"
    ) {
      return null;
    }

    return {
      type: "binary",
      fileName: value.fileName,
      mediaType: value.mediaType,
      base64Data: value.base64Data,
    };
  }

  if (value.type === "card") {
    const tagsValue = value.tags;
    if (
      typeof value.attachmentId !== "string"
      || typeof value.cardId !== "string"
      || typeof value.frontText !== "string"
      || typeof value.backText !== "string"
      || Array.isArray(tagsValue) === false
      || parseEffortLevel(value.effortLevel) === null
    ) {
      return null;
    }

    const tags = tagsValue.every((tag) => typeof tag === "string") ? tagsValue as ReadonlyArray<string> : null;
    if (tags === null) {
      return null;
    }

    return {
      type: "card",
      attachmentId: value.attachmentId,
      cardId: value.cardId,
      frontText: value.frontText,
      backText: value.backText,
      tags,
      effortLevel: parseEffortLevel(value.effortLevel) as EffortLevel,
    };
  }

  return null;
}

function parseChatDraftContent(value: unknown): ChatDraftContent | null {
  if (isRecord(value) === false || typeof value.inputText !== "string" || Array.isArray(value.pendingAttachments) === false) {
    return null;
  }

  const pendingAttachments = value.pendingAttachments
    .map((attachment) => parsePendingAttachment(attachment))
    .filter((attachment): attachment is PendingAttachment => attachment !== null);

  return {
    inputText: value.inputText,
    pendingAttachments,
  };
}

function parseStoredChatDraftWorkspaceState(value: unknown): StoredChatDraftWorkspaceState | null {
  if (isRecord(value) === false || value.version !== CHAT_DRAFT_STORAGE_VERSION) {
    return null;
  }

  if (isRecord(value.draftsBySessionId) === false) {
    return null;
  }

  const draftsBySessionId: Record<string, StoredChatDraft> = {};
  for (const [sessionId, draftValue] of Object.entries(value.draftsBySessionId)) {
    if (isRecord(draftValue) === false || typeof draftValue.updatedAt !== "number" || Number.isFinite(draftValue.updatedAt) === false) {
      continue;
    }

    const parsedDraft = parseChatDraftContent(draftValue);
    if (parsedDraft === null) {
      continue;
    }

    draftsBySessionId[sessionId] = {
      inputText: parsedDraft.inputText,
      pendingAttachments: parsedDraft.pendingAttachments,
      updatedAt: draftValue.updatedAt,
    };
  }

  return {
    version: CHAT_DRAFT_STORAGE_VERSION,
    draftsBySessionId,
  };
}

function resolveWorkspaceStorageKey(workspaceId: string): string {
  return `${CHAT_DRAFT_STORAGE_KEY_PREFIX}${workspaceId}`;
}

function normalizeWorkspaceId(workspaceId: string | null): string | null {
  if (workspaceId === null) {
    return null;
  }

  const trimmedWorkspaceId = workspaceId.trim();
  return trimmedWorkspaceId === "" ? null : trimmedWorkspaceId;
}

function isDraftEmpty(draft: ChatDraftContent): boolean {
  return draft.inputText.trim() === "" && draft.pendingAttachments.length === 0;
}

function loadWorkspaceDraftState(workspaceId: string | null): StoredChatDraftWorkspaceState {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId === null) {
    return {
      version: CHAT_DRAFT_STORAGE_VERSION,
      draftsBySessionId: {},
    };
  }

  const storage = getBrowserStorage();
  if (storage === null) {
    return {
      version: CHAT_DRAFT_STORAGE_VERSION,
      draftsBySessionId: {},
    };
  }

  const rawValue = storage.getItem(resolveWorkspaceStorageKey(normalizedWorkspaceId));
  if (rawValue === null) {
    return {
      version: CHAT_DRAFT_STORAGE_VERSION,
      draftsBySessionId: {},
    };
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    const parsedState = parseStoredChatDraftWorkspaceState(parsedValue);
    if (parsedState === null) {
      storage.removeItem(resolveWorkspaceStorageKey(normalizedWorkspaceId));
      return {
        version: CHAT_DRAFT_STORAGE_VERSION,
        draftsBySessionId: {},
      };
    }

    return parsedState;
  } catch {
    storage.removeItem(resolveWorkspaceStorageKey(normalizedWorkspaceId));
    return {
      version: CHAT_DRAFT_STORAGE_VERSION,
      draftsBySessionId: {},
    };
  }
}

function storeWorkspaceDraftState(
  workspaceId: string | null,
  state: StoredChatDraftWorkspaceState,
): void {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId === null) {
    return;
  }

  const storage = getBrowserStorage();
  if (storage === null) {
    return;
  }

  const nextDraftsBySessionId: Record<string, StoredChatDraft> = {};
  for (const [sessionId, draft] of Object.entries(state.draftsBySessionId)) {
    if (isDraftEmpty(draft)) {
      continue;
    }

    nextDraftsBySessionId[sessionId] = draft;
  }

  if (Object.keys(nextDraftsBySessionId).length === 0) {
    storage.removeItem(resolveWorkspaceStorageKey(normalizedWorkspaceId));
    return;
  }

  storage.setItem(
    resolveWorkspaceStorageKey(normalizedWorkspaceId),
    JSON.stringify({
      version: CHAT_DRAFT_STORAGE_VERSION,
      draftsBySessionId: nextDraftsBySessionId,
    }),
  );
}

export function buildChatDraftSessionKey(sessionId: string | null): string {
  return sessionId === null || sessionId.trim() === ""
    ? CHAT_DRAFT_PENDING_SESSION_KEY
    : sessionId;
}

export function createChatDraftContent(
  inputText: string,
  pendingAttachments: ReadonlyArray<PendingAttachment>,
): ChatDraftContent {
  return {
    inputText,
    pendingAttachments,
  };
}

export function loadChatDraftWorkspaceState(workspaceId: string | null): Readonly<Record<string, StoredChatDraft>> {
  return loadWorkspaceDraftState(workspaceId).draftsBySessionId;
}

export function storeChatDraftWorkspaceState(
  workspaceId: string | null,
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
): void {
  storeWorkspaceDraftState(workspaceId, {
    version: CHAT_DRAFT_STORAGE_VERSION,
    draftsBySessionId: { ...draftsBySessionId },
  });
}

export function replaceChatDraftForSession(
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  sessionId: string | null,
  draft: ChatDraftContent,
): Readonly<Record<string, StoredChatDraft>> {
  const sessionKey = buildChatDraftSessionKey(sessionId);
  const nextDraftsBySessionId = { ...draftsBySessionId };

  if (isDraftEmpty(draft)) {
    delete nextDraftsBySessionId[sessionKey];
    return nextDraftsBySessionId;
  }

  nextDraftsBySessionId[sessionKey] = {
    inputText: draft.inputText,
    pendingAttachments: draft.pendingAttachments,
    updatedAt: Date.now(),
  };
  return nextDraftsBySessionId;
}

export function readChatDraftForSession(
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  sessionId: string | null,
): ChatDraftContent | null {
  const draft = draftsBySessionId[buildChatDraftSessionKey(sessionId)];
  if (draft === undefined) {
    return null;
  }

  return {
    inputText: draft.inputText,
    pendingAttachments: draft.pendingAttachments,
  };
}

export function adoptPendingChatDraftIfNeeded(
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  currentSessionId: string,
): Readonly<Record<string, StoredChatDraft>> {
  const pendingDraft = draftsBySessionId[CHAT_DRAFT_PENDING_SESSION_KEY];
  if (pendingDraft === undefined) {
    return draftsBySessionId;
  }

  const currentSessionDraft = draftsBySessionId[currentSessionId];
  if (currentSessionDraft !== undefined) {
    return draftsBySessionId;
  }

  const nextDraftsBySessionId = { ...draftsBySessionId };
  delete nextDraftsBySessionId[CHAT_DRAFT_PENDING_SESSION_KEY];
  nextDraftsBySessionId[currentSessionId] = pendingDraft;
  return nextDraftsBySessionId;
}
