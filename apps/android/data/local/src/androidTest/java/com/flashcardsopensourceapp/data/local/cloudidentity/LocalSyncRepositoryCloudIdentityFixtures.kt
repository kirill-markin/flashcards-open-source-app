package com.flashcardsopensourceapp.data.local.cloudidentity

import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudSyncConflictDetails
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import org.json.JSONArray
import org.json.JSONObject

internal fun createSyncWorkspaceForkRequiredError(
    path: String,
    requestId: String,
    entityType: SyncEntityType,
    entityId: String
): CloudRemoteException {
    val remoteEntityType = when (entityType) {
        SyncEntityType.CARD -> "card"
        SyncEntityType.DECK -> "deck"
        SyncEntityType.REVIEW_EVENT -> "review_event"
        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> "workspace_scheduler_settings"
    }
    return CloudRemoteException(
        message = "Cloud request failed with status 409 for $path",
        statusCode = 409,
        responseBody = JSONObject()
            .put("code", syncWorkspaceForkRequiredErrorCode)
            .put("requestId", requestId)
            .put(
                "details",
                JSONObject().put(
                    "syncConflict",
                    JSONObject()
                        .put("entityType", remoteEntityType)
                        .put("entityId", entityId)
                        .put("recoverable", true)
                )
            )
            .toString(),
        errorCode = syncWorkspaceForkRequiredErrorCode,
        requestId = requestId,
        syncConflict = CloudSyncConflictDetails(
            entityType = entityType,
            entityId = entityId,
            entryIndex = null,
            reviewEventIndex = null,
            recoverable = true,
            conflictingWorkspaceId = null,
            remoteIsEmpty = null
        )
    )
}

internal fun createSyncCardOutboxEntry(
    outboxEntryId: String,
    workspaceId: String,
    installationId: String,
    card: CardEntity,
    createdAtMillis: Long
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = installationId,
        entityType = "card",
        entityId = card.cardId,
        operationType = "upsert",
        payloadJson = JSONObject()
            .put("cardId", card.cardId)
            .put("frontText", card.frontText)
            .put("backText", card.backText)
            .put("tags", JSONArray())
            .put("effortLevel", "medium")
            .put("dueAt", JSONObject.NULL)
            .put("createdAt", "2026-04-02T15:50:57.000Z")
            .put("reps", card.reps)
            .put("lapses", card.lapses)
            .put("fsrsCardState", "new")
            .put("fsrsStepIndex", JSONObject.NULL)
            .put("fsrsStability", JSONObject.NULL)
            .put("fsrsDifficulty", JSONObject.NULL)
            .put("fsrsLastReviewedAt", JSONObject.NULL)
            .put("fsrsScheduledDays", JSONObject.NULL)
            .put("deletedAt", JSONObject.NULL)
            .toString(),
        clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
        createdAtMillis = createdAtMillis,
        attemptCount = 0,
        lastError = null
    )
}
