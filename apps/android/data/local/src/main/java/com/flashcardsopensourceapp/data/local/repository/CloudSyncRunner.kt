package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.putNullableDouble
import com.flashcardsopensourceapp.data.local.cloud.putNullableInt
import com.flashcardsopensourceapp.data.local.cloud.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.PersistedOutboxEntry
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinitionJsonObject
import org.json.JSONArray
import org.json.JSONObject

private const val syncPullPageLimit: Int = 200
private const val bootstrapPageLimit: Int = 200
internal const val androidClientPlatform: String = "android"

internal suspend fun runCloudSyncCore(
    cloudSettings: CloudSettings,
    workspaceId: String,
    syncSession: CloudSyncSession,
    appVersion: String,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore
) {
    syncLocalStore.recordSyncAttempt(workspaceId)
    val syncState = syncLocalStore.ensureSyncState(workspaceId)
    var lastHotCursor = syncState.lastSyncCursor?.toLongOrNull() ?: 0L
    var lastReviewSequenceId = syncState.lastReviewSequenceId
    var hasHydratedHotState = syncState.hasHydratedHotState
    var hasHydratedReviewHistory = syncState.hasHydratedReviewHistory
    var bootstrapResponse: RemoteBootstrapPullResponse? = null

    if (hasHydratedHotState.not()) {
        bootstrapResponse = remoteService.bootstrapPull(
            apiBaseUrl = syncSession.apiBaseUrl,
            authorizationHeader = syncSession.authorizationHeader,
            workspaceId = workspaceId,
            body = JSONObject()
                .put("mode", "pull")
                .put("installationId", cloudSettings.installationId)
                .put("platform", androidClientPlatform)
                .put("appVersion", appVersion)
                .put("cursor", JSONObject.NULL)
                .put("limit", bootstrapPageLimit)
        )

        if (bootstrapResponse.remoteIsEmpty) {
            val bootstrapEntries = syncLocalStore.buildBootstrapEntries(workspaceId)
            if (bootstrapEntries.length() > 0) {
                val bootstrapPushResponse = remoteService.bootstrapPush(
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("mode", "push")
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", androidClientPlatform)
                        .put("appVersion", appVersion)
                        .put("entries", bootstrapEntries)
                )
                lastHotCursor = bootstrapPushResponse.bootstrapHotChangeId ?: lastHotCursor
            }
        } else {
            syncLocalStore.applyBootstrapEntries(workspaceId, bootstrapResponse.entries)
            lastHotCursor = bootstrapResponse.bootstrapHotChangeId
            var nextCursor = bootstrapResponse.nextCursor

            while (bootstrapResponse.hasMore && nextCursor != null) {
                val nextPage = remoteService.bootstrapPull(
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("mode", "pull")
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", androidClientPlatform)
                        .put("appVersion", appVersion)
                        .put("cursor", nextCursor)
                        .put("limit", bootstrapPageLimit)
                )
                syncLocalStore.applyBootstrapEntries(workspaceId, nextPage.entries)
                nextCursor = nextPage.nextCursor
                lastHotCursor = nextPage.bootstrapHotChangeId
                if (nextPage.hasMore.not()) {
                    break
                }
            }
        }

        hasHydratedHotState = true
    }

    if (hasHydratedReviewHistory.not()) {
        if (bootstrapResponse?.remoteIsEmpty == true) {
            val reviewEvents = syncLocalStore.buildReviewHistoryImportEvents(workspaceId)
            if (reviewEvents.length() > 0) {
                val importResponse = remoteService.importReviewHistory(
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", androidClientPlatform)
                        .put("appVersion", appVersion)
                        .put("reviewEvents", reviewEvents)
                )
                lastReviewSequenceId = importResponse.nextReviewSequenceId ?: lastReviewSequenceId
            }
        } else {
            var hasMore = true
            while (hasMore) {
                val reviewHistoryPage = remoteService.pullReviewHistory(
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", androidClientPlatform)
                        .put("appVersion", appVersion)
                        .put("afterReviewSequenceId", lastReviewSequenceId)
                        .put("limit", syncPullPageLimit)
                )
                syncLocalStore.applyReviewHistory(reviewHistoryPage.reviewEvents)
                lastReviewSequenceId = reviewHistoryPage.nextReviewSequenceId
                hasMore = reviewHistoryPage.hasMore
            }
        }

        hasHydratedReviewHistory = true
    }

    val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId)
    if (outboxEntries.isNotEmpty()) {
        try {
            val pushResponse = remoteService.push(
                apiBaseUrl = syncSession.apiBaseUrl,
                authorizationHeader = syncSession.authorizationHeader,
                workspaceId = workspaceId,
                body = buildPushRequest(
                    installationId = cloudSettings.installationId,
                    outboxEntries = outboxEntries,
                    appVersion = appVersion
                )
            )
            syncLocalStore.deleteOutboxEntries(pushResponse.operations.map { result -> result.operationId })
            val pushCursor = pushResponse.operations.mapNotNull { result -> result.resultingHotChangeId }.maxOrNull()
            if (pushCursor != null && pushCursor > lastHotCursor) {
                lastHotCursor = pushCursor
            }
        } catch (error: Exception) {
            syncLocalStore.markOutboxEntriesFailed(
                outboxEntries.map(PersistedOutboxEntry::operationId),
                error.message ?: "Cloud push failed."
            )
            throw error
        }
    }

    var hasMoreHotChanges = true
    while (hasMoreHotChanges) {
        val pullResponse = remoteService.pull(
            apiBaseUrl = syncSession.apiBaseUrl,
            authorizationHeader = syncSession.authorizationHeader,
            workspaceId = workspaceId,
                body = JSONObject()
                    .put("installationId", cloudSettings.installationId)
                    .put("platform", androidClientPlatform)
                    .put("appVersion", appVersion)
                    .put("afterHotChangeId", lastHotCursor)
                .put("limit", syncPullPageLimit)
        )
        syncLocalStore.applyPullChanges(workspaceId, pullResponse.changes)
        lastHotCursor = pullResponse.nextHotChangeId
        hasMoreHotChanges = pullResponse.hasMore
    }

    var hasMoreReviewHistory = true
    while (hasMoreReviewHistory) {
        val reviewHistoryPage = remoteService.pullReviewHistory(
            apiBaseUrl = syncSession.apiBaseUrl,
            authorizationHeader = syncSession.authorizationHeader,
            workspaceId = workspaceId,
            body = JSONObject()
                .put("installationId", cloudSettings.installationId)
                .put("platform", androidClientPlatform)
                .put("appVersion", appVersion)
                .put("afterReviewSequenceId", lastReviewSequenceId)
                .put("limit", syncPullPageLimit)
        )
        syncLocalStore.applyReviewHistory(reviewHistoryPage.reviewEvents)
        lastReviewSequenceId = reviewHistoryPage.nextReviewSequenceId
        hasMoreReviewHistory = reviewHistoryPage.hasMore
    }

    syncLocalStore.markSyncSuccess(
        workspaceId = workspaceId,
        lastSyncCursor = lastHotCursor.toString(),
        lastReviewSequenceId = lastReviewSequenceId,
        hasHydratedHotState = hasHydratedHotState,
        hasHydratedReviewHistory = hasHydratedReviewHistory
    )
}

