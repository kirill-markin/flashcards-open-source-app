package com.flashcardsopensourceapp.data.local.cloud

import android.util.Log
import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.CardSyncPayload
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSyncPayload
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.PersistedOutboxEntry
import com.flashcardsopensourceapp.data.local.model.ReviewEventSyncPayload
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.SyncAction
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncOperation
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettingsSyncPayload
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.decodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.model.parseIsoTimestamp
import com.flashcardsopensourceapp.data.local.repository.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/*
 Keep Android bootstrap and sync application aligned with:
 - apps/ios/Flashcards/Flashcards/CloudSync/CloudSyncRunner.swift
 - apps/ios/Flashcards/Flashcards/LocalDatabase+Sync.swift
 */

private const val outboxBatchLimit: Int = 200
private const val cloudMigrationLogTag: String = "FlashcardsCloudMigration"

data class ReviewHistoryChangedEvent(
    val workspaceIds: Set<String>,
    val latestReviewedAtMillis: Long?
)

private data class PendingReviewHistoryChangedEvent(
    val eventId: Long,
    val event: ReviewHistoryChangedEvent
)

private data class WorkspaceForkSnapshot(
    val cards: List<CardEntity>,
    val decks: List<DeckEntity>,
    val tags: List<TagEntity>,
    val cardTags: List<CardTagEntity>,
    val reviewLogs: List<ReviewLogEntity>,
    val outboxEntries: List<OutboxEntryEntity>,
    val schedulerSettings: WorkspaceSchedulerSettingsEntity?
)

private data class WorkspaceForkIdMappings(
    val cardIdsBySourceId: Map<String, String>,
    val deckIdsBySourceId: Map<String, String>,
    val reviewEventIdsBySourceId: Map<String, String>
)

internal data class PendingLocalHotEntityKey(
    val entityType: SyncEntityType,
    val entityId: String
)

internal data class BootstrapApplyResult(
    val skippedHotRows: Boolean,
    val appliedHotEntityKeys: Set<PendingLocalHotEntityKey>
)

