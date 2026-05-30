import {
  captureWebWarning,
  type SyncRestoreLocalBootstrapState,
  type WebObservationScope,
} from "../../observability/webObservability";

export type HotBootstrapSlowObservationInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  durationMs: number;
  pageSize: number;
  pageCount: number;
  entriesCount: number;
  localCardCountBefore: number;
  localCardCountAfter: number;
  localBootstrapState: SyncRestoreLocalBootstrapState;
  lastAppliedHotChangeIdBefore: number | null;
  nextHotChangeId: number | null;
  remoteIsEmpty: boolean | null;
}>;

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildSyncObservationScope(
  userId: string,
  workspaceId: string,
  installationId: string,
): WebObservationScope {
  return {
    app: "web",
    feature: "sync",
    userId,
    workspaceId,
    installationId,
    route: getCurrentRoute(),
    requestId: null,
    statusCode: null,
    code: null,
  };
}

export function observeSlowHotBootstrap(input: HotBootstrapSlowObservationInput): void {
  captureWebWarning({
    action: "sync_restore_slow",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "sync_hot_bootstrap_slow",
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      durationMs: input.durationMs,
      pageSize: input.pageSize,
      pageCount: input.pageCount,
      entriesCount: input.entriesCount,
      localCardCountBefore: input.localCardCountBefore,
      localCardCountAfter: input.localCardCountAfter,
      localBootstrapState: input.localBootstrapState,
      lastAppliedHotChangeIdBefore: input.lastAppliedHotChangeIdBefore,
      nextHotChangeId: input.nextHotChangeId,
      remoteIsEmpty: input.remoteIsEmpty,
    },
  });
}
