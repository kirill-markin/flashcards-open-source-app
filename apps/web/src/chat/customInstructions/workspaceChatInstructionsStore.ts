import { useEffect, useSyncExternalStore } from "react";

/**
 * In-memory copy of each workspace's chat custom instructions, fed by every chat response and by the
 * editor. Edits are online-only (see the backend route), so nothing here is persisted.
 */
export type WorkspaceChatInstructionsRequestToken = Readonly<{
  workspaceId: string;
  generation: number;
  writeVersion: number;
}>;

const entries = new Map<string, string | null>();
const writeVersions = new Map<string, number>();
const listeners = new Set<() => void>();
let generation = 0;
let scopedAccountId: string | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Taken before a request whose response carries the value, so a late answer cannot undo a newer save. */
export function beginWorkspaceChatInstructionsRequest(workspaceId: string): WorkspaceChatInstructionsRequestToken {
  return { workspaceId, generation, writeVersion: writeVersions.get(workspaceId) ?? 0 };
}

export function recordWorkspaceChatInstructions(
  token: WorkspaceChatInstructionsRequestToken,
  customInstructions: string | null,
  kind: "read" | "write",
): void {
  const currentWriteVersion = writeVersions.get(token.workspaceId) ?? 0;
  if (token.generation !== generation || token.writeVersion !== currentWriteVersion) {
    return;
  }

  if (kind === "write") {
    writeVersions.set(token.workspaceId, currentWriteVersion + 1);
  }
  entries.set(token.workspaceId, customInstructions);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Values belong to the signed-in account; switching accounts drops them and any answer still in flight. */
function scopeToAccount(accountId: string | null): void {
  if (accountId === scopedAccountId) {
    return;
  }

  const hadAccount = scopedAccountId !== null;
  scopedAccountId = accountId;
  if (hadAccount) {
    entries.clear();
    generation += 1;
    notify();
  }
}

export function useWorkspaceChatInstructions(
  accountId: string | null,
  workspaceId: string | null,
): string | null | undefined {
  useEffect(() => {
    scopeToAccount(accountId);
  }, [accountId]);

  return useSyncExternalStore(
    subscribe,
    () => (workspaceId === null ? undefined : entries.get(workspaceId)),
  );
}
