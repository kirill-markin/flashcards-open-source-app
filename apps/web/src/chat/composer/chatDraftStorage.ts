import type { PendingAttachment } from "../attachments/FileAttachment";
import type { LegacyEffortLevel } from "../../types";
import { appendLegacyEffortTag } from "../../legacyEffort";

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

type ChatDraftWorkspaceStateChangeListener = (workspaceId: string | null) => void;

type ChatDraftWorkspaceStateChangedDetail = Readonly<{
  workspaceId: string | null;
}>;

const CHAT_DRAFT_STORAGE_KEY_PREFIX = "flashcards-chat-drafts::";
const CHAT_DRAFT_STORAGE_CHANGED_EVENT = "flashcards-chat-draft-storage-changed";
const CHAT_DRAFT_STORAGE_VERSION = 1;
let chatDraftUpdateSequence = Date.now();

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

function getBrowserWindow(): Window | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function parseLegacyEffortLevel(value: unknown): LegacyEffortLevel | null {
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
      tags: appendLegacyEffortTag(tags, parseLegacyEffortLevel(value.effortLevel) ?? undefined),
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

function parseWorkspaceIdFromStorageKey(storageKey: string | null): string | null {
  if (storageKey === null || storageKey.startsWith(CHAT_DRAFT_STORAGE_KEY_PREFIX) === false) {
    return null;
  }

  return normalizeWorkspaceId(storageKey.slice(CHAT_DRAFT_STORAGE_KEY_PREFIX.length));
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

function createNextDraftUpdatedAt(): number {
  const nextUpdatedAt = Math.max(Date.now(), chatDraftUpdateSequence + 1);
  chatDraftUpdateSequence = nextUpdatedAt;
  return nextUpdatedAt;
}

function areStringArraysEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function arePendingAttachmentsEqual(
  left: PendingAttachment,
  right: PendingAttachment,
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "binary") {
    return right.type === "binary"
      && left.fileName === right.fileName
      && left.mediaType === right.mediaType
      && left.base64Data === right.base64Data;
  }

  return right.type === "card"
    && left.attachmentId === right.attachmentId
    && left.cardId === right.cardId
    && left.frontText === right.frontText
    && left.backText === right.backText
    && areStringArraysEqual(left.tags, right.tags);
}

export function areChatDraftContentsEqual(
  left: ChatDraftContent,
  right: ChatDraftContent,
): boolean {
  return left.inputText === right.inputText
    && left.pendingAttachments.length === right.pendingAttachments.length
    && left.pendingAttachments.every((attachment, index) => {
      const rightAttachment = right.pendingAttachments[index];
      return rightAttachment !== undefined && arePendingAttachmentsEqual(attachment, rightAttachment);
    });
}

function parseChatDraftWorkspaceStateChangedDetail(value: unknown): ChatDraftWorkspaceStateChangedDetail | null {
  if (isRecord(value) === false) {
    return null;
  }

  const workspaceIdValue = value.workspaceId;
  if (workspaceIdValue !== null && typeof workspaceIdValue !== "string") {
    return null;
  }

  return {
    workspaceId: normalizeWorkspaceId(workspaceIdValue),
  };
}

function notifyChatDraftWorkspaceStateChanged(workspaceId: string | null): void {
  const windowValue = getBrowserWindow();
  if (windowValue === null) {
    return;
  }

  windowValue.dispatchEvent(new CustomEvent<ChatDraftWorkspaceStateChangedDetail>(
    CHAT_DRAFT_STORAGE_CHANGED_EVENT,
    {
      detail: {
        workspaceId: normalizeWorkspaceId(workspaceId),
      },
    },
  ));
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
  if (sessionId === null) {
    throw new Error("Chat draft sessionId is required");
  }

  const trimmedSessionId = sessionId.trim();
  if (trimmedSessionId === "") {
    throw new Error("Chat draft sessionId must not be empty");
  }

  return trimmedSessionId;
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

export function clearStoredChatDraftForSessionIfUnchanged(
  workspaceId: string | null,
  sessionId: string | null,
  expectedDraft: ChatDraftContent,
  expectedUpdatedAt: number | null,
): void {
  if (sessionId === null || expectedUpdatedAt === null) {
    return;
  }

  const currentState = loadWorkspaceDraftState(workspaceId);
  const currentDraft = readStoredChatDraftForSession(currentState.draftsBySessionId, sessionId);
  if (
    currentDraft === null
    || currentDraft.updatedAt !== expectedUpdatedAt
    || areChatDraftContentsEqual(currentDraft, expectedDraft) === false
  ) {
    return;
  }

  const nextDraftsBySessionId = replaceChatDraftForSession(
    currentState.draftsBySessionId,
    sessionId,
    createChatDraftContent("", []),
  );
  storeWorkspaceDraftState(workspaceId, {
    version: CHAT_DRAFT_STORAGE_VERSION,
    draftsBySessionId: { ...nextDraftsBySessionId },
  });
  notifyChatDraftWorkspaceStateChanged(workspaceId);
}

export function subscribeToChatDraftWorkspaceStateChanges(
  listener: ChatDraftWorkspaceStateChangeListener,
): () => void {
  const windowValue = getBrowserWindow();
  if (windowValue === null) {
    return () => undefined;
  }

  const handleEvent = (event: Event): void => {
    if (event instanceof CustomEvent === false) {
      return;
    }

    const detail = parseChatDraftWorkspaceStateChangedDetail(event.detail);
    if (detail === null) {
      return;
    }

    listener(detail.workspaceId);
  };

  const handleStorageEvent = (event: StorageEvent): void => {
    const changedWorkspaceId = parseWorkspaceIdFromStorageKey(event.key);
    if (changedWorkspaceId === null) {
      return;
    }

    listener(changedWorkspaceId);
  };

  windowValue.addEventListener(CHAT_DRAFT_STORAGE_CHANGED_EVENT, handleEvent);
  windowValue.addEventListener("storage", handleStorageEvent);
  return () => {
    windowValue.removeEventListener(CHAT_DRAFT_STORAGE_CHANGED_EVENT, handleEvent);
    windowValue.removeEventListener("storage", handleStorageEvent);
  };
}

export function replaceChatDraftForSession(
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  sessionId: string | null,
  draft: ChatDraftContent,
): Readonly<Record<string, StoredChatDraft>> {
  if (sessionId === null) {
    return draftsBySessionId;
  }

  const sessionKey = buildChatDraftSessionKey(sessionId);
  const nextDraftsBySessionId = { ...draftsBySessionId };

  if (isDraftEmpty(draft)) {
    delete nextDraftsBySessionId[sessionKey];
    return nextDraftsBySessionId;
  }

  nextDraftsBySessionId[sessionKey] = {
    inputText: draft.inputText,
    pendingAttachments: draft.pendingAttachments,
    updatedAt: createNextDraftUpdatedAt(),
  };
  return nextDraftsBySessionId;
}

export function readChatDraftForSession(
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  sessionId: string | null,
): ChatDraftContent | null {
  const storedDraft = readStoredChatDraftForSession(draftsBySessionId, sessionId);
  if (storedDraft === null) {
    return null;
  }

  return {
    inputText: storedDraft.inputText,
    pendingAttachments: storedDraft.pendingAttachments,
  };
}

export function readStoredChatDraftForSession(
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  sessionId: string | null,
): StoredChatDraft | null {
  if (sessionId === null) {
    return null;
  }

  const draft = draftsBySessionId[buildChatDraftSessionKey(sessionId)];
  if (draft === undefined) {
    return null;
  }

  return {
    inputText: draft.inputText,
    pendingAttachments: draft.pendingAttachments,
    updatedAt: draft.updatedAt,
  };
}
