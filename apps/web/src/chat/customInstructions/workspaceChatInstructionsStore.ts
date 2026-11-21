import { useSyncExternalStore } from "react";
import type { SessionVerificationState } from "../../appData/session/workspaceSessionTypes";
import type { SessionInfo } from "../../types";

export function getWorkspaceChatInstructionsAccountId(
  session: SessionInfo | null,
  sessionVerificationState: SessionVerificationState,
): string | null {
  return sessionVerificationState === "verified" && session?.browserGuestCapabilities?.isGuest !== true
    ? session?.canonicalAccountId ?? session?.userId ?? null
    : null;
}

type WorkspaceChatInstructionsScope = Readonly<{
  accountId: string;
  workspaceId: string;
}>;

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

function saveScopeKey(accountId: string, workspaceId: string): string {
  return JSON.stringify([accountId, workspaceId]);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function scopeWorkspaceChatInstructions(accountId: string | null, workspaceId: string | null): void {
  if (activeScope?.accountId === accountId && activeScope.workspaceId === workspaceId) {
    return;
  }
  activeScope = accountId === null || workspaceId === null ? null : { accountId, workspaceId };
  instructions = undefined;
  notify();
}

export function beginWorkspaceChatInstructionsRequest(
  accountId: string | null,
  workspaceId: string,
): WorkspaceChatInstructionsRequestToken | null {
  if (activeScope === null || activeScope.accountId !== accountId || activeScope.workspaceId !== workspaceId) {
    return null;
  }
  return { scope: activeScope, readVersion: ++requestVersion };
}

export function beginWorkspaceChatInstructionsSave(
  accountId: string,
  workspaceId: string,
): WorkspaceChatInstructionsSave | null {
  const key = saveScopeKey(accountId, workspaceId);
  if (pendingSaves.has(key)) {
    return null;
  }
  const token = beginWorkspaceChatInstructionsRequest(accountId, workspaceId);
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
  const isActiveScope = kind === "write"
    ? activeScope?.accountId === token.scope.accountId && activeScope.workspaceId === token.scope.workspaceId
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

export function useWorkspaceChatInstructions(
  accountId: string | null,
  workspaceId: string | null,
): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => activeScope?.accountId === accountId && activeScope.workspaceId === workspaceId ? instructions : undefined,
  );
}

export function useWorkspaceChatInstructionsSaving(
  accountId: string | null,
  workspaceId: string | null,
): boolean {
  return useSyncExternalStore(subscribe, () =>
    accountId !== null && workspaceId !== null && pendingSaves.has(saveScopeKey(accountId, workspaceId)),
  );
}
