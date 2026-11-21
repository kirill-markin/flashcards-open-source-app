import { useMemo, useSyncExternalStore } from "react";
import {
  getCachedSessionAccountId,
  getCachedSessionAuthKind,
  isBrowserGuestSessionVerified,
  readBrowserGuestVerificationGeneration,
  subscribeToBrowserGuestVerification,
  type ExpectedAuth,
} from "../../api/transport/transport";
import { readBrowserGuestState } from "../../appData/session/guest/browserGuestStorage";
import type { SessionVerificationState } from "../../appData/session/workspaceSessionTypes";
import type { SessionInfo } from "../../types";

export type WorkspaceChatInstructionsScope = Readonly<{
  accountId: string;
  userId: string;
  workspaceId: string;
  auth: ExpectedAuth;
  editorKey: string;
}>;

function readGuestGeneration(userId: string, workspaceId: string): number | null {
  if (!isBrowserGuestSessionVerified(userId, workspaceId)) {
    return null;
  }
  const saved = readBrowserGuestState();
  return saved?.status === "owned" && saved.owner.userId === userId && saved.owner.workspaceId === workspaceId
    && saved.owner.pending === null ? readBrowserGuestVerificationGeneration(userId) : null;
}

export function useWorkspaceChatInstructionsScope(
  session: SessionInfo | null,
  state: SessionVerificationState,
  workspaceId: string | null,
): WorkspaceChatInstructionsScope | null {
  const userId = state === "verified" ? session?.userId ?? null : null;
  const accountId = session?.canonicalAccountId ?? userId;
  const isGuest = session?.browserGuestCapabilities?.isGuest === true;
  const guestGeneration = useSyncExternalStore(subscribeToBrowserGuestVerification, () =>
    isGuest && userId !== null && workspaceId !== null ? readGuestGeneration(userId, workspaceId) : null,
  );
  return useMemo(() => {
    if (userId === null || accountId === null || workspaceId === null || (isGuest && guestGeneration === null)) {
      return null;
    }
    return {
      accountId,
      userId,
      workspaceId,
      auth: guestGeneration === null ? { kind: "registered" } : { kind: "guest", generation: guestGeneration },
      editorKey: JSON.stringify([accountId, userId, workspaceId, guestGeneration]),
    };
  }, [accountId, guestGeneration, isGuest, userId, workspaceId]);
}

export function isCurrentWorkspaceChatInstructionsCredential(scope: WorkspaceChatInstructionsScope): boolean {
  return getCachedSessionAccountId() === scope.accountId && getCachedSessionAuthKind() === scope.auth.kind
    && (scope.auth.kind === "registered" || readGuestGeneration(scope.userId, scope.workspaceId) === scope.auth.generation);
}

type WorkspaceChatInstructionsRequestToken = Readonly<{
  scope: WorkspaceChatInstructionsScope;
  readVersion: number;
}>;

type WorkspaceChatInstructionsSave = Readonly<{
  token: WorkspaceChatInstructionsRequestToken;
  finish: () => void;
}>;

let activeScope: WorkspaceChatInstructionsScope | null = null;
let instructions: string | null | undefined;
let requestVersion = 0;
let recordedVersion = 0;
const pendingSaves = new Set<string>();
const listeners = new Set<() => void>();

function saveScopeKey(scope: WorkspaceChatInstructionsScope): string {
  return JSON.stringify([scope.accountId, scope.workspaceId, scope.auth]);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function scopeWorkspaceChatInstructions(scope: WorkspaceChatInstructionsScope | null): void {
  if (activeScope?.editorKey === scope?.editorKey) {
    return;
  }
  activeScope = scope;
  instructions = undefined;
  notify();
}

export function beginWorkspaceChatInstructionsRequest(
  scope: WorkspaceChatInstructionsScope,
): WorkspaceChatInstructionsRequestToken | null {
  if (activeScope?.editorKey !== scope.editorKey) {
    return null;
  }
  return { scope: activeScope, readVersion: ++requestVersion };
}

export function beginChatSnapshotInstructionsRequest(
  accountId: string | null,
  workspaceId: string | undefined,
): WorkspaceChatInstructionsRequestToken | null {
  if (activeScope === null || activeScope.accountId !== accountId || activeScope.workspaceId !== workspaceId) {
    return null;
  }
  return beginWorkspaceChatInstructionsRequest(activeScope);
}

export function beginWorkspaceChatInstructionsSave(
  scope: WorkspaceChatInstructionsScope,
): WorkspaceChatInstructionsSave | null {
  const key = saveScopeKey(scope);
  if (pendingSaves.has(key)) {
    return null;
  }
  const token = beginWorkspaceChatInstructionsRequest(scope);
  if (token === null) {
    return null;
  }
  pendingSaves.add(key);
  notify();

  return {
    token,
    finish: () => {
      pendingSaves.delete(key);
      notify();
    },
  };
}

export function isCurrentWorkspaceChatInstructionsRequest(token: WorkspaceChatInstructionsRequestToken): boolean {
  return token.scope === activeScope;
}

export function recordWorkspaceChatInstructions(
  token: WorkspaceChatInstructionsRequestToken,
  customInstructions: string | null,
  kind: "read" | "write",
): void {
  if (activeScope === null || !isCurrentWorkspaceChatInstructionsCredential(token.scope)) {
    return;
  }
  const isActiveScope = kind === "write"
    ? saveScopeKey(activeScope) === saveScopeKey(token.scope)
    : isCurrentWorkspaceChatInstructionsRequest(token);
  if (!isActiveScope) {
    return;
  }

  // A successful save takes precedence over every read already in flight.
  const version = kind === "write" ? ++requestVersion : token.readVersion;
  if (version <= recordedVersion) {
    return;
  }
  recordedVersion = version;
  instructions = customInstructions;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaceChatInstructions(scope: WorkspaceChatInstructionsScope | null): string | null | undefined {
  return useSyncExternalStore(subscribe, () =>
    scope !== null && scope.editorKey === activeScope?.editorKey && isCurrentWorkspaceChatInstructionsCredential(scope)
      ? instructions : undefined,
  );
}

export function useWorkspaceChatInstructionsSaving(scope: WorkspaceChatInstructionsScope): boolean {
  return useSyncExternalStore(subscribe, () => pendingSaves.has(saveScopeKey(scope)));
}
