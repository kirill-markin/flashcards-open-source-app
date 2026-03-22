package com.flashcardsopensourceapp.data.local.cloud

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
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

private const val outboxBatchLimit: Int = 200

class SyncLocalStore(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore
) {
    suspend fun enqueueCardUpsert(card: CardEntity, tags: List<String>) {
        val payloadJson = JSONObject()
            .put("cardId", card.cardId)
            .put("frontText", card.frontText)
            .put("backText", card.backText)
            .put("tags", JSONArray(tags))
            .put("effortLevel", card.effortLevel.name.lowercase())
            .put("dueAt", card.dueAtMillis?.let(::formatIsoTimestamp))
            .put("createdAt", formatIsoTimestamp(card.createdAtMillis))
            .put("reps", card.reps)
            .put("lapses", card.lapses)
            .put("fsrsCardState", card.fsrsCardState.name.lowercase())
            .put("fsrsStepIndex", card.fsrsStepIndex)
            .put("fsrsStability", card.fsrsStability)
            .put("fsrsDifficulty", card.fsrsDifficulty)
            .put("fsrsLastReviewedAt", card.fsrsLastReviewedAtMillis?.let(::formatIsoTimestamp))
            .put("fsrsScheduledDays", card.fsrsScheduledDays)
            .put("deletedAt", card.deletedAtMillis?.let(::formatIsoTimestamp))

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
            .put("deletedAt", deck.deletedAtMillis?.let(::formatIsoTimestamp))

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
            .put("deviceId", reviewLog.deviceId)
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
            lastSyncAttemptAtMillis = null,
            lastSuccessfulSyncAtMillis = null,
            lastSyncError = null
        )
        database.syncStateDao().insertSyncState(syncState)
        return syncState
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
                lastSyncError = errorMessage
            )
        )
    }

    suspend fun markSyncSuccess(
        workspaceId: String,
        lastSyncCursor: String,
        lastReviewSequenceId: Long,
        hasHydratedHotState: Boolean,
        hasHydratedReviewHistory: Boolean
    ) {
        val nowMillis = System.currentTimeMillis()
        database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = lastSyncCursor,
                lastReviewSequenceId = lastReviewSequenceId,
                hasHydratedHotState = hasHydratedHotState,
                hasHydratedReviewHistory = hasHydratedReviewHistory,
                lastSyncAttemptAtMillis = nowMillis,
                lastSuccessfulSyncAtMillis = nowMillis,
                lastSyncError = null
            )
        )
    }

    suspend fun replaceLocalWorkspaceWithShell(workspace: CloudWorkspaceSummary) {
        database.withTransaction {
            database.outboxDao().deleteOutboxEntriesForWorkspace(workspaceId = currentWorkspaceIdOrNull().orEmpty())
            database.reviewLogDao().deleteAllReviewLogs()
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
                    lastSyncAttemptAtMillis = null,
                    lastSuccessfulSyncAtMillis = null,
                    lastSyncError = null
                )
            )
        }
    }

    suspend fun relinkCurrentWorkspaceKeepingLocalData(workspace: CloudWorkspaceSummary) {
        val currentWorkspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace is required before linking to cloud."
        }
        if (currentWorkspace.workspaceId == workspace.workspaceId) {
            database.workspaceDao().updateWorkspace(
                currentWorkspace.copy(name = workspace.name)
            )
            return
        }

        database.withTransaction {
            database.workspaceDao().insertWorkspace(
                WorkspaceEntity(
                    workspaceId = workspace.workspaceId,
                    name = workspace.name,
                    createdAtMillis = workspace.createdAtMillis
                )
            )
            database.cardDao().reassignWorkspace(currentWorkspace.workspaceId, workspace.workspaceId)
            database.deckDao().reassignWorkspace(currentWorkspace.workspaceId, workspace.workspaceId)
            database.tagDao().reassignWorkspace(currentWorkspace.workspaceId, workspace.workspaceId)
            database.reviewLogDao().reassignWorkspace(currentWorkspace.workspaceId, workspace.workspaceId)
            database.workspaceSchedulerSettingsDao().reassignWorkspace(currentWorkspace.workspaceId, workspace.workspaceId)
            database.outboxDao().reassignWorkspace(currentWorkspace.workspaceId, workspace.workspaceId)
            database.syncStateDao().reassignWorkspace(currentWorkspace.workspaceId, workspace.workspaceId)
            database.workspaceDao().deleteWorkspace(currentWorkspace.workspaceId)
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
                            put("dueAt", card.dueAtMillis?.let(::formatIsoTimestamp))
                            put("createdAt", formatIsoTimestamp(card.createdAtMillis))
                            put("reps", card.reps)
                            put("lapses", card.lapses)
                            put("fsrsCardState", card.fsrsCardState.name.lowercase())
                            put("fsrsStepIndex", card.fsrsStepIndex)
                            put("fsrsStability", card.fsrsStability)
                            put("fsrsDifficulty", card.fsrsDifficulty)
                            put("fsrsLastReviewedAt", card.fsrsLastReviewedAtMillis?.let(::formatIsoTimestamp))
                            put("fsrsScheduledDays", card.fsrsScheduledDays)
                            put("clientUpdatedAt", formatIsoTimestamp(card.updatedAtMillis))
                            put("lastModifiedByDeviceId", preferencesStore.currentCloudSettings().deviceId)
                            put("lastOperationId", UUID.randomUUID().toString())
                            put("updatedAt", formatIsoTimestamp(card.updatedAtMillis))
                            put("deletedAt", card.deletedAtMillis?.let(::formatIsoTimestamp))
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
                            put("lastModifiedByDeviceId", preferencesStore.currentCloudSettings().deviceId)
                            put("lastOperationId", UUID.randomUUID().toString())
                            put("updatedAt", formatIsoTimestamp(deck.updatedAtMillis))
                            put("deletedAt", deck.deletedAtMillis?.let(::formatIsoTimestamp))
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
                        put("lastModifiedByDeviceId", preferencesStore.currentCloudSettings().deviceId)
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
                            .put("deviceId", reviewLog.deviceId)
                            .put("clientEventId", reviewLog.clientEventId)
                            .put("rating", reviewLog.rating.ordinal)
                            .put("reviewedAtClient", formatIsoTimestamp(reviewLog.reviewedAtMillis))
                            .put("reviewedAtServer", reviewLog.reviewedAtServerIso)
                    )
                }
        }
    }

    suspend fun applyBootstrapEntries(workspaceId: String, entries: List<RemoteBootstrapEntry>) {
        database.withTransaction {
            entries.forEach { entry ->
                applyHotPayload(workspaceId = workspaceId, entityType = entry.entityType, payload = entry.payload)
            }
        }
    }

    suspend fun applyPullChanges(workspaceId: String, changes: List<RemoteSyncChange>) {
        database.withTransaction {
            changes.forEach { change ->
                applyHotPayload(workspaceId = workspaceId, entityType = change.entityType, payload = change.payload)
            }
        }
    }

    suspend fun applyReviewHistory(events: List<RemoteReviewHistoryEvent>) {
        if (events.isEmpty()) {
            return
        }
        database.reviewLogDao().insertReviewLogs(
            events.map { event ->
                ReviewLogEntity(
                    reviewLogId = event.reviewEventId,
                    workspaceId = event.workspaceId,
                    cardId = event.cardId,
                    deviceId = event.deviceId,
                    clientEventId = event.clientEventId,
                    rating = ReviewRating.entries[event.rating],
                    reviewedAtMillis = parseIsoTimestamp(event.reviewedAtClient),
                    reviewedAtServerIso = event.reviewedAtServer
                )
            }
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
        database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = UUID.randomUUID().toString(),
                workspaceId = workspaceId,
                deviceId = preferencesStore.currentCloudSettings().deviceId,
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

    private suspend fun currentWorkspaceIdOrNull(): String? {
        return database.workspaceDao().loadWorkspace()?.workspaceId
    }

    private suspend fun applyHotPayload(
        workspaceId: String,
        entityType: SyncEntityType,
        payload: JSONObject
    ) {
        when (entityType) {
            SyncEntityType.CARD -> applyRemoteCard(workspaceId, payload)
            SyncEntityType.DECK -> applyRemoteDeck(workspaceId, payload)
            SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> applyRemoteSettings(workspaceId, payload)
            SyncEntityType.REVIEW_EVENT -> error("Hot-state payload unexpectedly contained review event.")
        }
    }

    private suspend fun applyRemoteCard(workspaceId: String, payload: JSONObject) {
        val card = CardEntity(
            cardId = payload.getString("cardId"),
            workspaceId = workspaceId,
            frontText = payload.getString("frontText"),
            backText = payload.getString("backText"),
            effortLevel = parseEffortLevel(payload.getString("effortLevel")),
            dueAtMillis = payload.optString("dueAt").ifBlank { null }?.let(::parseIsoTimestamp),
            createdAtMillis = parseIsoTimestamp(payload.getString("createdAt")),
            updatedAtMillis = parseIsoTimestamp(payload.getString("clientUpdatedAt")),
            reps = payload.getInt("reps"),
            lapses = payload.getInt("lapses"),
            fsrsCardState = parseFsrsCardState(payload.getString("fsrsCardState")),
            fsrsStepIndex = payload.optIntOrNull("fsrsStepIndex"),
            fsrsStability = payload.optDoubleOrNull("fsrsStability"),
            fsrsDifficulty = payload.optDoubleOrNull("fsrsDifficulty"),
            fsrsLastReviewedAtMillis = payload.optString("fsrsLastReviewedAt").ifBlank { null }?.let(::parseIsoTimestamp),
            fsrsScheduledDays = payload.optIntOrNull("fsrsScheduledDays"),
            deletedAtMillis = payload.optString("deletedAt").ifBlank { null }?.let(::parseIsoTimestamp)
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
            tags = payload.optJSONArray("tags")?.toStringList() ?: emptyList()
        )
    }

    private suspend fun applyRemoteDeck(workspaceId: String, payload: JSONObject) {
        val deck = DeckEntity(
            deckId = payload.getString("deckId"),
            workspaceId = workspaceId,
            name = payload.getString("name"),
            filterDefinitionJson = payload.getJSONObject("filterDefinition").toString(),
            createdAtMillis = parseIsoTimestamp(payload.getString("createdAt")),
            updatedAtMillis = parseIsoTimestamp(payload.getString("clientUpdatedAt")),
            deletedAtMillis = payload.optString("deletedAt").ifBlank { null }?.let(::parseIsoTimestamp)
        )
        val existingDeck = database.deckDao().loadDeck(deck.deckId)
        if (existingDeck == null) {
            database.deckDao().insertDeck(deck)
        } else {
            database.deckDao().updateDeck(deck)
        }
    }

    private suspend fun applyRemoteSettings(workspaceId: String, payload: JSONObject) {
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            WorkspaceSchedulerSettingsEntity(
                workspaceId = workspaceId,
                algorithm = payload.getString("algorithm"),
                desiredRetention = payload.getDouble("desiredRetention"),
                learningStepsMinutesJson = encodeSchedulerStepListJson(
                    payload.getJSONArray("learningStepsMinutes").toIntList()
                ),
                relearningStepsMinutesJson = encodeSchedulerStepListJson(
                    payload.getJSONArray("relearningStepsMinutes").toIntList()
                ),
                maximumIntervalDays = payload.getInt("maximumIntervalDays"),
                enableFuzz = payload.getBoolean("enableFuzz"),
                updatedAtMillis = parseIsoTimestamp(payload.getString("clientUpdatedAt"))
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
        return SyncOperation(
            operationId = entry.outboxEntryId,
            entityType = parseSyncEntityType(entry.entityType),
            entityId = entry.entityId,
            action = parseSyncAction(entry.operationType),
            clientUpdatedAt = entry.clientUpdatedAtIso,
            payload = when (parseSyncEntityType(entry.entityType)) {
                SyncEntityType.CARD -> SyncOperationPayload.Card(
                    CardSyncPayload(
                        cardId = payloadJson.getString("cardId"),
                        frontText = payloadJson.getString("frontText"),
                        backText = payloadJson.getString("backText"),
                        tags = payloadJson.optJSONArray("tags")?.toStringList() ?: emptyList(),
                        effortLevel = payloadJson.getString("effortLevel"),
                        dueAt = payloadJson.optString("dueAt").ifBlank { null },
                        createdAt = payloadJson.getString("createdAt"),
                        reps = payloadJson.getInt("reps"),
                        lapses = payloadJson.getInt("lapses"),
                        fsrsCardState = payloadJson.getString("fsrsCardState"),
                        fsrsStepIndex = payloadJson.optIntOrNull("fsrsStepIndex"),
                        fsrsStability = payloadJson.optDoubleOrNull("fsrsStability"),
                        fsrsDifficulty = payloadJson.optDoubleOrNull("fsrsDifficulty"),
                        fsrsLastReviewedAt = payloadJson.optString("fsrsLastReviewedAt").ifBlank { null },
                        fsrsScheduledDays = payloadJson.optIntOrNull("fsrsScheduledDays"),
                        deletedAt = payloadJson.optString("deletedAt").ifBlank { null }
                    )
                )
                SyncEntityType.DECK -> SyncOperationPayload.Deck(
                    DeckSyncPayload(
                        deckId = payloadJson.getString("deckId"),
                        name = payloadJson.getString("name"),
                        filterDefinition = parseDeckFilterDefinition(payloadJson.getJSONObject("filterDefinition")),
                        createdAt = payloadJson.getString("createdAt"),
                        deletedAt = payloadJson.optString("deletedAt").ifBlank { null }
                    )
                )
                SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> SyncOperationPayload.WorkspaceSchedulerSettings(
                    WorkspaceSchedulerSettingsSyncPayload(
                        algorithm = payloadJson.getString("algorithm"),
                        desiredRetention = payloadJson.getDouble("desiredRetention"),
                        learningStepsMinutes = payloadJson.getJSONArray("learningStepsMinutes").toIntList(),
                        relearningStepsMinutes = payloadJson.getJSONArray("relearningStepsMinutes").toIntList(),
                        maximumIntervalDays = payloadJson.getInt("maximumIntervalDays"),
                        enableFuzz = payloadJson.getBoolean("enableFuzz")
                    )
                )
                SyncEntityType.REVIEW_EVENT -> SyncOperationPayload.ReviewEvent(
                    ReviewEventSyncPayload(
                        reviewEventId = payloadJson.getString("reviewEventId"),
                        cardId = payloadJson.getString("cardId"),
                        deviceId = payloadJson.getString("deviceId"),
                        clientEventId = payloadJson.getString("clientEventId"),
                        rating = payloadJson.getInt("rating"),
                        reviewedAtClient = payloadJson.getString("reviewedAtClient")
                    )
                )
            }
        )
    }
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

private fun parseEffortLevel(rawValue: String): EffortLevel {
    return when (rawValue) {
        "fast" -> EffortLevel.FAST
        "medium" -> EffortLevel.MEDIUM
        "long" -> EffortLevel.LONG
        else -> throw IllegalArgumentException("Unsupported effort level: $rawValue")
    }
}

private fun parseFsrsCardState(rawValue: String): FsrsCardState {
    return when (rawValue) {
        "new" -> FsrsCardState.NEW
        "learning" -> FsrsCardState.LEARNING
        "review" -> FsrsCardState.REVIEW
        "relearning" -> FsrsCardState.RELEARNING
        else -> throw IllegalArgumentException("Unsupported FSRS card state: $rawValue")
    }
}

private fun parseDeckFilterDefinition(jsonObject: JSONObject): DeckFilterDefinition {
    val effortLevels = jsonObject.optJSONArray("effortLevels")?.toStringList()?.map(::parseEffortLevel) ?: emptyList()
    val tags = jsonObject.optJSONArray("tags")?.toStringList() ?: emptyList()
    return buildDeckFilterDefinition(
        effortLevels = effortLevels,
        tags = tags
    ).copy(version = jsonObject.optInt("version", 2))
}

private fun JSONArray.toStringList(): List<String> {
    return buildList {
        for (index in 0 until length()) {
            add(getString(index))
        }
    }
}

private fun JSONArray.toIntList(): List<Int> {
    return buildList {
        for (index in 0 until length()) {
            add(getInt(index))
        }
    }
}

private fun JSONObject.optIntOrNull(key: String): Int? {
    return if (has(key) && isNull(key).not()) {
        getInt(key)
    } else {
        null
    }
}

private fun JSONObject.optDoubleOrNull(key: String): Double? {
    return if (has(key) && isNull(key).not()) {
        getDouble(key)
    } else {
        null
    }
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