class SyncLocalStore(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val localProgressCacheStore: LocalProgressCacheStore
) {
    private val reviewHistoryChangedEvents = MutableStateFlow<PendingReviewHistoryChangedEvent?>(value = null)
    private var isReviewHistoryChangeBatchActive: Boolean = false
    private var pendingReviewHistoryChangedEvent: ReviewHistoryChangedEvent? = null
    private var nextReviewHistoryChangedEventId: Long = 0L

    fun observeReviewHistoryChangedEvents(): Flow<ReviewHistoryChangedEvent> {
        return reviewHistoryChangedEvents
            .filterNotNull()
            .map { pendingEvent -> pendingEvent.event }
    }

    fun beginReviewHistoryChangeBatch() {
        check(isReviewHistoryChangeBatchActive.not()) {
            "Review history change batch is already active."
        }
        isReviewHistoryChangeBatchActive = true
        pendingReviewHistoryChangedEvent = null
    }

    fun flushReviewHistoryChangeBatch() {
        check(isReviewHistoryChangeBatchActive) {
            "Review history change batch is not active."
        }
        isReviewHistoryChangeBatchActive = false
        val event = pendingReviewHistoryChangedEvent
        pendingReviewHistoryChangedEvent = null
        if (event != null) {
            publishReviewHistoryChangedEvent(event = event)
        }
    }

    fun discardReviewHistoryChangeBatch() {
        check(isReviewHistoryChangeBatchActive) {
            "Review history change batch is not active."
        }
        isReviewHistoryChangeBatchActive = false
        pendingReviewHistoryChangedEvent = null
    }

    suspend fun enqueueCardUpsert(card: CardEntity, tags: List<String>) {
        val payloadJson = JSONObject()
            .put("cardId", card.cardId)
            .put("frontText", card.frontText)
            .put("backText", card.backText)
            .put("tags", JSONArray(tags))
            .put("effortLevel", card.effortLevel.name.lowercase())
            .putNullableString("dueAt", card.dueAtMillis?.let(::formatIsoTimestamp))
            .put("createdAt", formatIsoTimestamp(card.createdAtMillis))
            .put("reps", card.reps)
            .put("lapses", card.lapses)
            .put("fsrsCardState", card.fsrsCardState.name.lowercase())
            .putNullableInt("fsrsStepIndex", card.fsrsStepIndex)
            .putNullableDouble("fsrsStability", card.fsrsStability)
            .putNullableDouble("fsrsDifficulty", card.fsrsDifficulty)
            .putNullableString("fsrsLastReviewedAt", card.fsrsLastReviewedAtMillis?.let(::formatIsoTimestamp))
            .putNullableInt("fsrsScheduledDays", card.fsrsScheduledDays)
            .putNullableString("deletedAt", card.deletedAtMillis?.let(::formatIsoTimestamp))

        insertOutboxEntry(
            workspaceId = card.workspaceId,
            entityType = SyncEntityType.CARD,
            entityId = card.cardId,
            action = SyncAction.UPSERT,
            clientUpdatedAtIso = formatIsoTimestamp(card.updatedAtMillis),
            payloadJson = payloadJson.toString()
        )
    }

    suspend fun enqueueDeckUpsert(deck: DeckEntity) {
        val payloadJson = JSONObject()
            .put("deckId", deck.deckId)
            .put("name", deck.name)
            .put("filterDefinition", JSONObject(deck.filterDefinitionJson))
            .put("createdAt", formatIsoTimestamp(deck.createdAtMillis))
            .putNullableString("deletedAt", deck.deletedAtMillis?.let(::formatIsoTimestamp))

        insertOutboxEntry(
            workspaceId = deck.workspaceId,
            entityType = SyncEntityType.DECK,
            entityId = deck.deckId,
            action = SyncAction.UPSERT,
            clientUpdatedAtIso = formatIsoTimestamp(deck.updatedAtMillis),
            payloadJson = payloadJson.toString()
        )
    }

    suspend fun enqueueWorkspaceSchedulerSettingsUpsert(settings: WorkspaceSchedulerSettingsEntity) {
        val payloadJson = JSONObject()
            .put("algorithm", settings.algorithm)
            .put("desiredRetention", settings.desiredRetention)
            .put("learningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.learningStepsMinutesJson)))
            .put("relearningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.relearningStepsMinutesJson)))
            .put("maximumIntervalDays", settings.maximumIntervalDays)
            .put("enableFuzz", settings.enableFuzz)

        insertOutboxEntry(
            workspaceId = settings.workspaceId,
            entityType = SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS,
            entityId = settings.workspaceId,
            action = SyncAction.UPSERT,
            clientUpdatedAtIso = formatIsoTimestamp(settings.updatedAtMillis),
            payloadJson = payloadJson.toString()
        )
    }

    suspend fun enqueueReviewEventAppend(reviewLog: ReviewLogEntity) {
        val payloadJson = JSONObject()
            .put("reviewEventId", reviewLog.reviewLogId)
            .put("cardId", reviewLog.cardId)
            .put("clientEventId", reviewLog.clientEventId)
            .put("rating", reviewLog.rating.ordinal)
            .put("reviewedAtClient", formatIsoTimestamp(reviewLog.reviewedAtMillis))

        insertOutboxEntry(
            workspaceId = reviewLog.workspaceId,
            entityType = SyncEntityType.REVIEW_EVENT,
            entityId = reviewLog.reviewLogId,
            action = SyncAction.APPEND,
            clientUpdatedAtIso = formatIsoTimestamp(reviewLog.reviewedAtMillis),
            payloadJson = payloadJson.toString()
        )
    }

    suspend fun loadOutboxEntries(workspaceId: String, limit: Int = outboxBatchLimit): List<PersistedOutboxEntry> {
        return database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = limit).map { entry ->
            PersistedOutboxEntry(
                operationId = entry.outboxEntryId,
                workspaceId = entry.workspaceId,
                createdAtMillis = entry.createdAtMillis,
                attemptCount = entry.attemptCount,
                lastError = entry.lastError.orEmpty(),
                operation = decodeOutboxOperation(entry)
            )
        }
    }

    suspend fun loadPendingReviewEventPayloads(workspaceId: String): List<ReviewEventSyncPayload> {
        return database.outboxDao().loadPendingReviewEventOutboxEntries(workspaceId = workspaceId).map { entry ->
            val operation = decodeOutboxOperation(entry)
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
        database.outboxDao().deleteOutboxEntries(operationIds)
    }

    suspend fun markOutboxEntriesFailed(operationIds: List<String>, errorMessage: String) {
        if (operationIds.isEmpty()) {
            return
        }
        database.outboxDao().markOutboxEntriesFailed(operationIds, errorMessage)
    }

    suspend fun countOutboxEntries(workspaceId: String): Int {
        return database.outboxDao().countOutboxEntriesForWorkspace(workspaceId = workspaceId)
    }

    suspend fun ensureSyncState(workspaceId: String): SyncStateEntity {
        val existingSyncState = database.syncStateDao().loadSyncState(workspaceId = workspaceId)
        if (existingSyncState != null) {
            return existingSyncState
        }

        val syncState = SyncStateEntity(
            workspaceId = workspaceId,
            lastSyncCursor = null,
            lastReviewSequenceId = 0L,
            hasHydratedHotState = false,
            hasHydratedReviewHistory = false,
            pendingReviewHistoryImport = false,
            lastSyncAttemptAtMillis = null,
            lastSuccessfulSyncAtMillis = null,
            lastSyncError = null,
            blockedInstallationId = null
        )
        database.syncStateDao().insertSyncState(syncState)
        return syncState
    }

    suspend fun loadBlockedSyncMessage(workspaceId: String, installationId: String): String? {
        val syncState = database.syncStateDao().loadSyncState(workspaceId = workspaceId) ?: return null
        if (syncState.blockedInstallationId != installationId) {
            return null
        }

        return syncState.lastSyncError ?: "Cloud sync is blocked for this installation."
    }

    suspend fun recordSyncAttempt(workspaceId: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState.copy(
                lastSyncAttemptAtMillis = System.currentTimeMillis(),
                lastSyncError = null
            )
        )
    }

    suspend fun markSyncFailure(workspaceId: String, errorMessage: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState.copy(
                lastSyncAttemptAtMillis = System.currentTimeMillis(),
                lastSyncError = errorMessage,
                blockedInstallationId = null
            )
        )
    }

    suspend fun markSyncBlocked(
        workspaceId: String,
        installationId: String,
        errorMessage: String
    ) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState.copy(
                lastSyncAttemptAtMillis = System.currentTimeMillis(),
                lastSyncError = errorMessage,
                blockedInstallationId = installationId
            )
        )
    }

    suspend fun markReviewHistoryImportPending(workspaceId: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState.copy(
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = true
            )
        )
    }

    suspend fun markReviewHistoryImportComplete(workspaceId: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState.copy(pendingReviewHistoryImport = false)
        )
    }

    suspend fun markSyncSuccess(
        workspaceId: String,
        lastSyncCursor: String,
        lastReviewSequenceId: Long,
        hasHydratedHotState: Boolean,
        hasHydratedReviewHistory: Boolean
    ) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        val nowMillis = System.currentTimeMillis()
        database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = lastSyncCursor,
                lastReviewSequenceId = lastReviewSequenceId,
                hasHydratedHotState = hasHydratedHotState,
                hasHydratedReviewHistory = hasHydratedReviewHistory,
                pendingReviewHistoryImport = syncState.pendingReviewHistoryImport,
                lastSyncAttemptAtMillis = nowMillis,
                lastSuccessfulSyncAtMillis = nowMillis,
                lastSyncError = null,
                blockedInstallationId = null
            )
        )
    }

    suspend fun reidentifyWorkspaceForkConflictEntity(
        workspaceId: String,
        entityType: SyncEntityType,
        entityId: String
    ): String {
        return database.withTransaction {
            when (entityType) {
                SyncEntityType.CARD -> reidentifyCardWorkspaceForkConflictInTransaction(
                    workspaceId = workspaceId,
                    cardId = entityId
                )

                SyncEntityType.DECK -> reidentifyDeckWorkspaceForkConflictInTransaction(
                    workspaceId = workspaceId,
                    deckId = entityId
                )

                SyncEntityType.REVIEW_EVENT -> reidentifyReviewEventWorkspaceForkConflictInTransaction(
                    workspaceId = workspaceId,
                    reviewEventId = entityId
                )

                SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> throw IllegalArgumentException(
                    "Cannot recover workspace fork conflict for unsupported entity type " +
                        "'${entityType.toRemoteValue()}' in workspace '$workspaceId'."
                )
            }
        }
    }

    suspend fun forkWorkspaceIdentity(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ): WorkspaceEntity {
        val destinationWorkspace = requireNotNull(
            database.workspaceDao().loadWorkspaceById(destinationWorkspaceId)
        ) {
            "Cannot fork workspace identity because local workspace '$destinationWorkspaceId' does not exist."
        }
        return forkWorkspaceIdentity(
            currentLocalWorkspaceId = currentLocalWorkspaceId,
            sourceWorkspaceId = sourceWorkspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = destinationWorkspace.workspaceId,
                name = destinationWorkspace.name,
                createdAtMillis = destinationWorkspace.createdAtMillis,
                isSelected = true
            )
        )
    }

    suspend fun forkWorkspaceIdentity(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspace: CloudWorkspaceSummary
    ): WorkspaceEntity {
        database.withTransaction {
            forkWorkspaceIdentityInTransaction(
                currentLocalWorkspaceId = currentLocalWorkspaceId,
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspace = destinationWorkspace
            )
        }
        return requireNotNull(
            database.workspaceDao().loadWorkspaceById(destinationWorkspace.workspaceId)
        ) {
            "Workspace identity fork did not leave local workspace '${destinationWorkspace.workspaceId}'."
        }
    }

    /**
     * Linked-workspace switching must not publish a new active workspace id
     * until Android has verified that the local shell really points at that
     * workspace. This method is the single local migration entrypoint and
     * returns the actual resulting local workspace row after the migration.
     */
    suspend fun migrateLocalShellToLinkedWorkspace(
        workspace: CloudWorkspaceSummary,
        remoteWorkspaceIsEmpty: Boolean
    ): WorkspaceEntity {
        val currentWorkspaceId = currentWorkspaceIdOrNull()
        val reusesCurrentWorkspace = currentWorkspaceId == workspace.workspaceId
        val didDeleteReviewHistory = reusesCurrentWorkspace.not() &&
            remoteWorkspaceIsEmpty.not() &&
            database.reviewLogDao().countReviewLogs() > 0
        val migrationKind = if (reusesCurrentWorkspace) {
            "reuse_local_shell"
        } else if (remoteWorkspaceIsEmpty) {
            "fork_local_data"
        } else {
            "replace_local_shell"
        }
        logLinkedWorkspaceMigration(
            outcome = "start",
            fromWorkspaceId = currentWorkspaceId,
            toWorkspaceId = workspace.workspaceId,
            remoteWorkspaceIsEmpty = remoteWorkspaceIsEmpty,
            migrationKind = migrationKind
        )
        database.withTransaction {
            if (reusesCurrentWorkspace) {
                refreshCurrentWorkspaceShellInTransaction(workspace)
            } else if (remoteWorkspaceIsEmpty) {
                val sourceWorkspaceId = requireNotNull(currentWorkspaceId) {
                    "Workspace is required before linking to cloud."
                }
                forkWorkspaceIdentityInTransaction(
                    currentLocalWorkspaceId = sourceWorkspaceId,
                    sourceWorkspaceId = sourceWorkspaceId,
                    destinationWorkspace = workspace
                )
            } else {
                replaceLocalShellForNonEmptyRemoteWorkspaceInTransaction(workspace)
            }
        }
        if (didDeleteReviewHistory && currentWorkspaceId != null) {
            publishReviewHistoryChangedEvent(
                ReviewHistoryChangedEvent(
                    workspaceIds = setOf(currentWorkspaceId),
                    latestReviewedAtMillis = null
                )
            )
        }

        val localWorkspaces = database.workspaceDao().loadWorkspaces()
        check(localWorkspaces.size == 1) {
            "Linked workspace migration must leave exactly one local workspace. " +
                "Local workspaces=${localWorkspaces.map(WorkspaceEntity::workspaceId)}"
        }
        val resultingWorkspace = requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspace.workspaceId)
        ) {
            "Linked workspace migration did not create the expected local workspace '${workspace.workspaceId}'."
        }
        logLinkedWorkspaceMigration(
            outcome = "success",
            fromWorkspaceId = currentWorkspaceId,
            toWorkspaceId = workspace.workspaceId,
            remoteWorkspaceIsEmpty = remoteWorkspaceIsEmpty,
            migrationKind = migrationKind
        )
        return resultingWorkspace
    }

    /**
     * Bound guest upgrade must reuse the existing local guest workspace as-is.
     * Refresh the workspace shell metadata, but do not rewrite identity or
     * clear any sync progress or blocked state.
     */
    suspend fun bindGuestUpgradeToLinkedWorkspace(workspace: CloudWorkspaceSummary): WorkspaceEntity {
        val currentWorkspaceId = requireNotNull(currentWorkspaceIdOrNull()) {
            "Bound guest upgrade requires a current local workspace."
        }
        check(currentWorkspaceId == workspace.workspaceId) {
            "Bound guest upgrade must preserve the existing workspace identity. " +
                "Current='$currentWorkspaceId' Remote='${workspace.workspaceId}'."
        }
        database.withTransaction {
            refreshCurrentWorkspaceShellInTransaction(workspace)
        }

        val localWorkspaces = database.workspaceDao().loadWorkspaces()
        check(localWorkspaces.size == 1) {
            "Bound guest upgrade must leave exactly one local workspace. " +
                "Local workspaces=${localWorkspaces.map(WorkspaceEntity::workspaceId)}"
        }
        return requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspace.workspaceId)
        ) {
            "Bound guest upgrade did not keep the expected local workspace '${workspace.workspaceId}'."
        }
    }

    suspend fun buildBootstrapEntries(workspaceId: String): JSONArray {
        val entries = JSONArray()
        database.cardDao().observeCardsWithRelations().first()
            .map(::toCardSummary)
            .filter { card -> card.workspaceId == workspaceId }
            .forEach { card ->
                entries.put(
                    JSONObject()
                        .put("entityType", "card")
                        .put("entityId", card.cardId)
                        .put("action", "upsert")
                        .put("payload", JSONObject().apply {
                            put("cardId", card.cardId)
                            put("frontText", card.frontText)
                            put("backText", card.backText)
                            put("tags", JSONArray(card.tags))
                            put("effortLevel", card.effortLevel.name.lowercase())
                            putNullableString("dueAt", card.dueAtMillis?.let(::formatIsoTimestamp))
                            put("createdAt", formatIsoTimestamp(card.createdAtMillis))
                            put("reps", card.reps)
                            put("lapses", card.lapses)
                            put("fsrsCardState", card.fsrsCardState.name.lowercase())
                            putNullableInt("fsrsStepIndex", card.fsrsStepIndex)
                            putNullableDouble("fsrsStability", card.fsrsStability)
                            putNullableDouble("fsrsDifficulty", card.fsrsDifficulty)
                            putNullableString("fsrsLastReviewedAt", card.fsrsLastReviewedAtMillis?.let(::formatIsoTimestamp))
                            putNullableInt("fsrsScheduledDays", card.fsrsScheduledDays)
                            put("clientUpdatedAt", formatIsoTimestamp(card.updatedAtMillis))
                            put("lastOperationId", UUID.randomUUID().toString())
                            put("updatedAt", formatIsoTimestamp(card.updatedAtMillis))
                            putNullableString("deletedAt", card.deletedAtMillis?.let(::formatIsoTimestamp))
                        })
                )
            }

        database.deckDao().observeDecks().first()
            .filter { deck -> deck.workspaceId == workspaceId && deck.deletedAtMillis == null }
            .forEach { deck ->
                entries.put(
                    JSONObject()
                        .put("entityType", "deck")
                        .put("entityId", deck.deckId)
                        .put("action", "upsert")
                        .put("payload", JSONObject().apply {
                            put("deckId", deck.deckId)
                            put("workspaceId", deck.workspaceId)
                            put("name", deck.name)
                            put("filterDefinition", JSONObject(deck.filterDefinitionJson))
                            put("createdAt", formatIsoTimestamp(deck.createdAtMillis))
                            put("clientUpdatedAt", formatIsoTimestamp(deck.updatedAtMillis))
                            put("lastOperationId", UUID.randomUUID().toString())
                            put("updatedAt", formatIsoTimestamp(deck.updatedAtMillis))
                            putNullableString("deletedAt", deck.deletedAtMillis?.let(::formatIsoTimestamp))
                        })
                )
            }

        val settings = database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(workspaceId)
        if (settings != null) {
            entries.put(
                JSONObject()
                    .put("entityType", "workspace_scheduler_settings")
                    .put("entityId", workspaceId)
                    .put("action", "upsert")
                    .put("payload", JSONObject().apply {
                        put("algorithm", settings.algorithm)
                        put("desiredRetention", settings.desiredRetention)
                        put("learningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.learningStepsMinutesJson)))
                        put("relearningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.relearningStepsMinutesJson)))
                        put("maximumIntervalDays", settings.maximumIntervalDays)
                        put("enableFuzz", settings.enableFuzz)
                        put("clientUpdatedAt", formatIsoTimestamp(settings.updatedAtMillis))
                        put("lastOperationId", UUID.randomUUID().toString())
                        put("updatedAt", formatIsoTimestamp(settings.updatedAtMillis))
                    })
            )
        }

        return entries
    }

    suspend fun buildReviewHistoryImportEvents(workspaceId: String): JSONArray {
        return JSONArray().apply {
            database.reviewLogDao().loadReviewLogs()
                .filter { reviewLog -> reviewLog.workspaceId == workspaceId }
                .forEach { reviewLog ->
                    put(
                        JSONObject()
                            .put("reviewEventId", reviewLog.reviewLogId)
                            .put("workspaceId", reviewLog.workspaceId)
                            .put("cardId", reviewLog.cardId)
                            .put("clientEventId", reviewLog.clientEventId)
                            .put("rating", reviewLog.rating.ordinal)
                            .put("reviewedAtClient", formatIsoTimestamp(reviewLog.reviewedAtMillis))
                            .put("reviewedAtServer", reviewLog.reviewedAtServerIso)
                    )
                }
        }
    }

    internal suspend fun applyBootstrapEntries(workspaceId: String, entries: List<RemoteBootstrapEntry>): BootstrapApplyResult {
        return database.withTransaction {
            val pendingLocalHotEntityKeys: Set<PendingLocalHotEntityKey> =
                loadPendingLocalHotEntityKeysInTransaction(workspaceId = workspaceId)
            val appliedHotEntityKeys: MutableSet<PendingLocalHotEntityKey> = mutableSetOf()
            var skippedHotRows = false
            entries.forEachIndexed { index, entry ->
                val entryHotEntityKey: PendingLocalHotEntityKey? = entry.toPendingLocalHotEntityKey()
                if (entryHotEntityKey != null && entryHotEntityKey in pendingLocalHotEntityKeys) {
                    // Pending outbox rows are the local source of truth until the push phase drains them.
                    skippedHotRows = true
                    return@forEachIndexed
                }
                applyHotPayload(
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

    internal suspend fun hasPendingLocalHotRowsForAppliedBootstrapKeys(
        workspaceId: String,
        appliedHotEntityKeys: Set<PendingLocalHotEntityKey>
    ): Boolean {
        if (appliedHotEntityKeys.isEmpty()) {
            return false
        }

        return database.withTransaction {
            loadPendingLocalHotEntityKeysInTransaction(workspaceId = workspaceId)
                .any { pendingHotEntityKey -> pendingHotEntityKey in appliedHotEntityKeys }
        }
    }

    suspend fun applyPullChanges(workspaceId: String, changes: List<RemoteSyncChange>) {
        database.withTransaction {
            changes.forEachIndexed { index, change ->
                applyHotPayload(
                    workspaceId = workspaceId,
                    entityType = change.entityType,
                    payload = change.payload,
                    fieldPath = "pull.changes[$index].payload"
                )
            }
        }
    }

    suspend fun applyReviewHistory(events: List<RemoteReviewHistoryEvent>) {
        if (events.isEmpty()) {
            return
        }
        val reviewLogs = events.map { event ->
            ReviewLogEntity(
                reviewLogId = event.reviewEventId,
                workspaceId = event.workspaceId,
                cardId = event.cardId,
                replicaId = event.replicaId,
                clientEventId = event.clientEventId,
                rating = ReviewRating.entries[event.rating],
                reviewedAtMillis = parseIsoTimestamp(event.reviewedAtClient),
                reviewedAtServerIso = event.reviewedAtServer
            )
        }
        var newReviewLogs: List<ReviewLogEntity> = emptyList()
        database.withTransaction {
            val existingReviewLogs = database.reviewLogDao().loadReviewLogs(
                reviewLogIds = reviewLogs.map(ReviewLogEntity::reviewLogId)
            )
            val existingReviewLogIds = existingReviewLogs.mapTo(
                destination = mutableSetOf(),
                transform = ReviewLogEntity::reviewLogId
            )
            newReviewLogs = reviewLogs.filter { reviewLog ->
                reviewLog.reviewLogId !in existingReviewLogIds
            }
            database.reviewLogDao().insertReviewLogs(reviewLogs)
            localProgressCacheStore.applyReviewHistoryInTransaction(
                reviewLogs = reviewLogs,
                existingReviewLogs = existingReviewLogs,
                updatedAtMillis = System.currentTimeMillis()
            )
        }
        if (newReviewLogs.isNotEmpty()) {
            recordReviewHistoryChangedEvent(
                event = ReviewHistoryChangedEvent(
                    workspaceIds = newReviewLogs.map(ReviewLogEntity::workspaceId).toSet(),
                    latestReviewedAtMillis = newReviewLogs.maxOf(ReviewLogEntity::reviewedAtMillis)
                )
            )
        }
    }

    private fun recordReviewHistoryChangedEvent(event: ReviewHistoryChangedEvent) {
        if (isReviewHistoryChangeBatchActive.not()) {
            publishReviewHistoryChangedEvent(event = event)
            return
        }

        pendingReviewHistoryChangedEvent = mergeReviewHistoryChangedEvents(
            existingEvent = pendingReviewHistoryChangedEvent,
            newEvent = event
        )
    }

    private fun publishReviewHistoryChangedEvent(event: ReviewHistoryChangedEvent) {
        nextReviewHistoryChangedEventId += 1L
        reviewHistoryChangedEvents.value = PendingReviewHistoryChangedEvent(
            eventId = nextReviewHistoryChangedEventId,
            event = event
        )
    }

    private fun mergeReviewHistoryChangedEvents(
        existingEvent: ReviewHistoryChangedEvent?,
        newEvent: ReviewHistoryChangedEvent
    ): ReviewHistoryChangedEvent {
        if (existingEvent == null) {
            return newEvent
        }

        return ReviewHistoryChangedEvent(
            workspaceIds = existingEvent.workspaceIds + newEvent.workspaceIds,
            latestReviewedAtMillis = listOfNotNull(
                existingEvent.latestReviewedAtMillis,
                newEvent.latestReviewedAtMillis
            ).maxOrNull()
        )
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

    private suspend fun loadPendingLocalHotEntityKeysInTransaction(workspaceId: String): Set<PendingLocalHotEntityKey> {
        return database.outboxDao()
            .loadAllOutboxEntries(workspaceId = workspaceId)
            .mapNotNull(::pendingLocalHotEntityKey)
            .toSet()
    }

    private suspend fun currentWorkspaceIdOrNull(): String? {
        return loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )?.workspaceId
    }

    private suspend fun replaceLocalShellForNonEmptyRemoteWorkspaceInTransaction(workspace: CloudWorkspaceSummary) {
        val currentLocalWorkspaceId = database.workspaceDao().loadAnyWorkspace()?.workspaceId
        if (currentLocalWorkspaceId != null) {
            database.outboxDao().deleteOutboxEntriesForWorkspace(workspaceId = currentLocalWorkspaceId)
        }
        database.reviewLogDao().deleteAllReviewLogs()
        localProgressCacheStore.clearAllInTransaction()
        database.tagDao().deleteAllCardTags()
        database.cardDao().deleteAllCards()
        database.deckDao().deleteAllDecks()
        database.tagDao().deleteAllTags()
        database.syncStateDao().deleteAllSyncState()
        database.workspaceDao().deleteAllWorkspaces()

        database.workspaceDao().insertWorkspace(
            WorkspaceEntity(
                workspaceId = workspace.workspaceId,
                name = workspace.name,
                createdAtMillis = workspace.createdAtMillis
            )
        )
        val defaultSettings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = workspace.workspaceId,
            updatedAtMillis = workspace.createdAtMillis
        )
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            WorkspaceSchedulerSettingsEntity(
                workspaceId = defaultSettings.workspaceId,
                algorithm = defaultSettings.algorithm,
                desiredRetention = defaultSettings.desiredRetention,
                learningStepsMinutesJson = encodeSchedulerStepListJson(defaultSettings.learningStepsMinutes),
                relearningStepsMinutesJson = encodeSchedulerStepListJson(defaultSettings.relearningStepsMinutes),
                maximumIntervalDays = defaultSettings.maximumIntervalDays,
                enableFuzz = defaultSettings.enableFuzz,
                updatedAtMillis = defaultSettings.updatedAtMillis
            )
        )
        database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = workspace.workspaceId,
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            )
        )
    }

    private suspend fun refreshCurrentWorkspaceShellInTransaction(workspace: CloudWorkspaceSummary) {
        val currentWorkspace = requireNotNull(database.workspaceDao().loadWorkspaceById(workspace.workspaceId)) {
            "Workspace '${workspace.workspaceId}' is missing locally."
        }
        database.workspaceDao().updateWorkspace(
            currentWorkspace.copy(
                name = workspace.name,
                createdAtMillis = workspace.createdAtMillis
            )
        )
    }

    private suspend fun forkWorkspaceIdentityInTransaction(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspace: CloudWorkspaceSummary
    ) {
        val currentLocalWorkspace = requireNotNull(
            database.workspaceDao().loadWorkspaceById(currentLocalWorkspaceId)
        ) {
            "Cannot fork workspace identity because current local workspace '$currentLocalWorkspaceId' does not exist."
        }
        val snapshot = loadWorkspaceForkSnapshot(workspaceId = currentLocalWorkspaceId)
        val forkMappings = buildWorkspaceForkIdMappings(
            sourceWorkspaceId = sourceWorkspaceId,
            destinationWorkspaceId = destinationWorkspace.workspaceId,
            cards = snapshot.cards,
            decks = snapshot.decks,
            reviewLogs = snapshot.reviewLogs
        )
        val destinationMatchesCurrentWorkspace = currentLocalWorkspaceId == destinationWorkspace.workspaceId

        if (destinationMatchesCurrentWorkspace) {
            database.workspaceDao().updateWorkspace(
                currentLocalWorkspace.copy(
                    name = destinationWorkspace.name,
                    createdAtMillis = destinationWorkspace.createdAtMillis
                )
            )
        } else {
            database.syncStateDao().deleteSyncState(workspaceId = destinationWorkspace.workspaceId)
            database.workspaceDao().loadWorkspaceById(destinationWorkspace.workspaceId)?.let {
                database.workspaceDao().deleteWorkspace(destinationWorkspace.workspaceId)
            }
            database.workspaceDao().insertWorkspace(
                WorkspaceEntity(
                    workspaceId = destinationWorkspace.workspaceId,
                    name = destinationWorkspace.name,
                    createdAtMillis = destinationWorkspace.createdAtMillis
                )
            )
            snapshot.schedulerSettings?.let {
                database.workspaceSchedulerSettingsDao().reassignWorkspace(
                    oldWorkspaceId = currentLocalWorkspaceId,
                    newWorkspaceId = destinationWorkspace.workspaceId
                )
            }
            if (snapshot.tags.isNotEmpty()) {
                database.tagDao().reassignWorkspace(
                    oldWorkspaceId = currentLocalWorkspaceId,
                    newWorkspaceId = destinationWorkspace.workspaceId
                )
            }
            localProgressCacheStore.reassignWorkspaceInTransaction(
                oldWorkspaceId = currentLocalWorkspaceId,
                newWorkspaceId = destinationWorkspace.workspaceId
            )
        }

        if (snapshot.cards.isNotEmpty()) {
            val cardsToInsert = snapshot.cards.mapNotNull { card ->
                val rewrittenCardId = forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = card.cardId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenCardId == card.cardId) {
                    return@mapNotNull null
                }
                card.copy(
                    cardId = rewrittenCardId,
                    workspaceId = destinationWorkspace.workspaceId
                )
            }
            if (cardsToInsert.isNotEmpty()) {
                database.cardDao().insertCards(cardsToInsert)
            }
        }
        if (snapshot.decks.isNotEmpty()) {
            val decksToInsert = snapshot.decks.mapNotNull { deck ->
                val rewrittenDeckId = forkMappings.deckIdsBySourceId.requireMappedId(
                    entityType = "deck",
                    sourceId = deck.deckId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenDeckId == deck.deckId) {
                    return@mapNotNull null
                }
                deck.copy(
                    deckId = rewrittenDeckId,
                    workspaceId = destinationWorkspace.workspaceId
                )
            }
            if (decksToInsert.isNotEmpty()) {
                database.deckDao().insertDecks(decksToInsert)
            }
        }
        if (snapshot.cardTags.isNotEmpty()) {
            val cardTagsToInsert = snapshot.cardTags.mapNotNull { cardTag ->
                val rewrittenCardId = forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = cardTag.cardId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenCardId == cardTag.cardId) {
                    return@mapNotNull null
                }
                CardTagEntity(cardId = rewrittenCardId, tagId = cardTag.tagId)
            }
            if (cardTagsToInsert.isNotEmpty()) {
                database.tagDao().insertCardTags(cardTagsToInsert)
            }
        }
        if (snapshot.reviewLogs.isNotEmpty()) {
            val reviewLogsToInsert = snapshot.reviewLogs.mapNotNull { reviewLog ->
                val rewrittenReviewEventId = forkMappings.reviewEventIdsBySourceId.requireMappedId(
                    entityType = "review_event",
                    sourceId = reviewLog.reviewLogId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenReviewEventId == reviewLog.reviewLogId) {
                    return@mapNotNull null
                }
                reviewLog.copy(
                    reviewLogId = rewrittenReviewEventId,
                    workspaceId = destinationWorkspace.workspaceId,
                    cardId = forkMappings.cardIdsBySourceId.requireMappedId(
                        entityType = "card",
                        sourceId = reviewLog.cardId
                    )
                )
            }
            if (reviewLogsToInsert.isNotEmpty()) {
                database.reviewLogDao().insertReviewLogs(reviewLogsToInsert)
            }
        }
        if (snapshot.outboxEntries.isNotEmpty()) {
            val outboxEntriesToInsert = snapshot.outboxEntries.mapNotNull { entry ->
                val rewrittenEntry = rewriteOutboxEntryForFork(
                    entry = entry,
                    destinationWorkspaceId = destinationWorkspace.workspaceId,
                    forkMappings = forkMappings
                )
                if (
                    destinationMatchesCurrentWorkspace &&
                    rewrittenEntry.workspaceId == entry.workspaceId &&
                    rewrittenEntry.entityId == entry.entityId &&
                    rewrittenEntry.payloadJson == entry.payloadJson
                ) {
                    return@mapNotNull null
                }
                rewrittenEntry
            }
            if (outboxEntriesToInsert.isNotEmpty()) {
                database.outboxDao().insertOutboxEntries(outboxEntriesToInsert)
            }
        }

        if (destinationMatchesCurrentWorkspace) {
            val didRewriteLocalEntityIds: Boolean = hasWorkspaceForkEntityIdRewrites(
                snapshot = snapshot,
                forkMappings = forkMappings
            )
            snapshot.decks
                .filter { deck ->
                    forkMappings.deckIdsBySourceId.requireMappedId(
                        entityType = "deck",
                        sourceId = deck.deckId
                    ) != deck.deckId
                }
                .forEach { deck -> database.deckDao().deleteDeck(deck.deckId) }
            snapshot.cards
                .filter { card ->
                    forkMappings.cardIdsBySourceId.requireMappedId(
                        entityType = "card",
                        sourceId = card.cardId
                    ) != card.cardId
                }
                .forEach { card -> database.cardDao().deleteCard(card.cardId) }
            if (didRewriteLocalEntityIds) {
                resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = destinationWorkspace.workspaceId)
            }
        } else {
            database.workspaceDao().deleteWorkspace(currentLocalWorkspaceId)
            database.syncStateDao().deleteSyncState(workspaceId = currentLocalWorkspaceId)
        }

        replaceSyncStateWithEmptyProgress(workspaceId = destinationWorkspace.workspaceId)
    }

    private suspend fun loadWorkspaceForkSnapshot(workspaceId: String): WorkspaceForkSnapshot {
        val cards = database.cardDao().loadCards(workspaceId = workspaceId)
        return WorkspaceForkSnapshot(
            cards = cards,
            decks = database.deckDao().loadDecks(workspaceId = workspaceId),
            tags = database.tagDao().loadTags(workspaceId = workspaceId),
            cardTags = database.tagDao().loadCardTags(workspaceId = workspaceId),
            reviewLogs = database.reviewLogDao().loadReviewLogs(workspaceId = workspaceId),
            outboxEntries = database.outboxDao().loadAllOutboxEntries(workspaceId = workspaceId),
            schedulerSettings = database.workspaceSchedulerSettingsDao()
                .loadWorkspaceSchedulerSettings(workspaceId = workspaceId)
        )
    }

    private suspend fun reidentifyCardWorkspaceForkConflictInTransaction(
        workspaceId: String,
        cardId: String
    ): String {
        val card = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot recover workspace fork conflict for card '$cardId' in workspace '$workspaceId' " +
                "because the local card does not exist."
        }
        require(card.workspaceId == workspaceId) {
            "Cannot recover workspace fork conflict for card '$cardId' in workspace '$workspaceId' " +
                "because the local card belongs to workspace '${card.workspaceId}'."
        }

        val newCardId = generateFreshCardIdInTransaction()
        database.cardDao().insertCard(card.copy(cardId = newCardId))
        database.tagDao().reassignCardTagsToCard(oldCardId = cardId, newCardId = newCardId)
        database.reviewLogDao().reassignReviewLogsToCard(
            workspaceId = workspaceId,
            oldCardId = cardId,
            newCardId = newCardId
        )
        rewriteOutboxEntriesForWorkspaceForkEntityReId(
            workspaceId = workspaceId,
            entityType = SyncEntityType.CARD,
            oldEntityId = cardId,
            newEntityId = newCardId
        )
        database.cardDao().deleteCard(cardId = cardId)
        resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = workspaceId)
        return newCardId
    }

    private suspend fun reidentifyDeckWorkspaceForkConflictInTransaction(
        workspaceId: String,
        deckId: String
    ): String {
        val deck = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot recover workspace fork conflict for deck '$deckId' in workspace '$workspaceId' " +
                "because the local deck does not exist."
        }
        require(deck.workspaceId == workspaceId) {
            "Cannot recover workspace fork conflict for deck '$deckId' in workspace '$workspaceId' " +
                "because the local deck belongs to workspace '${deck.workspaceId}'."
        }

        val newDeckId = generateFreshDeckIdInTransaction()
        database.deckDao().insertDeck(deck.copy(deckId = newDeckId))
        rewriteOutboxEntriesForWorkspaceForkEntityReId(
            workspaceId = workspaceId,
            entityType = SyncEntityType.DECK,
            oldEntityId = deckId,
            newEntityId = newDeckId
        )
        database.deckDao().deleteDeck(deckId = deckId)
        resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = workspaceId)
        return newDeckId
    }

    private suspend fun reidentifyReviewEventWorkspaceForkConflictInTransaction(
        workspaceId: String,
        reviewEventId: String
    ): String {
        val reviewLog = requireNotNull(database.reviewLogDao().loadReviewLog(reviewLogId = reviewEventId)) {
            "Cannot recover workspace fork conflict for review_event '$reviewEventId' in workspace '$workspaceId' " +
                "because the local review log does not exist."
        }
        require(reviewLog.workspaceId == workspaceId) {
            "Cannot recover workspace fork conflict for review_event '$reviewEventId' in workspace '$workspaceId' " +
                "because the local review log belongs to workspace '${reviewLog.workspaceId}'."
        }

        val newReviewEventId = generateFreshReviewEventIdInTransaction()
        database.reviewLogDao().insertReviewLogs(
            listOf(reviewLog.copy(reviewLogId = newReviewEventId))
        )
        rewriteOutboxEntriesForWorkspaceForkEntityReId(
            workspaceId = workspaceId,
            entityType = SyncEntityType.REVIEW_EVENT,
            oldEntityId = reviewEventId,
            newEntityId = newReviewEventId
        )
        database.reviewLogDao().deleteReviewLogs(reviewLogIds = listOf(reviewEventId))
        resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = workspaceId)
        return newReviewEventId
    }

    private suspend fun rewriteOutboxEntriesForWorkspaceForkEntityReId(
        workspaceId: String,
        entityType: SyncEntityType,
        oldEntityId: String,
        newEntityId: String
    ) {
        val rewrittenEntries = database.outboxDao()
            .loadAllOutboxEntries(workspaceId = workspaceId)
            .mapNotNull { entry ->
                val rewrittenEntry = rewriteOutboxEntryForWorkspaceForkEntityReId(
                    entry = entry,
                    entityType = entityType,
                    oldEntityId = oldEntityId,
                    newEntityId = newEntityId
                )
                if (rewrittenEntry == entry) {
                    null
                } else {
                    rewrittenEntry
                }
            }
        if (rewrittenEntries.isNotEmpty()) {
            database.outboxDao().insertOutboxEntries(rewrittenEntries)
        }
    }

    private suspend fun generateFreshCardIdInTransaction(): String {
        repeat(10) {
            val candidate = UUID.randomUUID().toString()
            if (database.cardDao().loadCard(cardId = candidate) == null) {
                return candidate
            }
        }
        throw IllegalStateException("Unable to generate a fresh local card id after 10 attempts.")
    }

    private suspend fun generateFreshDeckIdInTransaction(): String {
        repeat(10) {
            val candidate = UUID.randomUUID().toString()
            if (database.deckDao().loadDeck(deckId = candidate) == null) {
                return candidate
            }
        }
        throw IllegalStateException("Unable to generate a fresh local deck id after 10 attempts.")
    }

    private suspend fun generateFreshReviewEventIdInTransaction(): String {
        repeat(10) {
            val candidate = UUID.randomUUID().toString()
            if (database.reviewLogDao().loadReviewLog(reviewLogId = candidate) == null) {
                return candidate
            }
        }
        throw IllegalStateException("Unable to generate a fresh local review_event id after 10 attempts.")
    }

    private suspend fun replaceSyncStateWithEmptyProgress(workspaceId: String) {
        database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            )
        )
    }

    /**
     * Local re-id recovery is rare; reset volatile persisted selections instead
     * of preserving state that may still point at old entity ids.
     */
    private fun resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId: String) {
        reviewPreferencesStore.clearSelectedReviewFilter(workspaceId = workspaceId)
    }

    private suspend fun applyHotPayload(
        workspaceId: String,
        entityType: SyncEntityType,
        payload: JSONObject,
        fieldPath: String
    ) {
        when (entityType) {
            SyncEntityType.CARD -> applyRemoteCard(workspaceId, payload, fieldPath)
            SyncEntityType.DECK -> applyRemoteDeck(workspaceId, payload, fieldPath)
            SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> applyRemoteSettings(workspaceId, payload, fieldPath)
            SyncEntityType.REVIEW_EVENT -> error("Hot-state payload unexpectedly contained review event.")
        }
    }

    private suspend fun applyRemoteCard(workspaceId: String, payload: JSONObject, fieldPath: String) {
        val card = CardEntity(
            cardId = payload.requireCloudString("cardId", "$fieldPath.cardId"),
            workspaceId = workspaceId,
            frontText = payload.requireCloudString("frontText", "$fieldPath.frontText"),
            backText = payload.requireCloudString("backText", "$fieldPath.backText"),
            effortLevel = parseEffortLevel(
                rawValue = payload.requireCloudString("effortLevel", "$fieldPath.effortLevel"),
                fieldPath = "$fieldPath.effortLevel"
            ),
            dueAtMillis = payload.requireCloudNullableIsoTimestampMillis("dueAt", "$fieldPath.dueAt"),
            createdAtMillis = payload.requireCloudIsoTimestampMillis("createdAt", "$fieldPath.createdAt"),
            updatedAtMillis = payload.requireCloudIsoTimestampMillis("clientUpdatedAt", "$fieldPath.clientUpdatedAt"),
            reps = payload.requireCloudInt("reps", "$fieldPath.reps"),
            lapses = payload.requireCloudInt("lapses", "$fieldPath.lapses"),
            fsrsCardState = parseFsrsCardState(
                rawValue = payload.requireCloudString("fsrsCardState", "$fieldPath.fsrsCardState"),
                fieldPath = "$fieldPath.fsrsCardState"
            ),
            fsrsStepIndex = payload.optCloudIntOrNull("fsrsStepIndex", "$fieldPath.fsrsStepIndex"),
            fsrsStability = payload.optCloudDoubleOrNull("fsrsStability", "$fieldPath.fsrsStability"),
            fsrsDifficulty = payload.optCloudDoubleOrNull("fsrsDifficulty", "$fieldPath.fsrsDifficulty"),
            fsrsLastReviewedAtMillis = payload.requireCloudNullableIsoTimestampMillis(
                "fsrsLastReviewedAt",
                "$fieldPath.fsrsLastReviewedAt"
            ),
            fsrsScheduledDays = payload.optCloudIntOrNull("fsrsScheduledDays", "$fieldPath.fsrsScheduledDays"),
            deletedAtMillis = payload.requireCloudNullableIsoTimestampMillis("deletedAt", "$fieldPath.deletedAt")
        )
        val existingCard = database.cardDao().loadCard(card.cardId)
        if (existingCard == null) {
            database.cardDao().insertCard(card)
        } else {
            database.cardDao().updateCard(card)
        }

        replaceCardTags(
            workspaceId = workspaceId,
            cardId = card.cardId,
            tags = payload.requireCloudArray("tags", "$fieldPath.tags").toCloudStringList("$fieldPath.tags")
        )
    }

    private suspend fun applyRemoteDeck(workspaceId: String, payload: JSONObject, fieldPath: String) {
        val deck = DeckEntity(
            deckId = payload.requireCloudString("deckId", "$fieldPath.deckId"),
            workspaceId = workspaceId,
            name = payload.requireCloudString("name", "$fieldPath.name"),
            filterDefinitionJson = payload.requireCloudObject("filterDefinition", "$fieldPath.filterDefinition").toString(),
            createdAtMillis = payload.requireCloudIsoTimestampMillis("createdAt", "$fieldPath.createdAt"),
            updatedAtMillis = payload.requireCloudIsoTimestampMillis("clientUpdatedAt", "$fieldPath.clientUpdatedAt"),
            deletedAtMillis = payload.requireCloudNullableIsoTimestampMillis("deletedAt", "$fieldPath.deletedAt")
        )
        val existingDeck = database.deckDao().loadDeck(deck.deckId)
        if (existingDeck == null) {
            database.deckDao().insertDeck(deck)
        } else {
            database.deckDao().updateDeck(deck)
        }
    }

    private suspend fun applyRemoteSettings(workspaceId: String, payload: JSONObject, fieldPath: String) {
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            WorkspaceSchedulerSettingsEntity(
                workspaceId = workspaceId,
                algorithm = payload.requireCloudString("algorithm", "$fieldPath.algorithm"),
                desiredRetention = payload.requireCloudDouble("desiredRetention", "$fieldPath.desiredRetention"),
                learningStepsMinutesJson = encodeSchedulerStepListJson(
                    payload.requireCloudArray("learningStepsMinutes", "$fieldPath.learningStepsMinutes")
                        .toCloudIntList("$fieldPath.learningStepsMinutes")
                ),
                relearningStepsMinutesJson = encodeSchedulerStepListJson(
                    payload.requireCloudArray("relearningStepsMinutes", "$fieldPath.relearningStepsMinutes")
                        .toCloudIntList("$fieldPath.relearningStepsMinutes")
                ),
                maximumIntervalDays = payload.requireCloudInt("maximumIntervalDays", "$fieldPath.maximumIntervalDays"),
                enableFuzz = payload.requireCloudBoolean("enableFuzz", "$fieldPath.enableFuzz"),
                updatedAtMillis = payload.requireCloudIsoTimestampMillis("clientUpdatedAt", "$fieldPath.clientUpdatedAt")
            )
        )
    }

    private suspend fun replaceCardTags(workspaceId: String, cardId: String, tags: List<String>) {
        val workspaceTags = database.tagDao().loadTagsForWorkspace(workspaceId)
        val normalizedTags = normalizeTags(tags, workspaceTags.map(TagEntity::name))
        database.tagDao().deleteCardTags(cardId)
        if (normalizedTags.isEmpty()) {
            database.tagDao().deleteUnusedTags(workspaceId)
            return
        }

        val existingTags = database.tagDao().loadTagsByNames(workspaceId, normalizedTags)
        val missingTags = normalizedTags.filter { normalizedTag ->
            existingTags.none { tag -> tag.name == normalizedTag }
        }
        if (missingTags.isNotEmpty()) {
            database.tagDao().insertTags(
                missingTags.map { tag ->
                    TagEntity(
                        tagId = UUID.randomUUID().toString(),
                        workspaceId = workspaceId,
                        name = tag
                    )
                }
            )
        }
        val resolvedTags = database.tagDao().loadTagsByNames(workspaceId, normalizedTags)
        database.tagDao().insertCardTags(
            resolvedTags.map { tag ->
                CardTagEntity(cardId = cardId, tagId = tag.tagId)
            }
        )
        database.tagDao().deleteUnusedTags(workspaceId)
    }

    private fun decodeOutboxOperation(entry: OutboxEntryEntity): SyncOperation {
        val payloadJson = JSONObject(entry.payloadJson)
        val entityType = parseSyncEntityType(entry.entityType)
        return SyncOperation(
            operationId = entry.outboxEntryId,
            entityType = entityType,
            entityId = entry.entityId,
            action = parseSyncAction(entry.operationType),
            clientUpdatedAt = entry.clientUpdatedAtIso,
            payload = when (entityType) {
                SyncEntityType.CARD -> SyncOperationPayload.Card(
                    CardSyncPayload(
                        cardId = payloadJson.requireCloudString("cardId", "outbox.card.cardId"),
                        frontText = payloadJson.requireCloudString("frontText", "outbox.card.frontText"),
                        backText = payloadJson.requireCloudString("backText", "outbox.card.backText"),
                        tags = payloadJson.requireCloudArray("tags", "outbox.card.tags").toCloudStringList("outbox.card.tags"),
                        effortLevel = payloadJson.requireCloudString("effortLevel", "outbox.card.effortLevel"),
                        dueAt = payloadJson.requireCloudNullableString("dueAt", "outbox.card.dueAt"),
                        createdAt = payloadJson.requireCloudString("createdAt", "outbox.card.createdAt"),
                        reps = payloadJson.requireCloudInt("reps", "outbox.card.reps"),
                        lapses = payloadJson.requireCloudInt("lapses", "outbox.card.lapses"),
                        fsrsCardState = payloadJson.requireCloudString("fsrsCardState", "outbox.card.fsrsCardState"),
                        fsrsStepIndex = payloadJson.optCloudIntOrNull("fsrsStepIndex", "outbox.card.fsrsStepIndex"),
                        fsrsStability = payloadJson.optCloudDoubleOrNull("fsrsStability", "outbox.card.fsrsStability"),
                        fsrsDifficulty = payloadJson.optCloudDoubleOrNull("fsrsDifficulty", "outbox.card.fsrsDifficulty"),
                        fsrsLastReviewedAt = payloadJson.requireCloudNullableString(
                            "fsrsLastReviewedAt",
                            "outbox.card.fsrsLastReviewedAt"
                        ),
                        fsrsScheduledDays = payloadJson.optCloudIntOrNull("fsrsScheduledDays", "outbox.card.fsrsScheduledDays"),
                        deletedAt = payloadJson.requireCloudNullableString("deletedAt", "outbox.card.deletedAt")
                    )
                )
                SyncEntityType.DECK -> SyncOperationPayload.Deck(
                    DeckSyncPayload(
                        deckId = payloadJson.requireCloudString("deckId", "outbox.deck.deckId"),
                        name = payloadJson.requireCloudString("name", "outbox.deck.name"),
                        filterDefinition = parseDeckFilterDefinition(
                            jsonObject = payloadJson.requireCloudObject("filterDefinition", "outbox.deck.filterDefinition"),
                            fieldPath = "outbox.deck.filterDefinition"
                        ),
                        createdAt = payloadJson.requireCloudString("createdAt", "outbox.deck.createdAt"),
                        deletedAt = payloadJson.requireCloudNullableString("deletedAt", "outbox.deck.deletedAt")
                    )
                )
                SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> SyncOperationPayload.WorkspaceSchedulerSettings(
                    WorkspaceSchedulerSettingsSyncPayload(
                        algorithm = payloadJson.requireCloudString("algorithm", "outbox.settings.algorithm"),
                        desiredRetention = payloadJson.requireCloudDouble("desiredRetention", "outbox.settings.desiredRetention"),
                        learningStepsMinutes = payloadJson.requireCloudArray(
                            "learningStepsMinutes",
                            "outbox.settings.learningStepsMinutes"
                        ).toCloudIntList("outbox.settings.learningStepsMinutes"),
                        relearningStepsMinutes = payloadJson.requireCloudArray(
                            "relearningStepsMinutes",
                            "outbox.settings.relearningStepsMinutes"
                        ).toCloudIntList("outbox.settings.relearningStepsMinutes"),
                        maximumIntervalDays = payloadJson.requireCloudInt(
                            "maximumIntervalDays",
                            "outbox.settings.maximumIntervalDays"
                        ),
                        enableFuzz = payloadJson.requireCloudBoolean("enableFuzz", "outbox.settings.enableFuzz")
                    )
                )
                SyncEntityType.REVIEW_EVENT -> SyncOperationPayload.ReviewEvent(
                    ReviewEventSyncPayload(
                        reviewEventId = payloadJson.requireCloudString("reviewEventId", "outbox.reviewEvent.reviewEventId"),
                        cardId = payloadJson.requireCloudString("cardId", "outbox.reviewEvent.cardId"),
                        clientEventId = payloadJson.requireCloudString("clientEventId", "outbox.reviewEvent.clientEventId"),
                        rating = payloadJson.requireCloudInt("rating", "outbox.reviewEvent.rating"),
                        reviewedAtClient = payloadJson.requireCloudString("reviewedAtClient", "outbox.reviewEvent.reviewedAtClient")
                    )
                )
            }
        )
    }
}

