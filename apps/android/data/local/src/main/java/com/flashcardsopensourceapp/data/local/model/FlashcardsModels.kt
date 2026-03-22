package com.flashcardsopensourceapp.data.local.model

data class WorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val createdAtMillis: Long
)

data class DeckSummary(
    val deckId: String,
    val workspaceId: String,
    val name: String,
    val position: Int
)

enum class EffortLevel {
    FAST,
    DEEP
}

data class CardSummary(
    val cardId: String,
    val workspaceId: String,
    val deckId: String,
    val deckName: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
    val createdAtMillis: Long,
    val updatedAtMillis: Long
)

data class CardDraft(
    val deckId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel
)

enum class ReviewRating {
    AGAIN,
    HARD,
    GOOD,
    EASY
}

data class ReviewCard(
    val cardId: String,
    val deckName: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>
)

data class AppMetadataSummary(
    val workspaceName: String,
    val deckCount: Int,
    val cardCount: Int,
    val localStorageLabel: String,
    val syncStatusText: String
)
