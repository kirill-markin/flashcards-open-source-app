package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import org.json.JSONArray
import org.json.JSONObject

/*
 Keep Android sync wire payloads aligned with:
 - apps/backend/src/sync.ts
 - apps/ios/Flashcards/Flashcards/CloudSync/CloudSyncContracts.swift
 */

data class RemoteSyncChange(
    val changeId: Long,
    val entityType: SyncEntityType,
    val entityId: String,
    val action: String,
    val payload: JSONObject
)

data class RemoteBootstrapEntry(
    val entityType: SyncEntityType,
    val entityId: String,
    val action: String,
    val payload: JSONObject
)

data class RemotePullResponse(
    val changes: List<RemoteSyncChange>,
    val nextHotChangeId: Long,
    val hasMore: Boolean
)

data class RemoteBootstrapPullResponse(
    val entries: List<RemoteBootstrapEntry>,
    val nextCursor: String?,
    val hasMore: Boolean,
    val bootstrapHotChangeId: Long,
    val remoteIsEmpty: Boolean
)

data class RemoteBootstrapPushResponse(
    val appliedEntriesCount: Int,
    val bootstrapHotChangeId: Long?
)

data class RemoteReviewHistoryEvent(
    val reviewEventId: String,
    val workspaceId: String,
    val cardId: String,
    val replicaId: String,
    val clientEventId: String,
    val rating: Int,
    val reviewedAtClient: String,
    val reviewedAtServer: String
)

data class RemoteReviewHistoryPullResponse(
    val reviewEvents: List<RemoteReviewHistoryEvent>,
    val nextReviewSequenceId: Long,
    val hasMore: Boolean
)

data class RemoteReviewHistoryImportResponse(
    val importedCount: Int,
    val duplicateCount: Int,
    val nextReviewSequenceId: Long?
)

data class RemotePushOperationResult(
    val operationId: String,
    val resultingHotChangeId: Long?
)

data class RemotePushResponse(
    val operations: List<RemotePushOperationResult>
)

internal class CloudSyncRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/push",
            authorizationHeader = authorizationHeader,
            body = body
        )
        return parseRemotePushResponse(response = response)
    }

    suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/pull",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemotePullResponse(
            changes = parseHotChanges(response.requireCloudArray("changes", "pull.changes")),
            nextHotChangeId = response.requireCloudLong("nextHotChangeId", "pull.nextHotChangeId"),
            hasMore = response.requireCloudBoolean("hasMore", "pull.hasMore")
        )
    }

    suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/bootstrap",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteBootstrapPullResponse(
            entries = parseBootstrapEntries(response.requireCloudArray("entries", "bootstrap.entries")),
            nextCursor = response.requireCloudNullableString("nextCursor", "bootstrap.nextCursor"),
            hasMore = response.requireCloudBoolean("hasMore", "bootstrap.hasMore"),
            bootstrapHotChangeId = response.requireCloudLong("bootstrapHotChangeId", "bootstrap.bootstrapHotChangeId"),
            remoteIsEmpty = response.requireCloudBoolean("remoteIsEmpty", "bootstrap.remoteIsEmpty")
        )
    }

    suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/bootstrap",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteBootstrapPushResponse(
            appliedEntriesCount = response.requireCloudInt("appliedEntriesCount", "bootstrapPush.appliedEntriesCount"),
            bootstrapHotChangeId = response.optCloudLongOrNull("bootstrapHotChangeId", "bootstrapPush.bootstrapHotChangeId")
        )
    }

    suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/review-history/pull",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteReviewHistoryPullResponse(
            reviewEvents = parseReviewHistoryEvents(response.requireCloudArray("reviewEvents", "reviewHistoryPull.reviewEvents")),
            nextReviewSequenceId = response.requireCloudLong("nextReviewSequenceId", "reviewHistoryPull.nextReviewSequenceId"),
            hasMore = response.requireCloudBoolean("hasMore", "reviewHistoryPull.hasMore")
        )
    }

    suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/review-history/import",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteReviewHistoryImportResponse(
            importedCount = response.requireCloudInt("importedCount", "reviewHistoryImport.importedCount"),
            duplicateCount = response.requireCloudInt("duplicateCount", "reviewHistoryImport.duplicateCount"),
            nextReviewSequenceId = response.optCloudLongOrNull("nextReviewSequenceId", "reviewHistoryImport.nextReviewSequenceId")
        )
    }
}