internal data class CloudSyncSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

private fun buildPushRequest(
    installationId: String,
    outboxEntries: List<PersistedOutboxEntry>,
    appVersion: String
): JSONObject {
    return JSONObject()
        .put("installationId", installationId)
        .put("platform", androidClientPlatform)
        .put("appVersion", appVersion)
        .put(
            "operations",
            JSONArray().apply {
                outboxEntries.forEach { entry ->
                    put(
                        JSONObject()
                            .put("operationId", entry.operation.operationId)
                            .put("entityType", entry.operation.entityType.toRemoteValue())
                            .put("entityId", entry.operation.entityId)
                            .put("action", entry.operation.action.toRemoteValue())
                            .put("clientUpdatedAt", entry.operation.clientUpdatedAt)
                            .put("payload", buildOperationPayload(entry.operation.payload))
                    )
                }
            }
        )
}

private fun buildOperationPayload(payload: SyncOperationPayload): JSONObject {
    return when (payload) {
        is SyncOperationPayload.Card -> JSONObject()
            .put("cardId", payload.payload.cardId)
            .put("frontText", payload.payload.frontText)
            .put("backText", payload.payload.backText)
            .put("tags", JSONArray(payload.payload.tags))
            .put("effortLevel", payload.payload.effortLevel)
            .putNullableString("dueAt", payload.payload.dueAt)
            .put("createdAt", payload.payload.createdAt)
            .put("reps", payload.payload.reps)
            .put("lapses", payload.payload.lapses)
            .put("fsrsCardState", payload.payload.fsrsCardState)
            .putNullableInt("fsrsStepIndex", payload.payload.fsrsStepIndex)
            .putNullableDouble("fsrsStability", payload.payload.fsrsStability)
            .putNullableDouble("fsrsDifficulty", payload.payload.fsrsDifficulty)
            .putNullableString("fsrsLastReviewedAt", payload.payload.fsrsLastReviewedAt)
            .putNullableInt("fsrsScheduledDays", payload.payload.fsrsScheduledDays)
            .putNullableString("deletedAt", payload.payload.deletedAt)

        is SyncOperationPayload.Deck -> JSONObject()
            .put("deckId", payload.payload.deckId)
            .put("name", payload.payload.name)
            .put("filterDefinition", buildDeckFilterDefinitionJson(payload.payload.filterDefinition))
            .put("createdAt", payload.payload.createdAt)
            .putNullableString("deletedAt", payload.payload.deletedAt)

        is SyncOperationPayload.WorkspaceSchedulerSettings -> JSONObject()
            .put("algorithm", payload.payload.algorithm)
            .put("desiredRetention", payload.payload.desiredRetention)
            .put("learningStepsMinutes", JSONArray(payload.payload.learningStepsMinutes))
            .put("relearningStepsMinutes", JSONArray(payload.payload.relearningStepsMinutes))
            .put("maximumIntervalDays", payload.payload.maximumIntervalDays)
            .put("enableFuzz", payload.payload.enableFuzz)

        is SyncOperationPayload.ReviewEvent -> JSONObject()
            .put("reviewEventId", payload.payload.reviewEventId)
            .put("cardId", payload.payload.cardId)
            .put("clientEventId", payload.payload.clientEventId)
            .put("rating", payload.payload.rating)
            .put("reviewedAtClient", payload.payload.reviewedAtClient)
    }
}

private fun buildDeckFilterDefinitionJson(filterDefinition: com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition): JSONObject {
    return buildDeckFilterDefinitionJsonObject(filterDefinition = filterDefinition)
}

private fun com.flashcardsopensourceapp.data.local.model.SyncEntityType.toRemoteValue(): String {
    return when (this) {
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.CARD -> "card"
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.DECK -> "deck"
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> "workspace_scheduler_settings"
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.REVIEW_EVENT -> "review_event"
    }
}

private fun com.flashcardsopensourceapp.data.local.model.SyncAction.toRemoteValue(): String {
    return when (this) {
        com.flashcardsopensourceapp.data.local.model.SyncAction.UPSERT -> "upsert"
        com.flashcardsopensourceapp.data.local.model.SyncAction.APPEND -> "append"
    }
}
