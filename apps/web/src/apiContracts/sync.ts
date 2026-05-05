import type {
  ReviewEvent,
  SyncBootstrapEntry,
  SyncBootstrapPullResult,
  SyncBootstrapPushResult,
  SyncChange,
  SyncPullResult,
  SyncPushResult,
  SyncReviewHistoryImportResult,
  SyncReviewHistoryPullResult,
} from "../types";
import {
  joinPath,
  parseArray,
  parseBoolean,
  parseEnum,
  parseLiteral,
  parseNullableNumber,
  parseNullableString,
  parseNumber,
  parseObject,
  parseRequiredField,
  parseString,
} from "./core";
import {
  parseCard,
  parseDeck,
  parseReviewEvent,
  parseWorkspaceSchedulerSettings,
} from "./studyData";

function parseSyncBootstrapEntityType(
  value: unknown,
  endpoint: string,
  path: string,
): "card" | "deck" | "workspace_scheduler_settings" {
  return parseEnum(value, endpoint, path, ["card", "deck", "workspace_scheduler_settings"]);
}

function parseSyncBootstrapEntry(value: unknown, endpoint: string, path: string): SyncBootstrapEntry {
  const objectValue = parseObject(value, endpoint, path);
  const entityType = parseRequiredField(objectValue, "entityType", endpoint, path, parseSyncBootstrapEntityType);
  const action = parseLiteral(
    parseRequiredField(objectValue, "action", endpoint, path, parseString),
    endpoint,
    joinPath(path, "action"),
    "upsert",
  );

  if (entityType === "card") {
    return {
      entityType,
      entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseCard),
    };
  }

  if (entityType === "deck") {
    return {
      entityType,
      entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseDeck),
    };
  }

  return {
    entityType,
    entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
    action,
    payload: parseRequiredField(objectValue, "payload", endpoint, path, parseWorkspaceSchedulerSettings),
  };
}

function parseSyncChange(value: unknown, endpoint: string, path: string): SyncChange {
  const objectValue = parseObject(value, endpoint, path);
  const entityType = parseRequiredField(objectValue, "entityType", endpoint, path, parseSyncBootstrapEntityType);
  const action = parseLiteral(
    parseRequiredField(objectValue, "action", endpoint, path, parseString),
    endpoint,
    joinPath(path, "action"),
    "upsert",
  );
  const changeId = parseRequiredField(objectValue, "changeId", endpoint, path, parseNumber);
  const entityId = parseRequiredField(objectValue, "entityId", endpoint, path, parseString);

  if (entityType === "card") {
    return {
      changeId,
      entityType,
      entityId,
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseCard),
    };
  }

  if (entityType === "deck") {
    return {
      changeId,
      entityType,
      entityId,
      action,
      payload: parseRequiredField(objectValue, "payload", endpoint, path, parseDeck),
    };
  }

  return {
    changeId,
    entityType,
    entityId,
    action,
    payload: parseRequiredField(objectValue, "payload", endpoint, path, parseWorkspaceSchedulerSettings),
  };
}

