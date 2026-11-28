import { chatRoute, normalizeRoutePath, splitWorkspaceRoutePath } from "../../routes";
import { loadChatDraftWorkspaceState, type StoredChatDraft } from "../composer/drafts/chatDraftStorage";

const fragmentPrefix = "#catalog-topic=";
const storageKey = "flashcards-catalog-chat-handoff";

type CatalogChatDraftTransfer = Readonly<{
  draftId: string;
  sourceWorkspaceId: string;
  destinationWorkspaceId: string | null;
}>;

export type CatalogChatHandoff = Readonly<{
  userId: string | null;
  topic: string | null;
  transfer: CatalogChatDraftTransfer | null;
}>;

let handoff: CatalogChatHandoff | null = null;
let guestSignInUserId: string | null = null;
const listeners = new Set<() => void>();

function isBlockedStorage(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "SecurityError" || error.name === "QuotaExceededError");
}

function notifyCatalogChatHandoffChanged(): void {
  for (const listener of listeners) listener();
}

function storeCatalogChatHandoff(nextHandoff: CatalogChatHandoff | null): void {
  handoff = nextHandoff?.topic === null && nextHandoff.transfer === null ? null : nextHandoff;
  try {
    if (handoff === null) {
      window.sessionStorage.removeItem(storageKey);
    } else {
      window.sessionStorage.setItem(storageKey, JSON.stringify(handoff));
    }
  } catch (error) {
    if (!isBlockedStorage(error)) throw error;
  }
  notifyCatalogChatHandoffChanged();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function loadCatalogChatHandoff(): CatalogChatHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) return null;
    const stored: Partial<CatalogChatHandoff> | null = JSON.parse(raw);
    if (stored === null || (stored.userId !== null && !isNonEmptyString(stored.userId))
      || (stored.topic !== null && !isNonEmptyString(stored.topic))) return null;
    const transfer = stored.transfer;
    if (transfer !== null && (!isNonEmptyString(stored.userId) || !isNonEmptyString(transfer?.draftId)
      || !isNonEmptyString(transfer.sourceWorkspaceId)
      || (transfer.destinationWorkspaceId !== null && !isNonEmptyString(transfer.destinationWorkspaceId)))) return null;
    if (stored.topic === null && transfer === null) return null;
    return { userId: stored.userId, topic: stored.topic, transfer };
  } catch (error) {
    if (isBlockedStorage(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

export function readCatalogChatHandoff(): CatalogChatHandoff | null {
  return handoff;
}

export function subscribeToCatalogChatHandoff(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function bindCatalogChatHandoffOwner(userId: string): void {
  if (handoff === null || handoff.userId === userId) return;
  storeCatalogChatHandoff(handoff.userId === null ? { ...handoff, userId } : null);
}

export function clearCatalogChatHandoff(): void {
  guestSignInUserId = null;
  storeCatalogChatHandoff(null);
}

export function readCatalogChatGuestSignInUserId(): string | null {
  return guestSignInUserId;
}

export function holdCatalogChatDuringGuestSignIn(userId: string): boolean {
  if (guestSignInUserId === userId) return false;
  guestSignInUserId = userId;
  notifyCatalogChatHandoffChanged();
  return true;
}

export function consumeCatalogChatTopic(expected: CatalogChatHandoff): void {
  if (handoff === expected) storeCatalogChatHandoff({ ...expected, topic: null });
}

export function consumeCatalogChatDraftTransfer(expected: CatalogChatHandoff): void {
  if (handoff === expected) storeCatalogChatHandoff({ ...expected, transfer: null });
}

export function cancelCatalogChatDraftTransfer(userId: string, workspaceId: string): void {
  const wasSignInInProgress = guestSignInUserId === userId;
  if (wasSignInInProgress) guestSignInUserId = null;
  if (handoff?.userId === userId && handoff.transfer?.sourceWorkspaceId === workspaceId
    && handoff.transfer.destinationWorkspaceId === null) {
    consumeCatalogChatDraftTransfer(handoff);
  } else if (wasSignInInProgress) {
    notifyCatalogChatHandoffChanged();
  }
}

export function carryCatalogChatHandoffThroughGuestConversion(
  sourceUserId: string,
  sourceWorkspaceId: string,
  destinationUserId: string,
  destinationWorkspaceId: string,
): void {
  if (handoff === null || handoff.userId !== sourceUserId) return;
  if (guestSignInUserId === sourceUserId) guestSignInUserId = null;
  const transfer = handoff.transfer;
  storeCatalogChatHandoff({
    ...handoff,
    userId: destinationUserId,
    transfer: transfer?.sourceWorkspaceId === sourceWorkspaceId ? { ...transfer, destinationWorkspaceId } : null,
  });
}

function findLatestMarkedCatalogDraftId(workspaceId: string): string | null {
  let latestDraft: StoredChatDraft | null = null;
  for (const draft of Object.values(loadChatDraftWorkspaceState(workspaceId))) {
    if (draft.catalogHandoffId === undefined) continue;
    if (latestDraft === null || latestDraft.updatedAt < draft.updatedAt) latestDraft = draft;
  }
  return latestDraft?.catalogHandoffId ?? null;
}

export function prepareCatalogChatGuestSignIn(
  userId: string,
  workspaceId: string,
  markActiveDraftForTransfer: (() => string | null) | undefined,
): string | undefined {
  const { origin, pathname, search, hash } = window.location;
  const route = splitWorkspaceRoutePath(pathname);
  const canReturnToCatalogChat = hash === "" && normalizeRoutePath(route.appPath) === chatRoute
    && route.workspaceId === workspaceId.toLowerCase();
  const topic = handoff?.userId === userId ? handoff.topic : null;
  const activeDraftId = topic !== null ? markActiveDraftForTransfer?.() : null;
  const draftId = activeDraftId ?? findLatestMarkedCatalogDraftId(workspaceId);
  if (draftId === null && topic === null) return undefined;
  storeCatalogChatHandoff({
    userId,
    topic,
    transfer: draftId === null ? null : { draftId, sourceWorkspaceId: workspaceId, destinationWorkspaceId: null },
  });
  return canReturnToCatalogChat ? origin + chatRoute + search : undefined;
}

function captureCatalogChatHandoff(): void {
  const { pathname, search, hash } = window.location;
  const rawTopic = hash.startsWith(fragmentPrefix) ? hash.slice(fragmentPrefix.length) : null;
  if (pathname === chatRoute && rawTopic !== null && !/[&#]/u.test(rawTopic)) {
    window.history.replaceState(window.history.state, "", pathname + search);
    try {
      const topic = decodeURIComponent(rawTopic).trim();
      if (topic !== "") {
        storeCatalogChatHandoff({ userId: null, topic, transfer: null });
        return;
      }
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
  }

  handoff = loadCatalogChatHandoff();
}

// Imported before observability so the topic never enters the initial page URL telemetry or auth return URL.
if (typeof window !== "undefined") captureCatalogChatHandoff();
