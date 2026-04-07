import { transactionWithWorkspaceScope, type DatabaseExecutor, type WorkspaceDatabaseScope } from "../../db";
import { mapChatItemRow, mapPersistedMessagesToStoredMessages, mapSessionRow } from "./mappers";
import {
  listChatItemRowsAfterCursorWithExecutor,
  listChatItemRowsBeforeCursorWithExecutor,
  listChatItemRowsWithExecutor,
  listLatestChatItemRowsWithExecutor,
} from "./repository";
import {
  getLatestChatSessionId,
  getLatestChatSessionIdWithExecutor,
  getChatSessionId,
  getChatSessionIdWithExecutor,
  resolveLatestOrCreateChatSessionWithExecutor,
  resolveRequestedOrCreateChatSessionWithExecutor,
} from "./sessionService";
import type {
  ChatSessionSnapshot,
  PaginatedChatMessages,
  PersistedChatMessageItem,
} from "./types";

export {
  getChatSessionId,
  getChatSessionIdWithExecutor,
  getLatestChatSessionId,
  getLatestChatSessionIdWithExecutor,
};

export const listChatMessagesWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlyArray<PersistedChatMessageItem>> => {
  const rows = await listChatItemRowsWithExecutor(executor, scope, sessionId);
  return rows.map((row) => mapChatItemRow(row));
};

export const listChatMessagesLatestWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  limit: number,
): Promise<PaginatedChatMessages> => {
  const rows = await listLatestChatItemRowsWithExecutor(executor, scope, sessionId, limit + 1);
  const hasOlder = rows.length > limit;
  const windowRows = hasOlder ? rows.slice(0, limit) : rows;
  const messages = windowRows.map((row) => mapChatItemRow(row)).reverse();
  return {
    messages,
    hasOlder,
    oldestCursor: messages.length > 0 ? String(messages[0]!.itemOrder) : null,
    newestCursor: messages.length > 0 ? String(messages[messages.length - 1]!.itemOrder) : null,
  };
};

export const listChatMessagesBeforeWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  beforeCursor: number,
  limit: number,
): Promise<PaginatedChatMessages> => {
  const rows = await listChatItemRowsBeforeCursorWithExecutor(
    executor,
    scope,
    sessionId,
    beforeCursor,
    limit + 1,
  );
  const hasOlder = rows.length > limit;
  const windowRows = hasOlder ? rows.slice(0, limit) : rows;
  const messages = windowRows.map((row) => mapChatItemRow(row)).reverse();
  return {
    messages,
    hasOlder,
    oldestCursor: messages.length > 0 ? String(messages[0]!.itemOrder) : null,
    newestCursor: messages.length > 0 ? String(messages[messages.length - 1]!.itemOrder) : null,
  };
};

export const listChatMessagesAfterCursorWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  afterCursor: number,
): Promise<ReadonlyArray<PersistedChatMessageItem>> => {
  const rows = await listChatItemRowsAfterCursorWithExecutor(executor, scope, sessionId, afterCursor);
  return rows.map((row) => mapChatItemRow(row));
};

export const getChatSessionSnapshotWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string | undefined,
): Promise<ChatSessionSnapshot> => {
  const sessionRow = sessionId === undefined
    ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
    : await resolveRequestedOrCreateChatSessionWithExecutor(executor, scope, sessionId);
  const rows = await listChatItemRowsWithExecutor(executor, scope, sessionRow.session_id);
  const messages = rows.map((row) => mapChatItemRow(row));

  return {
    ...mapSessionRow(sessionRow),
    messages: mapPersistedMessagesToStoredMessages(messages),
  };
};

export const listChatMessages = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesWithExecutor(executor, { userId, workspaceId }, sessionId));

export const listChatMessagesLatest = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  limit: number,
): Promise<PaginatedChatMessages> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesLatestWithExecutor(executor, { userId, workspaceId }, sessionId, limit));

export const listChatMessagesBefore = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  beforeCursor: number,
  limit: number,
): Promise<PaginatedChatMessages> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesBeforeWithExecutor(executor, { userId, workspaceId }, sessionId, beforeCursor, limit));

export const listChatMessagesAfterCursor = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  afterCursor: number,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesAfterCursorWithExecutor(executor, { userId, workspaceId }, sessionId, afterCursor));

export const getChatSessionSnapshot = async (
  userId: string,
  workspaceId: string,
  sessionId: string | undefined,
): Promise<ChatSessionSnapshot> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    getChatSessionSnapshotWithExecutor(executor, { userId, workspaceId }, sessionId));