private fun pendingLocalHotEntityKey(entry: OutboxEntryEntity): PendingLocalHotEntityKey? {
    return parseSyncEntityType(entry.entityType).toPendingLocalHotEntityKey(entityId = entry.entityId)
}

private fun RemoteBootstrapEntry.toPendingLocalHotEntityKey(): PendingLocalHotEntityKey? {
    return entityType.toPendingLocalHotEntityKey(entityId = entityId)
}

private fun SyncEntityType.toPendingLocalHotEntityKey(entityId: String): PendingLocalHotEntityKey? {
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

private fun hasWorkspaceForkEntityIdRewrites(
    snapshot: WorkspaceForkSnapshot,
    forkMappings: WorkspaceForkIdMappings
): Boolean {
    return snapshot.cards.any { card ->
        forkMappings.cardIdsBySourceId.requireMappedId(
            entityType = "card",
            sourceId = card.cardId
        ) != card.cardId
    } || snapshot.decks.any { deck ->
        forkMappings.deckIdsBySourceId.requireMappedId(
            entityType = "deck",
            sourceId = deck.deckId
        ) != deck.deckId
    } || snapshot.reviewLogs.any { reviewLog ->
        forkMappings.reviewEventIdsBySourceId.requireMappedId(
            entityType = "review_event",
            sourceId = reviewLog.reviewLogId
        ) != reviewLog.reviewLogId
    }
}

private fun buildWorkspaceForkIdMappings(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    cards: List<CardEntity>,
    decks: List<DeckEntity>,
    reviewLogs: List<ReviewLogEntity>
): WorkspaceForkIdMappings {
    return WorkspaceForkIdMappings(
        cardIdsBySourceId = cards.associate { card ->
            card.cardId to forkedCardId(
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspaceId = destinationWorkspaceId,
                sourceCardId = card.cardId
            )
        },
        deckIdsBySourceId = decks.associate { deck ->
            deck.deckId to forkedDeckId(
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspaceId = destinationWorkspaceId,
                sourceDeckId = deck.deckId
            )
        },
        reviewEventIdsBySourceId = reviewLogs.associate { reviewLog ->
            reviewLog.reviewLogId to forkedReviewEventId(
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspaceId = destinationWorkspaceId,
                sourceReviewEventId = reviewLog.reviewLogId
            )
        }
    )
}

private fun rewriteOutboxEntryForFork(
    entry: OutboxEntryEntity,
    destinationWorkspaceId: String,
    forkMappings: WorkspaceForkIdMappings
): OutboxEntryEntity {
    val payloadJson = JSONObject(entry.payloadJson)
    val entityType = parseSyncEntityType(entry.entityType)
    val rewrittenEntityId = when (entityType) {
        SyncEntityType.CARD -> forkMappings.cardIdsBySourceId.requireMappedId(
            entityType = "card",
            sourceId = entry.entityId
        )

        SyncEntityType.DECK -> forkMappings.deckIdsBySourceId.requireMappedId(
            entityType = "deck",
            sourceId = entry.entityId
        )

        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> destinationWorkspaceId

        SyncEntityType.REVIEW_EVENT -> forkMappings.reviewEventIdsBySourceId.requireMappedId(
            entityType = "review_event",
            sourceId = entry.entityId
        )
    }
    when (entityType) {
        SyncEntityType.CARD -> {
            payloadJson.put(
                "cardId",
                forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = payloadJson.requireCloudString("cardId", "fork.outbox.card.cardId")
                )
            )
        }

        SyncEntityType.DECK -> {
            payloadJson.put(
                "deckId",
                forkMappings.deckIdsBySourceId.requireMappedId(
                    entityType = "deck",
                    sourceId = payloadJson.requireCloudString("deckId", "fork.outbox.deck.deckId")
                )
            )
        }

        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> Unit

        SyncEntityType.REVIEW_EVENT -> {
            payloadJson.put(
                "reviewEventId",
                forkMappings.reviewEventIdsBySourceId.requireMappedId(
                    entityType = "review_event",
                    sourceId = payloadJson.requireCloudString(
                        "reviewEventId",
                        "fork.outbox.reviewEvent.reviewEventId"
                    )
                )
            )
            payloadJson.put(
                "cardId",
                forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = payloadJson.requireCloudString("cardId", "fork.outbox.reviewEvent.cardId")
                )
            )
        }
    }
    return entry.copy(
        workspaceId = destinationWorkspaceId,
        entityId = rewrittenEntityId,
        payloadJson = payloadJson.toString()
    )
}

