import type { DeferredProgressRefresh } from "../../progress/invalidation/deferredProgressRefresh";

/*
 * Every tab of this origin shares one IndexedDB, hot-sync cursor included, so a tab's own sync never sees what
 * another tab wrote or pulled. Each local write and each pull that applied remote changes is announced here, and
 * the other tabs re-read as for a sync that applied remote changes; a tab never hears its own announcements, so
 * its own ratings and their echoes still never rebuild it: docs/fsrs-scheduling-logic.md#non-blocking-review
 */

type WorkspaceLocalDataChangedMessage = Readonly<{
  senderTabId: string;
  progressRefresh: DeferredProgressRefresh;
}>;

const thisTabId = crypto.randomUUID();

function workspaceLocalDataChannelName(workspaceId: string): string {
  return `flashcards-workspace-local-data:${workspaceId}`;
}

function isBroadcastChannelAvailable(): boolean {
  return typeof BroadcastChannel !== "undefined";
}

export function announceWorkspaceLocalDataChangeToOtherTabs(
  workspaceId: string,
  progressRefresh: DeferredProgressRefresh,
): void {
  if (isBroadcastChannelAvailable() === false) {
    return;
  }

  const message: WorkspaceLocalDataChangedMessage = { senderTabId: thisTabId, progressRefresh };
  const channel = new BroadcastChannel(workspaceLocalDataChannelName(workspaceId));
  channel.postMessage(message);
  channel.close();
}

export function subscribeToWorkspaceLocalDataChangesFromOtherTabs(
  workspaceId: string,
  listener: (progressRefresh: DeferredProgressRefresh) => void,
): () => void {
  if (isBroadcastChannelAvailable() === false) {
    return (): void => undefined;
  }

  const channel = new BroadcastChannel(workspaceLocalDataChannelName(workspaceId));
  channel.onmessage = (event: MessageEvent<WorkspaceLocalDataChangedMessage>): void => {
    if (event.data.senderTabId !== thisTabId) {
      listener(event.data.progressRefresh);
    }
  };

  return (): void => {
    channel.close();
  };
}
