package com.flashcardsopensourceapp.data.local.repository.workspace

import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.scheduling.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.scheduling.decodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.scheduling.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.scheduling.validateWorkspaceSchedulerSettingsInput

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
