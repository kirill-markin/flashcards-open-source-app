package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.PersistedOutboxEntry
import com.flashcardsopensourceapp.data.local.model.ReviewEventSyncPayload
import com.flashcardsopensourceapp.data.local.model.SyncAction
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import java.util.UUID

private const val outboxBatchLimit: Int = 200

internal class SyncOutboxLocalStore(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore
) {
    suspend fun enqueueCardUpsert(card: CardEntity, tags: List<String>) {
        insertOutboxEntry(
            workspaceId = card.workspaceId,
            entityType = SyncEntityType.CARD,
            entityId = card.cardId,
            action = SyncAction.UPSERT,
            clientUpdatedAtIso = formatIsoTimestamp(card.updatedAtMillis),
            payloadJson = buildCardOutboxPayloadJson(card = card, tags = tags).toString()
        )
    }

    suspend fun enqueueDeckUpsert(deck: DeckEntity) {
        insertOutboxEntry(
            workspaceId = deck.workspaceId,
            entityType = SyncEntityType.DECK,
            entityId = deck.deckId,
            action = SyncAction.UPSERT,
            clientUpdatedAtIso = formatIsoTimestamp(deck.updatedAtMillis),
            payloadJson = buildDeckOutboxPayloadJson(deck = deck).toString()
        )
    }

    suspend fun enqueueWorkspaceSchedulerSettingsUpsert(settings: WorkspaceSchedulerSettingsEntity) {
        insertOutboxEntry(
            workspaceId = settings.workspaceId,
            entityType = SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS,
            entityId = settings.workspaceId,
            action = SyncAction.UPSERT,
            clientUpdatedAtIso = formatIsoTimestamp(settings.updatedAtMillis),
            payloadJson = buildWorkspaceSchedulerSettingsOutboxPayloadJson(settings = settings).toString()
        )
    }

    suspend fun enqueueReviewEventAppend(reviewLog: ReviewLogEntity) {
        insertOutboxEntry(
            workspaceId = reviewLog.workspaceId,
            entityType = SyncEntityType.REVIEW_EVENT,
            entityId = reviewLog.reviewLogId,
            action = SyncAction.APPEND,
            clientUpdatedAtIso = formatIsoTimestamp(reviewLog.reviewedAtMillis),
            payloadJson = buildReviewEventOutboxPayloadJson(reviewLog = reviewLog).toString()
        )
    }

    suspend fun loadOutboxEntries(workspaceId: String): List<PersistedOutboxEntry> {
        return database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = outboxBatchLimit).map { entry ->
            PersistedOutboxEntry(
                operationId = entry.outboxEntryId,
                workspaceId = entry.workspaceId,
                createdAtMillis = entry.createdAtMillis,
                attemptCount = entry.attemptCount,
                lastError = entry.lastError.orEmpty(),
                operation = decodeOutboxOperation(entry = entry)
            )
        }
    }

    suspend fun loadPendingReviewEventPayloads(workspaceId: String): List<ReviewEventSyncPayload> {
        return database.outboxDao().loadPendingReviewEventOutboxEntries(workspaceId = workspaceId).map { entry ->
            val operation = decodeOutboxOperation(entry = entry)
            val payload = operation.payload
            require(payload is SyncOperationPayload.ReviewEvent) {
                "Pending review-event outbox entry '${entry.outboxEntryId}' has unexpected payload '${payload::class.java.simpleName}'."
            }
            payload.payload
        }
    }

    suspend fun deleteOutboxEntries(operationIds: List<String>) {
        if (operationIds.isEmpty()) {
            return
        }
        database.outboxDao().deleteOutboxEntries(operationIds = operationIds)
    }

    suspend fun markOutboxEntriesFailed(operationIds: List<String>, errorMessage: String) {
        if (operationIds.isEmpty()) {
            return
        }
        database.outboxDao().markOutboxEntriesFailed(operationIds = operationIds, errorMessage = errorMessage)
    }

    suspend fun countOutboxEntries(workspaceId: String): Int {
        return database.outboxDao().countOutboxEntriesForWorkspace(workspaceId = workspaceId)
    }

    suspend fun loadPendingLocalHotEntityKeysInTransaction(workspaceId: String): Set<PendingLocalHotEntityKey> {
        return database.outboxDao()
            .loadAllOutboxEntries(workspaceId = workspaceId)
            .mapNotNull(::pendingLocalHotEntityKey)
            .toSet()
    }

    private suspend fun insertOutboxEntry(
        workspaceId: String,
        entityType: SyncEntityType,
        entityId: String,
        action: SyncAction,
        clientUpdatedAtIso: String,
        payloadJson: String
    ) {
        preferencesStore.runWithLocalOutboxWritesAllowed {
            database.outboxDao().insertOutboxEntry(
                OutboxEntryEntity(
                    outboxEntryId = UUID.randomUUID().toString(),
                    workspaceId = workspaceId,
                    installationId = preferencesStore.currentCloudSettings().installationId,
                    entityType = entityType.toRemoteValue(),
                    entityId = entityId,
                    operationType = action.toRemoteValue(),
                    payloadJson = payloadJson,
                    clientUpdatedAtIso = clientUpdatedAtIso,
                    createdAtMillis = System.currentTimeMillis(),
                    attemptCount = 0,
                    lastError = null
                )
            )
        }
    }
}

private fun pendingLocalHotEntityKey(entry: OutboxEntryEntity): PendingLocalHotEntityKey? {
    return parseSyncEntityType(entry.entityType).toPendingLocalHotEntityKey(entityId = entry.entityId)
}
