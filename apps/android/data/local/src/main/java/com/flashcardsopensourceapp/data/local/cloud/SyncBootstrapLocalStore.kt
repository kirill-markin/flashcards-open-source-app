package com.flashcardsopensourceapp.data.local.cloud

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import java.util.UUID

internal data class PendingLocalHotEntityKey(
    val entityType: SyncEntityType,
    val entityId: String
)

internal data class BootstrapApplyResult(
    val skippedHotRows: Boolean,
    val appliedHotEntityKeys: Set<PendingLocalHotEntityKey>
)

internal class SyncBootstrapLocalStore(
    private val database: AppDatabase,
    private val outboxLocalStore: SyncOutboxLocalStore,
    private val hotStateLocalStore: SyncHotStateLocalStore
) {
    suspend fun buildBootstrapEntries(workspaceId: String): JSONArray {
        val entries = JSONArray()
        database.cardDao().observeCardsWithRelations().first()
            .map(::toCardSummary)
            .filter { card -> card.workspaceId == workspaceId }
            .forEach { card ->
                entries.put(
                    buildCardBootstrapEntryJson(
                        card = card,
                        lastOperationId = UUID.randomUUID().toString()
                    )
                )
            }

        database.deckDao().observeDecks().first()
            .filter { deck -> deck.workspaceId == workspaceId && deck.deletedAtMillis == null }
            .forEach { deck ->
                entries.put(
                    buildDeckBootstrapEntryJson(
                        deck = deck,
                        lastOperationId = UUID.randomUUID().toString()
                    )
                )
            }

        val settings = database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(workspaceId = workspaceId)
        if (settings != null) {
            entries.put(
                buildWorkspaceSchedulerSettingsBootstrapEntryJson(
                    workspaceId = workspaceId,
                    settings = settings,
                    lastOperationId = UUID.randomUUID().toString()
                )
            )
        }

        return entries
    }

    suspend fun buildReviewHistoryImportEvents(workspaceId: String): JSONArray {
        return JSONArray().apply {
            database.reviewLogDao().loadReviewLogs()
                .filter { reviewLog -> reviewLog.workspaceId == workspaceId }
                .forEach { reviewLog ->
                    put(buildReviewHistoryImportEventJson(reviewLog = reviewLog))
                }
        }
    }

    suspend fun applyBootstrapEntries(workspaceId: String, entries: List<RemoteBootstrapEntry>): BootstrapApplyResult {
        return database.withTransaction {
            val pendingLocalHotEntityKeys: Set<PendingLocalHotEntityKey> =
                outboxLocalStore.loadPendingLocalHotEntityKeysInTransaction(workspaceId = workspaceId)
            val appliedHotEntityKeys: MutableSet<PendingLocalHotEntityKey> = mutableSetOf()
            var skippedHotRows = false
            entries.forEachIndexed { index, entry ->
                val entryHotEntityKey: PendingLocalHotEntityKey? = entry.toPendingLocalHotEntityKey()
                if (entryHotEntityKey != null && entryHotEntityKey in pendingLocalHotEntityKeys) {
                    // Pending outbox rows are the local source of truth until the push phase drains them.
                    skippedHotRows = true
                    return@forEachIndexed
                }
                hotStateLocalStore.applyHotPayloadInTransaction(
                    workspaceId = workspaceId,
                    entityType = entry.entityType,
                    payload = entry.payload,
                    fieldPath = "bootstrap.entries[$index].payload"
                )
                if (entryHotEntityKey != null) {
                    appliedHotEntityKeys += entryHotEntityKey
                }
            }
            BootstrapApplyResult(
                skippedHotRows = skippedHotRows,
                appliedHotEntityKeys = appliedHotEntityKeys
            )
        }
    }

    suspend fun hasPendingLocalHotRowsForAppliedBootstrapKeys(
        workspaceId: String,
        appliedHotEntityKeys: Set<PendingLocalHotEntityKey>
    ): Boolean {
        if (appliedHotEntityKeys.isEmpty()) {
            return false
        }

        return database.withTransaction {
            outboxLocalStore.loadPendingLocalHotEntityKeysInTransaction(workspaceId = workspaceId)
                .any { pendingHotEntityKey -> pendingHotEntityKey in appliedHotEntityKeys }
        }
    }
}

private fun RemoteBootstrapEntry.toPendingLocalHotEntityKey(): PendingLocalHotEntityKey? {
    return entityType.toPendingLocalHotEntityKey(entityId = entityId)
}

internal fun SyncEntityType.toPendingLocalHotEntityKey(entityId: String): PendingLocalHotEntityKey? {
    return when (this) {
        SyncEntityType.CARD,
        SyncEntityType.DECK,
        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> PendingLocalHotEntityKey(
            entityType = this,
            entityId = entityId
        )

        SyncEntityType.REVIEW_EVENT -> null
    }
}
