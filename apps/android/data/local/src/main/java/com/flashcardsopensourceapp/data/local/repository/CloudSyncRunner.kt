package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.putNullableDouble
import com.flashcardsopensourceapp.data.local.cloud.putNullableInt
import com.flashcardsopensourceapp.data.local.cloud.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.PersistedOutboxEntry
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinitionJsonObject
import kotlinx.coroutines.CancellationException
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
    val blockedMessage = syncLocalStore.loadBlockedSyncMessage(
        workspaceId = workspaceId,
        installationId = cloudSettings.installationId
    )
    if (blockedMessage != null) {
        throw CloudSyncBlockedException(message = blockedMessage, cause = null)
    }
    syncLocalStore.recordSyncAttempt(workspaceId)
    try {
        val bootstrapState = runBootstrapHydrationWithForkRecovery(
            cloudSettings = cloudSettings,
            workspaceId = workspaceId,
            syncSession = syncSession,
            appVersion = appVersion,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore
        )
        var lastHotCursor = bootstrapState.lastHotCursor
        var lastReviewSequenceId = bootstrapState.lastReviewSequenceId
        val hasHydratedHotState = bootstrapState.hasHydratedHotState
        val hasHydratedReviewHistory = bootstrapState.hasHydratedReviewHistory

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

        lastReviewSequenceId = pullAndApplyReviewHistoryBatch(
            cloudSettings = cloudSettings,
            workspaceId = workspaceId,
            syncSession = syncSession,
            appVersion = appVersion,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            startingReviewSequenceId = lastReviewSequenceId
        )

        syncLocalStore.markSyncSuccess(
            workspaceId = workspaceId,
            lastSyncCursor = lastHotCursor.toString(),
            lastReviewSequenceId = lastReviewSequenceId,
            hasHydratedHotState = hasHydratedHotState,
            hasHydratedReviewHistory = hasHydratedReviewHistory
        )
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        if (error is CloudSyncBlockedException || isCloudIdentityConflictError(error = error)) {
            syncLocalStore.markSyncBlocked(
                workspaceId = workspaceId,
                installationId = cloudSettings.installationId,
                errorMessage = error.message ?: "Cloud sync is blocked for this installation."
            )
        }
        throw error
    }
}

internal data class CloudSyncSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

private data class BootstrapHydrationState(
    val lastHotCursor: Long,
    val lastReviewSequenceId: Long,
    val hasHydratedHotState: Boolean,
    val hasHydratedReviewHistory: Boolean
)

private enum class WorkspaceForkRecoveryStage(
    val label: String
) {
    BOOTSTRAP_PUSH(label = "bootstrap push"),
    REVIEW_HISTORY_IMPORT(label = "review history import")
}

internal class CloudSyncBlockedException(
    message: String,
    cause: Throwable?
) : Exception(message, cause)

private suspend fun runBootstrapHydrationWithForkRecovery(
    cloudSettings: CloudSettings,
    workspaceId: String,
    syncSession: CloudSyncSession,
    appVersion: String,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore
): BootstrapHydrationState {
    var recoveryAttempted = false

    while (true) {
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
                body = buildInitialBootstrapPullRequest(
                    installationId = cloudSettings.installationId,
                    appVersion = appVersion,
                    limit = bootstrapPageLimit
                )
            )

            if (bootstrapResponse.remoteIsEmpty) {
                val bootstrapEntries = syncLocalStore.buildBootstrapEntries(workspaceId)
                if (bootstrapEntries.length() > 0) {
                    try {
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
                    } catch (error: Exception) {
                        if (
                            recoverWorkspaceForkConflictIfNeeded(
                                cloudSettings = cloudSettings,
                                workspaceId = workspaceId,
                                syncSession = syncSession,
                                appVersion = appVersion,
                                remoteService = remoteService,
                                syncLocalStore = syncLocalStore,
                                error = error,
                                stage = WorkspaceForkRecoveryStage.BOOTSTRAP_PUSH,
                                recoveryAttempted = recoveryAttempted
                            )
                        ) {
                            recoveryAttempted = true
                            syncLocalStore.recordSyncAttempt(workspaceId = workspaceId)
                            continue
                        }
                        throw error
                    }
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
                        body = buildPagedBootstrapPullRequest(
                            installationId = cloudSettings.installationId,
                            appVersion = appVersion,
                            cursor = nextCursor,
                            limit = bootstrapPageLimit
                        )
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
                    try {
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
                    } catch (error: Exception) {
                        if (
                            recoverWorkspaceForkConflictIfNeeded(
                                cloudSettings = cloudSettings,
                                workspaceId = workspaceId,
                                syncSession = syncSession,
                                appVersion = appVersion,
                                remoteService = remoteService,
                                syncLocalStore = syncLocalStore,
                                error = error,
                                stage = WorkspaceForkRecoveryStage.REVIEW_HISTORY_IMPORT,
                                recoveryAttempted = recoveryAttempted
                            )
                        ) {
                            recoveryAttempted = true
                            syncLocalStore.recordSyncAttempt(workspaceId = workspaceId)
                            continue
                        }
                        throw error
                    }
                }
            } else {
                lastReviewSequenceId = pullAndApplyReviewHistoryBatch(
                    cloudSettings = cloudSettings,
                    workspaceId = workspaceId,
                    syncSession = syncSession,
                    appVersion = appVersion,
                    remoteService = remoteService,
                    syncLocalStore = syncLocalStore,
                    startingReviewSequenceId = lastReviewSequenceId
                )
            }

            hasHydratedReviewHistory = true
        }

        return BootstrapHydrationState(
            lastHotCursor = lastHotCursor,
            lastReviewSequenceId = lastReviewSequenceId,
            hasHydratedHotState = hasHydratedHotState,
            hasHydratedReviewHistory = hasHydratedReviewHistory
        )
    }
}