private fun rewriteOutboxEntryForWorkspaceForkEntityReId(
    entry: OutboxEntryEntity,
    entityType: SyncEntityType,
    oldEntityId: String,
    newEntityId: String
): OutboxEntryEntity {
    val entryEntityType = parseSyncEntityType(entry.entityType)
    val payloadJson = JSONObject(entry.payloadJson)
    var rewrittenEntityId = entry.entityId
    var changed = false

    when (entityType) {
        SyncEntityType.CARD -> {
            if (entryEntityType == SyncEntityType.CARD) {
                val payloadCardId = payloadJson.requireCloudString(
                    key = "cardId",
                    fieldPath = "reid.outbox.card.cardId"
                )
                if (entry.entityId == oldEntityId || payloadCardId == oldEntityId) {
                    rewrittenEntityId = newEntityId
                    payloadJson.put("cardId", newEntityId)
                    changed = entry.entityId != newEntityId || payloadCardId != newEntityId
                }
            } else if (entryEntityType == SyncEntityType.REVIEW_EVENT) {
                changed = replaceJsonStringReferenceIfMatches(
                    payloadJson = payloadJson,
                    key = "cardId",
                    oldValue = oldEntityId,
                    newValue = newEntityId,
                    fieldPath = "reid.outbox.reviewEvent.cardId"
                ) || changed
            }
        }

        SyncEntityType.DECK -> {
            if (entryEntityType == SyncEntityType.DECK) {
                val payloadDeckId = payloadJson.requireCloudString(
                    key = "deckId",
                    fieldPath = "reid.outbox.deck.deckId"
                )
                if (entry.entityId == oldEntityId || payloadDeckId == oldEntityId) {
                    rewrittenEntityId = newEntityId
                    payloadJson.put("deckId", newEntityId)
                    changed = entry.entityId != newEntityId || payloadDeckId != newEntityId
                }
            }
        }

        SyncEntityType.REVIEW_EVENT -> {
            if (entryEntityType == SyncEntityType.REVIEW_EVENT) {
                val payloadReviewEventId = payloadJson.requireCloudString(
                    key = "reviewEventId",
                    fieldPath = "reid.outbox.reviewEvent.reviewEventId"
                )
                if (entry.entityId == oldEntityId || payloadReviewEventId == oldEntityId) {
                    rewrittenEntityId = newEntityId
                    payloadJson.put("reviewEventId", newEntityId)
                    changed = entry.entityId != newEntityId || payloadReviewEventId != newEntityId
                }
            }
        }

        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> Unit
    }

    return if (changed) {
        entry.copy(
            entityId = rewrittenEntityId,
            payloadJson = payloadJson.toString()
        )
    } else {
        entry
    }
}