internal fun parseRemotePushResponse(response: JSONObject): RemotePushResponse {
    val operations = response.requireCloudArray("operations", "push.operations")
    return RemotePushResponse(
        operations = buildList {
            for (index in 0 until operations.length()) {
                val entry = operations.requireCloudObject(index, "push.operations[$index]")
                val status = entry.requireCloudString("status", "push.operations[$index].status")
                if (isAcknowledgedPushStatus(status = status).not()) {
                    throw CloudRemoteException(
                        message = "Cloud push failed for operation ${entry.requireCloudString("operationId", "push.operations[$index].operationId")}: ${entry.optCloudStringOrNull("error", "push.operations[$index].error").orEmpty()}",
                        statusCode = 200,
                        responseBody = response.toString(),
                        errorCode = null,
                        requestId = null,
                        syncConflict = null
                    )
                }
                add(
                    RemotePushOperationResult(
                        operationId = entry.requireCloudString("operationId", "push.operations[$index].operationId"),
                        resultingHotChangeId = entry.optCloudLongOrNull(
                            "resultingHotChangeId",
                            "push.operations[$index].resultingHotChangeId"
                        )
                    )
                )
            }
        }
    )
}

private fun parseHotChanges(changes: JSONArray): List<RemoteSyncChange> {
    return buildList {
        for (index in 0 until changes.length()) {
            val change = changes.requireCloudObject(index, "pull.changes[$index]")
            add(
                RemoteSyncChange(
                    changeId = change.requireCloudLong("changeId", "pull.changes[$index].changeId"),
                    entityType = parseRemoteSyncEntityType(
                        rawValue = change.requireCloudString("entityType", "pull.changes[$index].entityType"),
                        fieldPath = "pull.changes[$index].entityType"
                    ),
                    entityId = change.requireCloudString("entityId", "pull.changes[$index].entityId"),
                    action = change.requireCloudString("action", "pull.changes[$index].action"),
                    payload = change.requireCloudObject("payload", "pull.changes[$index].payload")
                )
            )
        }
    }
}

private fun parseBootstrapEntries(entries: JSONArray): List<RemoteBootstrapEntry> {
    return buildList {
        for (index in 0 until entries.length()) {
            val entry = entries.requireCloudObject(index, "bootstrap.entries[$index]")
            add(
                RemoteBootstrapEntry(
                    entityType = parseRemoteSyncEntityType(
                        rawValue = entry.requireCloudString("entityType", "bootstrap.entries[$index].entityType"),
                        fieldPath = "bootstrap.entries[$index].entityType"
                    ),
                    entityId = entry.requireCloudString("entityId", "bootstrap.entries[$index].entityId"),
                    action = entry.requireCloudString("action", "bootstrap.entries[$index].action"),
                    payload = entry.requireCloudObject("payload", "bootstrap.entries[$index].payload")
                )
            )
        }
    }
}

private fun parseReviewHistoryEvents(events: JSONArray): List<RemoteReviewHistoryEvent> {
    return buildList {
        for (index in 0 until events.length()) {
            val event = events.requireCloudObject(index, "reviewHistoryPull.reviewEvents[$index]")
            add(
                RemoteReviewHistoryEvent(
                    reviewEventId = event.requireCloudString(
                        "reviewEventId",
                        "reviewHistoryPull.reviewEvents[$index].reviewEventId"
                    ),
                    workspaceId = event.requireCloudString(
                        "workspaceId",
                        "reviewHistoryPull.reviewEvents[$index].workspaceId"
                    ),
                    cardId = event.requireCloudString("cardId", "reviewHistoryPull.reviewEvents[$index].cardId"),
                    replicaId = event.requireCloudString("replicaId", "reviewHistoryPull.reviewEvents[$index].replicaId"),
                    clientEventId = event.requireCloudString(
                        "clientEventId",
                        "reviewHistoryPull.reviewEvents[$index].clientEventId"
                    ),
                    rating = event.requireCloudInt("rating", "reviewHistoryPull.reviewEvents[$index].rating"),
                    reviewedAtClient = event.requireCloudString(
                        "reviewedAtClient",
                        "reviewHistoryPull.reviewEvents[$index].reviewedAtClient"
                    ),
                    reviewedAtServer = event.requireCloudString(
                        "reviewedAtServer",
                        "reviewHistoryPull.reviewEvents[$index].reviewedAtServer"
                    )
                )
            )
        }
    }
}

private fun parseRemoteSyncEntityType(rawValue: String, fieldPath: String): SyncEntityType {
    return when (rawValue) {
        "card" -> SyncEntityType.CARD
        "deck" -> SyncEntityType.DECK
        "workspace_scheduler_settings" -> SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS
        "review_event" -> SyncEntityType.REVIEW_EVENT
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [card, deck, workspace_scheduler_settings, review_event], got invalid string \"$rawValue\""
        )
    }
}

private fun isAcknowledgedPushStatus(status: String): Boolean {
    return status == "applied" || status == "duplicate" || status == "ignored"
}