function parseSyncPushOperationResults(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<Readonly<{
  operationId: string;
  entityType: "card" | "deck" | "workspace_scheduler_settings" | "review_event";
  entityId: string;
  status: "applied" | "ignored" | "duplicate" | "rejected";
  resultingHotChangeId: number | null;
  error: string | null;
}>> {
  return parseArray(value, endpoint, path, parseSyncPushOperationResult);
}

function parseSyncPushOperationResult(
  value: unknown,
  endpoint: string,
  path: string,
): Readonly<{
  operationId: string;
  entityType: "card" | "deck" | "workspace_scheduler_settings" | "review_event";
  entityId: string;
  status: "applied" | "ignored" | "duplicate" | "rejected";
  resultingHotChangeId: number | null;
  error: string | null;
}> {
  const objectValue = parseObject(value, endpoint, path);
  return {
    operationId: parseRequiredField(objectValue, "operationId", endpoint, path, parseString),
    entityType: parseRequiredField(objectValue, "entityType", endpoint, path, parseSyncPushResultEntityType),
    entityId: parseRequiredField(objectValue, "entityId", endpoint, path, parseString),
    status: parseRequiredField(objectValue, "status", endpoint, path, parseSyncPushStatus),
    resultingHotChangeId: parseRequiredField(objectValue, "resultingHotChangeId", endpoint, path, parseNullableNumber),
    error: parseRequiredField(objectValue, "error", endpoint, path, parseNullableString),
  };
}

function parseSyncPushResultEntityType(
  value: unknown,
  endpoint: string,
  path: string,
): "card" | "deck" | "workspace_scheduler_settings" | "review_event" {
  return parseEnum(value, endpoint, path, ["card", "deck", "workspace_scheduler_settings", "review_event"]);
}

function parseSyncPushStatus(
  value: unknown,
  endpoint: string,
  path: string,
): "applied" | "ignored" | "duplicate" | "rejected" {
  return parseEnum(value, endpoint, path, ["applied", "ignored", "duplicate", "rejected"]);
}

function parseSyncChangeArray(value: unknown, endpoint: string, path: string): ReadonlyArray<SyncChange> {
  return parseArray(value, endpoint, path, parseSyncChange);
}

function parseSyncBootstrapEntryArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<SyncBootstrapEntry> {
  return parseArray(value, endpoint, path, parseSyncBootstrapEntry);
}

function parseReviewEventArray(value: unknown, endpoint: string, path: string): ReadonlyArray<ReviewEvent> {
  return parseArray(value, endpoint, path, parseReviewEvent);
}

export function parseSyncPushResultResponse(value: unknown, endpoint: string): SyncPushResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    operations: parseRequiredField(objectValue, "operations", endpoint, "", parseSyncPushOperationResults),
  };
}

export function parseSyncPullResultResponse(value: unknown, endpoint: string): SyncPullResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    changes: parseRequiredField(objectValue, "changes", endpoint, "", parseSyncChangeArray),
    nextHotChangeId: parseRequiredField(objectValue, "nextHotChangeId", endpoint, "", parseNumber),
    hasMore: parseRequiredField(objectValue, "hasMore", endpoint, "", parseBoolean),
  };
}

export function parseSyncBootstrapPullResultResponse(
  value: unknown,
  endpoint: string,
): SyncBootstrapPullResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    mode: parseLiteral(parseRequiredField(objectValue, "mode", endpoint, "", parseString), endpoint, "mode", "pull"),
    entries: parseRequiredField(objectValue, "entries", endpoint, "", parseSyncBootstrapEntryArray),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
    hasMore: parseRequiredField(objectValue, "hasMore", endpoint, "", parseBoolean),
    bootstrapHotChangeId: parseRequiredField(objectValue, "bootstrapHotChangeId", endpoint, "", parseNumber),
    remoteIsEmpty: parseRequiredField(objectValue, "remoteIsEmpty", endpoint, "", parseBoolean),
  };
}

export function parseSyncBootstrapPushResultResponse(
  value: unknown,
  endpoint: string,
): SyncBootstrapPushResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    mode: parseLiteral(parseRequiredField(objectValue, "mode", endpoint, "", parseString), endpoint, "mode", "push"),
    appliedEntriesCount: parseRequiredField(objectValue, "appliedEntriesCount", endpoint, "", parseNumber),
    bootstrapHotChangeId: parseRequiredField(objectValue, "bootstrapHotChangeId", endpoint, "", parseNumber),
  };
}

export function parseSyncReviewHistoryPullResultResponse(
  value: unknown,
  endpoint: string,
): SyncReviewHistoryPullResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    reviewEvents: parseRequiredField(objectValue, "reviewEvents", endpoint, "", parseReviewEventArray),
    nextReviewSequenceId: parseRequiredField(objectValue, "nextReviewSequenceId", endpoint, "", parseNumber),
    hasMore: parseRequiredField(objectValue, "hasMore", endpoint, "", parseBoolean),
  };
}

export function parseSyncReviewHistoryImportResultResponse(
  value: unknown,
  endpoint: string,
): SyncReviewHistoryImportResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    importedCount: parseRequiredField(objectValue, "importedCount", endpoint, "", parseNumber),
    duplicateCount: parseRequiredField(objectValue, "duplicateCount", endpoint, "", parseNumber),
    nextReviewSequenceId: parseRequiredField(objectValue, "nextReviewSequenceId", endpoint, "", parseNumber),
  };
}