private suspend fun pullAndApplyReviewHistoryBatch(
    cloudSettings: CloudSettings,
    workspaceId: String,
    syncSession: CloudSyncSession,
    appVersion: String,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore,
    startingReviewSequenceId: Long
): Long {
    var lastReviewSequenceId = startingReviewSequenceId
    syncLocalStore.beginReviewHistoryChangeBatch()
    try {
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
        syncLocalStore.flushReviewHistoryChangeBatch()
        return lastReviewSequenceId
    } catch (error: Exception) {
        syncLocalStore.discardReviewHistoryChangeBatch()
        throw error
    }
}

private suspend fun recoverWorkspaceForkConflictIfNeeded(
    cloudSettings: CloudSettings,
    workspaceId: String,
    syncSession: CloudSyncSession,
    appVersion: String,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore,
    error: Exception,
    stage: WorkspaceForkRecoveryStage,
    recoveryAttempted: Boolean
): Boolean {
    if (error !is CloudRemoteException || error.errorCode != syncWorkspaceForkRequiredErrorCode) {
        return false
    }
    if (recoveryAttempted) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "automatic workspace identity fork already ran once in this sync attempt and the backend still requires another fork.",
                requestId = error.requestId
            ),
            cause = error
        )
    }

    val remoteEmptyProbe = remoteService.bootstrapPull(
        apiBaseUrl = syncSession.apiBaseUrl,
        authorizationHeader = syncSession.authorizationHeader,
        workspaceId = workspaceId,
        body = buildInitialBootstrapPullRequest(
            installationId = cloudSettings.installationId,
            appVersion = appVersion,
            limit = 1
        )
    )
    if (remoteEmptyProbe.remoteIsEmpty.not()) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "backend requested a workspace identity fork, but the remote workspace is not empty.",
                requestId = error.requestId
            ),
            cause = error
        )
    }

    val sourceWorkspaceId = requireNotNull(error.syncConflict?.conflictingWorkspaceId) {
        "Cloud sync ${stage.label} cannot recover workspace '$workspaceId' because the backend did not provide syncConflict.conflictingWorkspaceId."
    }
    syncLocalStore.forkWorkspaceIdentity(
        currentLocalWorkspaceId = workspaceId,
        sourceWorkspaceId = sourceWorkspaceId,
        destinationWorkspaceId = workspaceId
    )
    return true
}

private fun buildInitialBootstrapPullRequest(
    installationId: String,
    appVersion: String,
    limit: Int
): JSONObject {
    return JSONObject()
        .put("mode", "pull")
        .put("installationId", installationId)
        .put("platform", androidClientPlatform)
        .put("appVersion", appVersion)
        .put("cursor", JSONObject.NULL)
        .put("limit", limit)
}

private fun buildPagedBootstrapPullRequest(
    installationId: String,
    appVersion: String,
    cursor: String,
    limit: Int
): JSONObject {
    return JSONObject()
        .put("mode", "pull")
        .put("installationId", installationId)
        .put("platform", androidClientPlatform)
        .put("appVersion", appVersion)
        .put("cursor", cursor)
        .put("limit", limit)
}

private fun buildWorkspaceForkBlockedMessage(
    workspaceId: String,
    stage: WorkspaceForkRecoveryStage,
    reason: String,
    requestId: String?
): String {
    val baseMessage = "Cloud sync ${stage.label} is blocked for workspace '$workspaceId': $reason"
    val normalizedRequestId = requestId?.trim().orEmpty()
    return if (normalizedRequestId.isEmpty()) {
        baseMessage
    } else {
        "$baseMessage Reference: $normalizedRequestId"
    }
}

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
