package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.PendingLocalHotEntityKey
import com.flashcardsopensourceapp.data.local.cloud.putNullableDouble
import com.flashcardsopensourceapp.data.local.cloud.putNullableInt
import com.flashcardsopensourceapp.data.local.cloud.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.PersistedOutboxEntry
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinitionJsonObject
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

private const val syncPullPageLimit: Int = 200
private const val bootstrapPageLimit: Int = 200
private const val maxWorkspaceForkRecoveriesPerSync: Int = 10
internal const val androidClientPlatform: String = "android"

internal suspend fun runCloudSyncCore(
    cloudSettings: CloudSettings,
    workspaceId: String,
    syncSession: CloudSyncSession,
    appVersion: String,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore,
    workspaceForkRecoveryMode: CloudWorkspaceForkRecoveryMode
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
        var workspaceForkRecoveryState = WorkspaceForkRecoveryState(recoveredConflicts = emptySet())
        syncLoop@ while (true) {
            val bootstrapState = runBootstrapHydrationWithForkRecovery(
                cloudSettings = cloudSettings,
                workspaceId = workspaceId,
                syncSession = syncSession,
                appVersion = appVersion,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore,
                initialRecoveryState = workspaceForkRecoveryState,
                workspaceForkRecoveryMode = workspaceForkRecoveryMode
            )
            var lastHotCursor = bootstrapState.lastHotCursor
            var lastReviewSequenceId = bootstrapState.lastReviewSequenceId
            var hasHydratedHotState = bootstrapState.hasHydratedHotState
            val hasHydratedReviewHistory = bootstrapState.hasHydratedReviewHistory
            workspaceForkRecoveryState = bootstrapState.workspaceForkRecoveryState

            var outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId)
            while (outboxEntries.isNotEmpty()) {
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
                    val acknowledgedOperationIds = pushResponse.operations.map { result -> result.operationId }
                    if (bootstrapState.hasSkippedBootstrapHotRows && acknowledgedOperationIds.isEmpty()) {
                        throw IllegalStateException(
                            "Cloud push acknowledged no outbox operations while replaying skipped bootstrap rows " +
                                "for workspace '$workspaceId'."
                        )
                    }
                    syncLocalStore.deleteOutboxEntries(acknowledgedOperationIds)
                } catch (error: Exception) {
                    val recoveredState = recoverWorkspaceForkConflictIfNeeded(
                        workspaceId = workspaceId,
                        syncLocalStore = syncLocalStore,
                        error = error,
                        stage = WorkspaceForkRecoveryStage.ORDINARY_PUSH,
                        recoveryState = workspaceForkRecoveryState,
                        workspaceForkRecoveryMode = workspaceForkRecoveryMode
                    )
                    if (recoveredState != null) {
                        workspaceForkRecoveryState = recoveredState
                        syncLocalStore.recordSyncAttempt(workspaceId = workspaceId)
                        continue@syncLoop
                    }
                    syncLocalStore.markOutboxEntriesFailed(
                        outboxEntries.map(PersistedOutboxEntry::operationId),
                        error.message ?: "Cloud push failed."
                    )
                    throw error
                }
                if (bootstrapState.hasSkippedBootstrapHotRows.not()) {
                    break
                }
                outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId)
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
            if (bootstrapState.hasSkippedBootstrapHotRows) {
                hasHydratedHotState = true
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
            break
        }
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

internal enum class CloudWorkspaceForkRecoveryMode {
    ENABLED,
    DISABLED
}

private data class BootstrapHydrationState(
    val lastHotCursor: Long,
    val lastReviewSequenceId: Long,
    val hasHydratedHotState: Boolean,
    val hasHydratedReviewHistory: Boolean,
    val hasSkippedBootstrapHotRows: Boolean,
    val workspaceForkRecoveryState: WorkspaceForkRecoveryState
)

private data class ReviewHistoryImportState(
    val lastReviewSequenceId: Long,
    val workspaceForkRecoveryState: WorkspaceForkRecoveryState
)

private data class WorkspaceForkRecoveryState(
    val recoveredConflicts: Set<WorkspaceForkRecoveryKey>
)

private data class WorkspaceForkRecoveryKey(
    val entityType: SyncEntityType,
    val entityId: String
)

