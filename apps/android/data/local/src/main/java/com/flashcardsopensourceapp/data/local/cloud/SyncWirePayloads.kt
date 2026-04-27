package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.CardSyncPayload
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSyncPayload
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewEventSyncPayload
import com.flashcardsopensourceapp.data.local.model.SyncAction
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncOperation
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettingsSyncPayload
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.decodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import org.json.JSONArray
import org.json.JSONObject

internal fun buildCardOutboxPayloadJson(card: CardEntity, tags: List<String>): JSONObject {
    return JSONObject()
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
}

internal fun buildDeckOutboxPayloadJson(deck: DeckEntity): JSONObject {
    return JSONObject()
        .put("deckId", deck.deckId)
        .put("name", deck.name)
        .put("filterDefinition", JSONObject(deck.filterDefinitionJson))
        .put("createdAt", formatIsoTimestamp(deck.createdAtMillis))
        .putNullableString("deletedAt", deck.deletedAtMillis?.let(::formatIsoTimestamp))
}

internal fun buildWorkspaceSchedulerSettingsOutboxPayloadJson(
    settings: WorkspaceSchedulerSettingsEntity
): JSONObject {
    return JSONObject()
        .put("algorithm", settings.algorithm)
        .put("desiredRetention", settings.desiredRetention)
        .put("learningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.learningStepsMinutesJson)))
        .put("relearningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.relearningStepsMinutesJson)))
        .put("maximumIntervalDays", settings.maximumIntervalDays)
        .put("enableFuzz", settings.enableFuzz)
}

internal fun buildReviewEventOutboxPayloadJson(reviewLog: ReviewLogEntity): JSONObject {
    return JSONObject()
        .put("reviewEventId", reviewLog.reviewLogId)
        .put("cardId", reviewLog.cardId)
        .put("clientEventId", reviewLog.clientEventId)
        .put("rating", reviewLog.rating.ordinal)
        .put("reviewedAtClient", formatIsoTimestamp(reviewLog.reviewedAtMillis))
}

internal fun buildCardBootstrapEntryJson(
    card: CardSummary,
    lastOperationId: String
): JSONObject {
    return JSONObject()
        .put("entityType", "card")
        .put("entityId", card.cardId)
        .put("action", "upsert")
        .put(
            "payload",
            JSONObject()
                .put("cardId", card.cardId)
                .put("frontText", card.frontText)
                .put("backText", card.backText)
                .put("tags", JSONArray(card.tags))
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
                .put("clientUpdatedAt", formatIsoTimestamp(card.updatedAtMillis))
                .put("lastOperationId", lastOperationId)
                .put("updatedAt", formatIsoTimestamp(card.updatedAtMillis))
                .putNullableString("deletedAt", card.deletedAtMillis?.let(::formatIsoTimestamp))
        )
}

internal fun buildDeckBootstrapEntryJson(
    deck: DeckEntity,
    lastOperationId: String
): JSONObject {
    return JSONObject()
        .put("entityType", "deck")
        .put("entityId", deck.deckId)
        .put("action", "upsert")
        .put(
            "payload",
            JSONObject()
                .put("deckId", deck.deckId)
                .put("workspaceId", deck.workspaceId)
                .put("name", deck.name)
                .put("filterDefinition", JSONObject(deck.filterDefinitionJson))
                .put("createdAt", formatIsoTimestamp(deck.createdAtMillis))
                .put("clientUpdatedAt", formatIsoTimestamp(deck.updatedAtMillis))
                .put("lastOperationId", lastOperationId)
                .put("updatedAt", formatIsoTimestamp(deck.updatedAtMillis))
                .putNullableString("deletedAt", deck.deletedAtMillis?.let(::formatIsoTimestamp))
        )
}

internal fun buildWorkspaceSchedulerSettingsBootstrapEntryJson(
    workspaceId: String,
    settings: WorkspaceSchedulerSettingsEntity,
    lastOperationId: String
): JSONObject {
    return JSONObject()
        .put("entityType", "workspace_scheduler_settings")
        .put("entityId", workspaceId)
        .put("action", "upsert")
        .put(
            "payload",
            JSONObject()
                .put("algorithm", settings.algorithm)
                .put("desiredRetention", settings.desiredRetention)
                .put("learningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.learningStepsMinutesJson)))
                .put("relearningStepsMinutes", JSONArray(decodeSchedulerStepListJson(settings.relearningStepsMinutesJson)))
                .put("maximumIntervalDays", settings.maximumIntervalDays)
                .put("enableFuzz", settings.enableFuzz)
                .put("clientUpdatedAt", formatIsoTimestamp(settings.updatedAtMillis))
                .put("lastOperationId", lastOperationId)
                .put("updatedAt", formatIsoTimestamp(settings.updatedAtMillis))
        )
}

internal fun buildReviewHistoryImportEventJson(reviewLog: ReviewLogEntity): JSONObject {
    return JSONObject()
        .put("reviewEventId", reviewLog.reviewLogId)
        .put("workspaceId", reviewLog.workspaceId)
        .put("cardId", reviewLog.cardId)
        .put("clientEventId", reviewLog.clientEventId)
        .put("rating", reviewLog.rating.ordinal)
        .put("reviewedAtClient", formatIsoTimestamp(reviewLog.reviewedAtMillis))
        .put("reviewedAtServer", reviewLog.reviewedAtServerIso)
}

internal fun decodeOutboxOperation(entry: OutboxEntryEntity): SyncOperation {
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

internal fun parseSyncEntityType(rawValue: String): SyncEntityType {
    return when (rawValue) {
        "card" -> SyncEntityType.CARD
        "deck" -> SyncEntityType.DECK
        "workspace_scheduler_settings" -> SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS
        "review_event" -> SyncEntityType.REVIEW_EVENT
        else -> throw IllegalArgumentException("Unsupported sync entity type: $rawValue")
    }
}

internal fun parseSyncAction(rawValue: String): SyncAction {
    return when (rawValue) {
        "upsert" -> SyncAction.UPSERT
        "append" -> SyncAction.APPEND
        else -> throw IllegalArgumentException("Unsupported sync action: $rawValue")
    }
}

internal fun SyncEntityType.toRemoteValue(): String {
    return when (this) {
        SyncEntityType.CARD -> "card"
        SyncEntityType.DECK -> "deck"
        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> "workspace_scheduler_settings"
        SyncEntityType.REVIEW_EVENT -> "review_event"
    }
}

internal fun SyncAction.toRemoteValue(): String {
    return when (this) {
        SyncAction.UPSERT -> "upsert"
        SyncAction.APPEND -> "append"
    }
}

internal fun parseEffortLevel(rawValue: String, fieldPath: String): EffortLevel {
    return when (rawValue) {
        "fast" -> EffortLevel.FAST
        "medium" -> EffortLevel.MEDIUM
        "long" -> EffortLevel.LONG
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [fast, medium, long], got invalid string \"$rawValue\""
        )
    }
}

internal fun parseFsrsCardState(rawValue: String, fieldPath: String): FsrsCardState {
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

internal fun parseDeckFilterDefinition(jsonObject: JSONObject, fieldPath: String): DeckFilterDefinition {
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

internal fun toCardSummary(card: CardWithRelations): CardSummary {
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
