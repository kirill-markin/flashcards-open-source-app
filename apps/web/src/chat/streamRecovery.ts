import type { StoredMessage } from "./useChatHistory";

export type ChatRunState = "idle" | "running" | "interrupted";
export type ChatComposerAction = "send" | "stop";

export type ChatSnapshotState = Readonly<{
  runState: ChatRunState;
  updatedAt: number;
  mainContentInvalidationVersion: number;
  messages: ReadonlyArray<StoredMessage>;
}>;

export const ACTIVE_RUN_SNAPSHOT_POLL_INTERVAL_MS = 2_000;

export function shouldReplaceHistoryFromSnapshot(
  previousUpdatedAt: number | null,
  snapshotUpdatedAt: number,
): boolean {
  return previousUpdatedAt === null || snapshotUpdatedAt > previousUpdatedAt;
}

export function getEffectiveSnapshotRunState(
  snapshotRunState: ChatRunState,
  isUserStoppedSession: boolean,
): ChatRunState {
  return isUserStoppedSession && snapshotRunState === "running"
    ? "idle"
    : snapshotRunState;
}

export function isChatRunActive(runState: ChatRunState): boolean {
  return runState === "running";
}

export function getChatComposerAction(runState: ChatRunState): ChatComposerAction {
  return isChatRunActive(runState) ? "stop" : "send";
}
