import {
  type SyncBootstrapInput,
  type SyncBootstrapPullResult,
  type SyncBootstrapPushResult,
} from "../../sync";
import type { SyncBootstrapDetails } from "../../observability/sentry";

export function buildSyncBootstrapPullDetails(
  input: Extract<SyncBootstrapInput, Readonly<{ mode: "pull" }>>,
  result: SyncBootstrapPullResult,
  durationMs: number,
): SyncBootstrapDetails {
  return {
    statusCode: 200,
    durationMs,
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    mode: input.mode,
    cursorPresent: input.cursor !== null,
    limit: input.limit,
    entriesCount: result.entries.length,
    appliedEntriesCount: null,
    hasMore: result.hasMore,
    nextCursorPresent: result.nextCursor !== null,
    bootstrapHotChangeId: result.bootstrapHotChangeId,
    remoteIsEmpty: result.remoteIsEmpty,
  };
}

export function buildSyncBootstrapPushDetails(
  input: Extract<SyncBootstrapInput, Readonly<{ mode: "push" }>>,
  result: SyncBootstrapPushResult,
  durationMs: number,
): SyncBootstrapDetails {
  return {
    statusCode: 200,
    durationMs,
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    mode: input.mode,
    cursorPresent: null,
    limit: null,
    entriesCount: input.entries.length,
    appliedEntriesCount: result.appliedEntriesCount,
    hasMore: null,
    nextCursorPresent: null,
    bootstrapHotChangeId: result.bootstrapHotChangeId,
    remoteIsEmpty: null,
  };
}

export function buildSyncBootstrapDetails(
  input: SyncBootstrapInput,
  result: SyncBootstrapPullResult | SyncBootstrapPushResult,
  durationMs: number,
): SyncBootstrapDetails {
  if (input.mode === "pull" && result.mode === "pull") {
    return buildSyncBootstrapPullDetails(input, result, durationMs);
  }

  if (input.mode === "push" && result.mode === "push") {
    return buildSyncBootstrapPushDetails(input, result, durationMs);
  }

  throw new Error(`Sync bootstrap result mode mismatch: input=${input.mode} result=${result.mode}`);
}

export function getSyncBootstrapFailureInputDetails(
  input: SyncBootstrapInput,
  durationMs: number,
): Omit<SyncBootstrapDetails, "statusCode"> {
  return {
    durationMs,
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    mode: input.mode,
    cursorPresent: input.mode === "pull" ? input.cursor !== null : null,
    limit: input.mode === "pull" ? input.limit : null,
    entriesCount: input.mode === "push" ? input.entries.length : null,
    appliedEntriesCount: null,
    hasMore: null,
    nextCursorPresent: null,
    bootstrapHotChangeId: null,
    remoteIsEmpty: null,
  };
}