private fun replaceJsonStringReferenceIfMatches(
    payloadJson: JSONObject,
    key: String,
    oldValue: String,
    newValue: String,
    fieldPath: String
): Boolean {
    val currentValue = payloadJson.requireCloudString(key = key, fieldPath = fieldPath)
    if (currentValue != oldValue) {
        return false
    }
    payloadJson.put(key, newValue)
    return true
}

private fun Map<String, String>.requireMappedId(entityType: String, sourceId: String): String {
    return requireNotNull(this[sourceId]) {
        "Workspace identity fork is missing mapped $entityType id for source id '$sourceId'."
    }
}

private fun logLinkedWorkspaceMigration(
    outcome: String,
    fromWorkspaceId: String?,
    toWorkspaceId: String,
    remoteWorkspaceIsEmpty: Boolean,
    migrationKind: String
) {
    Log.i(
        cloudMigrationLogTag,
        "outcome=$outcome fromWorkspaceId=${fromWorkspaceId ?: "-"} " +
            "toWorkspaceId=$toWorkspaceId remoteWorkspaceIsEmpty=$remoteWorkspaceIsEmpty " +
            "migrationKind=$migrationKind"
    )
}

private fun parseSyncEntityType(rawValue: String): SyncEntityType {
    return when (rawValue) {
        "card" -> SyncEntityType.CARD
        "deck" -> SyncEntityType.DECK
        "workspace_scheduler_settings" -> SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS
        "review_event" -> SyncEntityType.REVIEW_EVENT
        else -> throw IllegalArgumentException("Unsupported sync entity type: $rawValue")
    }
}

