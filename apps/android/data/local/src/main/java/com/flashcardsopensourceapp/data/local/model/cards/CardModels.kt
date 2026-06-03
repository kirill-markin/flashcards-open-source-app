package com.flashcardsopensourceapp.data.local.model.cards

import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState

data class DeckFilterDefinition(
    val version: Int,
    val effortLevels: List<EffortLevel>,
    val tags: List<String>
)

data class DeckDraft(
    val name: String,
    val filterDefinition: DeckFilterDefinition
)

data class DeckSummary(
    val deckId: String,
    val workspaceId: String,
    val name: String,
    val filterDefinition: DeckFilterDefinition,
    val totalCards: Int,
    val dueCards: Int,
    val newCards: Int,
    val reviewedCards: Int,
    val createdAtMillis: Long,
    val updatedAtMillis: Long
)

// Keep in sync with apps/backend/src/cards/types.ts::Card, apps/web/src/types.ts::Card, and apps/ios/Flashcards/Flashcards/Cards/CardDeckTypes.swift::Card.
data class CardSummary(
    val cardId: String,
    val workspaceId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
    val dueAtMillis: Long?,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: FsrsCardState,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAtMillis: Long?,
    val fsrsScheduledDays: Int?,
    val deletedAtMillis: Long?
)

data class CardDraft(
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel
)

data class CardFilter(
    val tags: List<String>,
    val effort: List<EffortLevel>
)
