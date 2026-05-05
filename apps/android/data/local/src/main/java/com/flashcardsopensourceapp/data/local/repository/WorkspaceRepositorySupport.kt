package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.decodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.validateWorkspaceSchedulerSettingsInput

internal fun toWorkspaceSchedulerSettingsEntity(
    settings: WorkspaceSchedulerSettings
): WorkspaceSchedulerSettingsEntity {
    return WorkspaceSchedulerSettingsEntity(
        workspaceId = settings.workspaceId,
        algorithm = settings.algorithm,
        desiredRetention = settings.desiredRetention,
        learningStepsMinutesJson = encodeSchedulerStepListJson(values = settings.learningStepsMinutes),
        relearningStepsMinutesJson = encodeSchedulerStepListJson(values = settings.relearningStepsMinutes),
        maximumIntervalDays = settings.maximumIntervalDays,
        enableFuzz = settings.enableFuzz,
        updatedAtMillis = settings.updatedAtMillis
    )
}

internal fun toWorkspaceSchedulerSettings(
    entity: WorkspaceSchedulerSettingsEntity
): WorkspaceSchedulerSettings {
    return validateWorkspaceSchedulerSettingsInput(
        workspaceId = entity.workspaceId,
        desiredRetention = entity.desiredRetention,
        learningStepsMinutes = decodeSchedulerStepListJson(json = entity.learningStepsMinutesJson),
        relearningStepsMinutes = decodeSchedulerStepListJson(json = entity.relearningStepsMinutesJson),
        maximumIntervalDays = entity.maximumIntervalDays,
        enableFuzz = entity.enableFuzz,
        updatedAtMillis = entity.updatedAtMillis
    )
}

internal fun makeWorkspaceTagsSummary(cards: List<CardSummary>): WorkspaceTagsSummary {
    val counts: Map<String, Int> = cards.fold(emptyMap()) { result, card ->
        card.tags.fold(result) { tagResult, tag ->
            tagResult + (tag to ((tagResult[tag] ?: 0) + 1))
        }
    }
    val tags: List<WorkspaceTagSummary> = counts.entries.map { entry ->
        WorkspaceTagSummary(
            tag = entry.key,
            cardsCount = entry.value
        )
    }.sortedWith(
        compareByDescending<WorkspaceTagSummary> { tagSummary ->
            tagSummary.cardsCount
        }.thenBy { tagSummary ->
            tagSummary.tag.lowercase()
        }
    )

    return WorkspaceTagsSummary(
        tags = tags,
        totalCards = cards.size
    )
}

internal fun makeWorkspaceTagsSummaryFromStoredTagNames(
    tagNames: List<String>,
    totalCards: Int
): WorkspaceTagsSummary {
    val tags: List<WorkspaceTagSummary> = tagNames.map { tagName ->
        WorkspaceTagSummary(
            tag = tagName,
            cardsCount = 0
        )
    }

    return WorkspaceTagsSummary(
        tags = tags,
        totalCards = totalCards
    )
}