private fun parseSyncAction(rawValue: String): SyncAction {
    return when (rawValue) {
        "upsert" -> SyncAction.UPSERT
        "append" -> SyncAction.APPEND
        else -> throw IllegalArgumentException("Unsupported sync action: $rawValue")
    }
}

private fun SyncEntityType.toRemoteValue(): String {
    return when (this) {
        SyncEntityType.CARD -> "card"
        SyncEntityType.DECK -> "deck"
        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> "workspace_scheduler_settings"
        SyncEntityType.REVIEW_EVENT -> "review_event"
    }
}

private fun SyncAction.toRemoteValue(): String {
    return when (this) {
        SyncAction.UPSERT -> "upsert"
        SyncAction.APPEND -> "append"
    }
}

private fun parseEffortLevel(rawValue: String, fieldPath: String): EffortLevel {
    return when (rawValue) {
        "fast" -> EffortLevel.FAST
        "medium" -> EffortLevel.MEDIUM
        "long" -> EffortLevel.LONG
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [fast, medium, long], got invalid string \"$rawValue\""
        )
    }
}

private fun parseFsrsCardState(rawValue: String, fieldPath: String): FsrsCardState {
    return when (rawValue) {
        "new" -> FsrsCardState.NEW
        "learning" -> FsrsCardState.LEARNING
        "review" -> FsrsCardState.REVIEW
        "relearning" -> FsrsCardState.RELEARNING
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [new, learning, review, relearning], got invalid string \"$rawValue\""
        )
    }
}