private enum class WorkspaceForkRecoveryStage(
    val label: String
) {
    BOOTSTRAP_PUSH(label = "bootstrap push"),
    REVIEW_HISTORY_IMPORT(label = "review history import"),
    ORDINARY_PUSH(label = "push")
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
    syncLocalStore: SyncLocalStore,
    initialRecoveryState: WorkspaceForkRecoveryState,
    workspaceForkRecoveryMode: CloudWorkspaceForkRecoveryMode
): BootstrapHydrationState {
    var recoveryState = initialRecoveryState

    while (true) {
        val syncState = syncLocalStore.ensureSyncState(workspaceId)
        var lastHotCursor = syncState.lastSyncCursor?.toLongOrNull() ?: 0L
        var lastReviewSequenceId = syncState.lastReviewSequenceId
        var hasHydratedHotState = syncState.hasHydratedHotState
        var hasHydratedReviewHistory = syncState.hasHydratedReviewHistory
        var hasPendingReviewHistoryImport = syncState.pendingReviewHistoryImport
        var skippedBootstrapHotRows = false
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
                        syncLocalStore.markReviewHistoryImportPending(workspaceId = workspaceId)
                        hasPendingReviewHistoryImport = true
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
                        val recoveredState = recoverWorkspaceForkConflictIfNeeded(
                            workspaceId = workspaceId,
                            syncLocalStore = syncLocalStore,
                            error = error,
                            stage = WorkspaceForkRecoveryStage.BOOTSTRAP_PUSH,
                            recoveryState = recoveryState,
                            workspaceForkRecoveryMode = workspaceForkRecoveryMode
                        )
                        if (recoveredState != null) {
                            recoveryState = recoveredState
                            syncLocalStore.recordSyncAttempt(workspaceId = workspaceId)
                            continue
                        }
                        throw error
                    }
                }
            } else {
                val preBootstrapHotCursor = lastHotCursor
                var latestBootstrapHotCursor = bootstrapResponse.bootstrapHotChangeId
                val appliedBootstrapHotEntityKeys: MutableSet<PendingLocalHotEntityKey> = mutableSetOf()
                val applyResult = syncLocalStore.applyBootstrapEntries(workspaceId, bootstrapResponse.entries)
                skippedBootstrapHotRows = skippedBootstrapHotRows || applyResult.skippedHotRows
                appliedBootstrapHotEntityKeys += applyResult.appliedHotEntityKeys
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
                    val nextApplyResult = syncLocalStore.applyBootstrapEntries(workspaceId, nextPage.entries)
                    skippedBootstrapHotRows = skippedBootstrapHotRows || nextApplyResult.skippedHotRows
                    appliedBootstrapHotEntityKeys += nextApplyResult.appliedHotEntityKeys
                    nextCursor = nextPage.nextCursor
                    latestBootstrapHotCursor = nextPage.bootstrapHotChangeId
                    if (nextPage.hasMore.not()) {
                        break
                    }
                }
                if (skippedBootstrapHotRows.not()) {
                    skippedBootstrapHotRows = syncLocalStore.hasPendingLocalHotRowsForAppliedBootstrapKeys(
                        workspaceId = workspaceId,
                        appliedHotEntityKeys = appliedBootstrapHotEntityKeys
                    )
                }
                lastHotCursor = if (skippedBootstrapHotRows) {
                    preBootstrapHotCursor
                } else {
                    latestBootstrapHotCursor
                }
            }

            hasHydratedHotState = skippedBootstrapHotRows.not()
        }

        if (hasHydratedReviewHistory.not()) {
            if (hasPendingReviewHistoryImport || bootstrapResponse?.remoteIsEmpty == true) {
                val importState = importReviewHistoryWithForkRecovery(
                    cloudSettings = cloudSettings,
                    workspaceId = workspaceId,
                    syncSession = syncSession,
                    appVersion = appVersion,
                    remoteService = remoteService,
                    syncLocalStore = syncLocalStore,
                    startingReviewSequenceId = lastReviewSequenceId,
                    initialRecoveryState = recoveryState,
                    workspaceForkRecoveryMode = workspaceForkRecoveryMode
                )
                lastReviewSequenceId = importState.lastReviewSequenceId
                recoveryState = importState.workspaceForkRecoveryState
                syncLocalStore.markReviewHistoryImportComplete(workspaceId = workspaceId)
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
            hasHydratedReviewHistory = hasHydratedReviewHistory,
            hasSkippedBootstrapHotRows = skippedBootstrapHotRows,
            workspaceForkRecoveryState = recoveryState
        )
    }
}

