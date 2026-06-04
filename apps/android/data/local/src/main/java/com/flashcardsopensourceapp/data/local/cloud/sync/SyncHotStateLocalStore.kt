package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.DeckEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteSyncChange
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudDoubleOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudIntOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.parseEffortLevel
import com.flashcardsopensourceapp.data.local.cloud.wire.parseFsrsCardState
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudDouble
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.cloud.wire.toCloudIntList
import com.flashcardsopensourceapp.data.local.cloud.wire.toCloudStringList
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.scheduling.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTags
import org.json.JSONObject
import java.util.UUID

internal class SyncHotStateLocalStore(
    private val database: AppDatabase
) {
    suspend fun applyPullChanges(workspaceId: String, changes: List<RemoteSyncChange>) {
        database.withTransaction {
            changes.forEachIndexed { index, change ->
                applyHotPayloadInTransaction(
                    workspaceId = workspaceId,
                    entityType = change.entityType,
                    payload = change.payload,
                    fieldPath = "pull.changes[$index].payload"
                )
            }
        }
    }

    suspend fun applyHotPayloadInTransaction(
        workspaceId: String,
        entityType: SyncEntityType,
        payload: JSONObject,
        fieldPath: String
    ) {
        when (entityType) {
            SyncEntityType.CARD -> applyRemoteCard(workspaceId = workspaceId, payload = payload, fieldPath = fieldPath)
            SyncEntityType.DECK -> applyRemoteDeck(workspaceId = workspaceId, payload = payload, fieldPath = fieldPath)
            SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> applyRemoteSettings(
                workspaceId = workspaceId,
                payload = payload,
                fieldPath = fieldPath
            )

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
        val existingCard = database.cardDao().loadCard(cardId = card.cardId)
        if (existingCard == null) {
            database.cardDao().insertCard(card = card)
        } else {
            database.cardDao().updateCard(card = card)
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
        val existingDeck = database.deckDao().loadDeck(deckId = deck.deckId)
        if (existingDeck == null) {
            database.deckDao().insertDeck(deck = deck)
        } else {
            database.deckDao().updateDeck(deck = deck)
        }
    }

    private suspend fun applyRemoteSettings(workspaceId: String, payload: JSONObject, fieldPath: String) {
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            settings = WorkspaceSchedulerSettingsEntity(
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
        val workspaceTags = database.tagDao().loadTagsForWorkspace(workspaceId = workspaceId)
        val normalizedTags = normalizeTags(tags, workspaceTags.map(TagEntity::name))
        database.tagDao().deleteCardTags(cardId = cardId)
        if (normalizedTags.isEmpty()) {
            database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
            return
        }

        val existingTags = database.tagDao().loadTagsByNames(workspaceId = workspaceId, names = normalizedTags)
        val missingTags = normalizedTags.filter { normalizedTag ->
            existingTags.none { tag -> tag.name == normalizedTag }
        }
        if (missingTags.isNotEmpty()) {
            database.tagDao().insertTags(
                tags = missingTags.map { tag ->
                    TagEntity(
                        tagId = UUID.randomUUID().toString(),
                        workspaceId = workspaceId,
                        name = tag
                    )
                }
            )
        }
        val resolvedTags = database.tagDao().loadTagsByNames(workspaceId = workspaceId, names = normalizedTags)
        database.tagDao().insertCardTags(
            cardTags = resolvedTags.map { tag ->
                CardTagEntity(cardId = cardId, tagId = tag.tagId)
            }
        )
        database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
    }
}