private fun parseDeckFilterDefinition(jsonObject: JSONObject, fieldPath: String): DeckFilterDefinition {
    val effortLevels = jsonObject.optJSONArray("effortLevels")
        ?.toCloudStringList("$fieldPath.effortLevels")
        ?.mapIndexed { index, value ->
            parseEffortLevel(value, "$fieldPath.effortLevels[$index]")
        }
        ?: emptyList()
    val tags = jsonObject.optJSONArray("tags")?.toCloudStringList("$fieldPath.tags") ?: emptyList()
    return buildDeckFilterDefinition(
        effortLevels = effortLevels,
        tags = tags
    ).copy(version = jsonObject.optCloudIntOrNull("version", "$fieldPath.version") ?: 2)
}

private fun toCardSummary(card: CardWithRelations): CardSummary {
    return CardSummary(
        cardId = card.card.cardId,
        workspaceId = card.card.workspaceId,
        frontText = card.card.frontText,
        backText = card.card.backText,
        tags = normalizeTags(card.tags.map(TagEntity::name), emptyList()),
        effortLevel = card.card.effortLevel,
        dueAtMillis = card.card.dueAtMillis,
        createdAtMillis = card.card.createdAtMillis,
        updatedAtMillis = card.card.updatedAtMillis,
        reps = card.card.reps,
        lapses = card.card.lapses,
        fsrsCardState = card.card.fsrsCardState,
        fsrsStepIndex = card.card.fsrsStepIndex,
        fsrsStability = card.card.fsrsStability,
        fsrsDifficulty = card.card.fsrsDifficulty,
        fsrsLastReviewedAtMillis = card.card.fsrsLastReviewedAtMillis,
        fsrsScheduledDays = card.card.fsrsScheduledDays,
        deletedAtMillis = card.card.deletedAtMillis
    )
}
