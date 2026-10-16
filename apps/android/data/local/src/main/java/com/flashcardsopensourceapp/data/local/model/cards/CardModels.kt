package com.flashcardsopensourceapp.data.local.model.cards

import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState

data class DeckFilterDefinition(
    val version: Int,
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

const val defaultCardType: String = "basic"

data class CardSourceMetadata(
    val label: String?,
    val author: String?,
    val comment: String?,
    val createdAt: String?,
    val importedAt: String?,
    val importId: String?
)

data class CardMetadata(
    val version: Int,
    val source: CardSourceMetadata?,
    val onboardingDemo: OnboardingDemoMetadata?
) {
    constructor(version: Int, source: CardSourceMetadata?) : this(version, source, null)
}

// Keep in sync with apps/backend/src/cards/types.ts::Card, apps/web/src/types.ts::Card, and apps/ios/Flashcards/Flashcards/Cards/Model/CardDeckTypes.swift::Card.
data class CardSummary(
    val cardId: String,
    val workspaceId: String,
    val frontText: String,
    val backText: String,
    val cardType: String,
    val metadata: CardMetadata,
    val tags: List<String>,
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

data class OnboardingDemoMetadata(
    val version: Int,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val cardType: String,
    val wasEdited: Boolean
)

data class CardDraft private constructor(
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val onboardingDemo: OnboardingDemoMetadata?
) {
    constructor(frontText: String, backText: String, tags: List<String>) : this(frontText, backText, tags, null)

    companion object {
        fun onboardingDemo(frontText: String, backText: String, tags: List<String>): CardDraft {
            return CardDraft(
                frontText = frontText,
                backText = backText,
                tags = tags,
                onboardingDemo = makeOnboardingDemoMetadata(
                    frontText = frontText, backText = backText, tags = tags,
                    cardType = defaultCardType, wasEdited = false
                )
            )
        }
    }
}

data class CardFilter(
    val tags: List<String>
)
