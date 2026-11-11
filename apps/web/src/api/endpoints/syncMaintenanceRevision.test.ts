// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import { defaultWorkspaceSchedulerConfig } from "../../../../backend/src/scheduling/workspaceConfig";
import {
  createCardLocally,
  deleteCardLocally,
  submitReviewLocally,
  updateCardLocally,
} from "../../appData/sync/local/syncLocalMutations";
import { pullHotChanges } from "../../appData/sync/remote/pullHotChanges";
import { pushOutbox } from "../../appData/sync/remote/pushOutbox";
import type { WorkspaceRemoteSyncInput } from "../../appData/sync/remote/types";
import { loadCardById, putCard } from "../../localDb/cards/cards";
import { putWorkspaceSettings } from "../../localDb/cards/workspace";
import { clearWebSyncCache } from "../../localDb/core/cache";
import { makeCard, workspaceId } from "../../localDb/core/testSupport";
import { putCloudSettings } from "../../localDb/sync/cloudSettings";
import { listOutboxRecords } from "../../localDb/sync/outbox";
import type { SyncPushOperation } from "../../types";
import { primeSessionCsrfToken } from "../transport/transport";

it("roundtrips a pulled card revision through local writes while preserving a previously queued snapshot", async () => {
  await clearWebSyncCache();
  primeSessionCsrfToken("csrf-token-1");
  const cardId = "maintenance-card";
  const installationId = "device-1";
  const userId = "user-1";
  const createdAt = "2026-03-10T09:00:00.000Z";
  const signal = new AbortController().signal;
  const remoteInput: WorkspaceRemoteSyncInput = {
    workspaceId,
    installationId,
    userId,
    syncRunId: "sync-run-1",
    signal,
    hasFailed: () => false,
    indexedDbOpenRecoveryState: {
      hasFailed: () => false,
      isFailed: false,
      markFailed: () => "not_recovery",
      signal,
      throwIfFailed: () => {},
    },
    isOnlyWorkspaceForUser: true,
    requireWorkspaceSyncNotDiscarded: () => {},
    publishWorkspaceSettings: () => {},
    refreshWorkspaceView: async () => {},
  };
  const recoveryState = remoteInput.indexedDbOpenRecoveryState;
  await putCloudSettings({
    installationId,
    cloudState: "linked",
    linkedUserId: userId,
    linkedWorkspaceId: workspaceId,
    linkedEmail: null,
    onboardingCompleted: true,
    updatedAt: createdAt,
  });
  await putWorkspaceSettings(workspaceId, {
    ...defaultWorkspaceSchedulerConfig,
    clientUpdatedAt: createdAt,
    lastModifiedByReplicaId: installationId,
    lastOperationId: "initial-settings",
    updatedAt: createdAt,
  });
  const original = makeCard({
    cardId,
    frontText: "Question",
    backText: "Answer",
    tags: ["keep", "removed"],
    dueAt: null,
    createdAt,
  });
  await putCard(workspaceId, original);
  const stale = await updateCardLocally({
    workspaceId,
    cardId,
    input: { frontText: "Queued edit" },
    clientUpdatedAt: "2026-03-10T10:00:00.000Z",
  }, recoveryState);

  const maintenanceRevision = Number.MAX_SAFE_INTEGER;
  const maintainedAt = "2026-03-10T11:00:00.000Z";
  const maintained = {
    ...original,
    metadata: { ...original.metadata, maintenanceRevision },
    tags: ["keep"],
    clientUpdatedAt: maintainedAt,
    lastModifiedByReplicaId: "maintenance-replica",
    lastOperationId: "maintenance-operation",
    updatedAt: maintainedAt,
  };
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
    changes: [{ changeId: 1, entityType: "card", entityId: cardId, action: "upsert", payload: maintained }],
    nextHotChangeId: 1,
    hasMore: false,
  }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);

  const pull = await pullHotChanges(remoteInput);
  expect(pull.didApplyRemoteChanges).toBe(true);
  expect(await loadCardById(workspaceId, cardId)).toEqual(maintained);
  const rebased = await updateCardLocally({
    workspaceId,
    cardId,
    input: { frontText: "Saved draft", tagEdit: { baseline: original.tags, draft: [...original.tags, "local"] } },
    clientUpdatedAt: "2026-03-10T12:00:00.000Z",
  }, recoveryState);
  const readded = await updateCardLocally({
    workspaceId,
    cardId,
    input: { tagEdit: { baseline: rebased.card.tags, draft: [...rebased.card.tags, "removed"] } },
    clientUpdatedAt: "2026-03-10T13:00:00.000Z",
  }, recoveryState);
  const reviewed = await submitReviewLocally({
    workspaceId,
    cardId,
    rating: 2,
    reviewedAtClient: "2026-03-10T14:00:00.000Z",
    reviewedTimeZone: "Europe/Madrid",
  }, recoveryState);
  const deleted = await deleteCardLocally({
    workspaceId,
    cardId,
    clientUpdatedAt: "2026-03-10T15:00:00.000Z",
  }, recoveryState);
  const created = await createCardLocally({
    workspaceId,
    input: { frontText: original.frontText, backText: original.backText, tags: original.tags },
    clientUpdatedAt: "2026-03-10T16:00:00.000Z",
  }, recoveryState);

  const queued = await listOutboxRecords(workspaceId);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    operations: queued.map(({ operation }) => ({
      operationId: operation.operationId,
      entityId: operation.entityId,
      entityType: operation.entityType,
      status: "applied",
      resultingHotChangeId: null,
      error: null,
    })),
  }), { headers: { "Content-Type": "application/json" } }));
  await pushOutbox(remoteInput);

  const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Readonly<{
    operations: ReadonlyArray<SyncPushOperation>;
  }>;
  const cardWrites = requestBody.operations.filter((operation) => operation.entityType === "card");
  expect(cardWrites.map((operation) => operation.operationId)).toEqual(
    [stale, rebased, readded, reviewed, deleted, created].map(({ card }) => card.lastOperationId),
  );
  expect(cardWrites[0]?.payload).toMatchObject({ frontText: "Queued edit", tags: ["keep", "removed"] });
  expect(cardWrites[0]?.payload.metadata).not.toHaveProperty("maintenanceRevision");
  expect(cardWrites[1]?.payload).toMatchObject({ frontText: "Saved draft", tags: ["keep", "local"] });
  expect(cardWrites[2]?.payload.tags).toEqual(["keep", "local", "removed"]);
  expect(cardWrites.slice(1, 5).map((operation) => operation.payload.metadata?.maintenanceRevision))
    .toEqual([maintenanceRevision, maintenanceRevision, maintenanceRevision, maintenanceRevision]);
  expect(cardWrites[5]?.payload.metadata).not.toHaveProperty("maintenanceRevision");
  expect(await listOutboxRecords(workspaceId)).toEqual([]);
});