private suspend fun importReviewHistoryWithForkRecovery(
    cloudSettings: CloudSettings,
    workspaceId: String,
    syncSession: CloudSyncSession,
    appVersion: String,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore,
    startingReviewSequenceId: Long,
    initialRecoveryState: WorkspaceForkRecoveryState,
    workspaceForkRecoveryMode: CloudWorkspaceForkRecoveryMode
): ReviewHistoryImportState {
    var lastReviewSequenceId = startingReviewSequenceId
    var recoveryState = initialRecoveryState

    while (true) {
        val reviewEvents = syncLocalStore.buildReviewHistoryImportEvents(workspaceId)
        if (reviewEvents.length() == 0) {
            return ReviewHistoryImportState(
                lastReviewSequenceId = lastReviewSequenceId,
                workspaceForkRecoveryState = recoveryState
            )
        }

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
            return ReviewHistoryImportState(
                lastReviewSequenceId = lastReviewSequenceId,
                workspaceForkRecoveryState = recoveryState
            )
        } catch (error: Exception) {
            val recoveredState = recoverWorkspaceForkConflictIfNeeded(
                workspaceId = workspaceId,
                syncLocalStore = syncLocalStore,
                error = error,
                stage = WorkspaceForkRecoveryStage.REVIEW_HISTORY_IMPORT,
                recoveryState = recoveryState,
                workspaceForkRecoveryMode = workspaceForkRecoveryMode
            )
            if (recoveredState != null) {
                recoveryState = recoveredState
                syncLocalStore.recordSyncAttempt(workspaceId = workspaceId)
                continue
            }
            throw error
        }
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
    workspaceId: String,
    syncLocalStore: SyncLocalStore,
    error: Exception,
    stage: WorkspaceForkRecoveryStage,
    recoveryState: WorkspaceForkRecoveryState,
    workspaceForkRecoveryMode: CloudWorkspaceForkRecoveryMode
): WorkspaceForkRecoveryState? {
    if (error !is CloudRemoteException || error.errorCode != syncWorkspaceForkRequiredErrorCode) {
        return null
    }
    if (workspaceForkRecoveryMode == CloudWorkspaceForkRecoveryMode.DISABLED) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "automatic workspace identity fork recovery is disabled for this sync.",
                requestId = error.requestId
            ),
            cause = error
        )
    }
    val syncConflict = error.syncConflict
    if (syncConflict == null) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "backend did not provide public sync conflict details for automatic local id recovery.",
                requestId = error.requestId
            ),
            cause = error
        )
    }
    if (syncConflict.recoverable != true) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "backend did not mark sync conflict ${formatSyncConflictForMessage(syncConflict.entityType, syncConflict.entityId)} as recoverable.",
                requestId = error.requestId
            ),
            cause = error
        )
    }
    val entityType = syncConflict.entityType
    val entityId = syncConflict.entityId?.trim().orEmpty()
    if (entityType == null || entityId.isEmpty()) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "backend public sync conflict details are missing entityType or entityId.",
                requestId = error.requestId
            ),
            cause = error
        )
    }
    val recoveryKey = WorkspaceForkRecoveryKey(entityType = entityType, entityId = entityId)
    if (recoveryState.recoveredConflicts.contains(recoveryKey)) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "automatic local id recovery already repaired " +
                    "${formatSyncConflictForMessage(entityType, entityId)} in this sync attempt and the backend still reports the same conflict.",
                requestId = error.requestId
            ),
            cause = error
        )
    }
    if (recoveryState.recoveredConflicts.size >= maxWorkspaceForkRecoveriesPerSync) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "automatic local id recovery reached the limit of $maxWorkspaceForkRecoveriesPerSync distinct conflicts in this sync attempt.",
                requestId = error.requestId
            ),
            cause = error
        )
    }

    try {
        syncLocalStore.reidentifyWorkspaceForkConflictEntity(
            workspaceId = workspaceId,
            entityType = entityType,
            entityId = entityId
        )
    } catch (recoveryError: Exception) {
        throw CloudSyncBlockedException(
            message = buildWorkspaceForkBlockedMessage(
                workspaceId = workspaceId,
                stage = stage,
                reason = "automatic local id recovery failed for ${formatSyncConflictForMessage(entityType, entityId)}: " +
                    (recoveryError.message ?: recoveryError::class.java.simpleName),
                requestId = error.requestId
            ),
            cause = recoveryError
        )
    }
    return WorkspaceForkRecoveryState(
        recoveredConflicts = recoveryState.recoveredConflicts + recoveryKey
    )
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

private fun formatSyncConflictForMessage(entityType: SyncEntityType?, entityId: String?): String {
    val remoteEntityType = entityType?.toRemoteValue() ?: "unknown"
    val normalizedEntityId = entityId?.trim().orEmpty()
    return if (normalizedEntityId.isEmpty()) {
        "$remoteEntityType entity"
    } else {
        "$remoteEntityType '$normalizedEntityId'"
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
