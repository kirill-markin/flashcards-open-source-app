package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import java.util.UUID

internal fun toCardSummary(card: CardWithRelations): CardSummary {
    return CardSummary(
        cardId = card.card.cardId,
        workspaceId = card.card.workspaceId,
        frontText = card.card.frontText,
        backText = card.card.backText,
        tags = normalizeTags(
            values = card.tags.map { tag -> tag.name },
            referenceTags = emptyList()
        ),
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

internal suspend fun replaceCardTags(
    database: AppDatabase,
    workspaceId: String,
    cardId: String,
    tags: List<String>
) {
    val workspaceTags: List<TagEntity> = database.tagDao().loadTagsForWorkspace(workspaceId = workspaceId)
    val normalizedTags: List<String> = normalizeTags(
        values = tags,
        referenceTags = workspaceTags.map { tag -> tag.name }
    )
    database.tagDao().deleteCardTags(cardId = cardId)

    if (normalizedTags.isEmpty()) {
        database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
        return
    }

    val existingTags: List<TagEntity> = database.tagDao().loadTagsByNames(
        workspaceId = workspaceId,
        names = normalizedTags
    )
    val missingNames: List<String> = normalizedTags.filter { normalizedTag ->
        existingTags.none { existingTag ->
            existingTag.name == normalizedTag
        }
    }
    val createdTags: List<TagEntity> = missingNames.map { name ->
        TagEntity(
            tagId = UUID.randomUUID().toString(),
            workspaceId = workspaceId,
            name = name
        )
    }

    if (createdTags.isNotEmpty()) {
        database.tagDao().insertTags(tags = createdTags)
    }

    val resolvedTags: List<TagEntity> = database.tagDao().loadTagsByNames(
        workspaceId = workspaceId,
        names = normalizedTags
    )

    database.tagDao().insertCardTags(
        cardTags = resolvedTags.map { tag ->
            CardTagEntity(cardId = cardId, tagId = tag.tagId)
        }
    )
    database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
}
