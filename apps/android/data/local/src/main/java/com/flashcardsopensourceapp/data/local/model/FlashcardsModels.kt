package com.flashcardsopensourceapp.data.local.model

data class WorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val createdAtMillis: Long
)

enum class EffortLevel {
    FAST,
    MEDIUM,
    LONG
}

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

data class CardSummary(
    val cardId: String,
    val workspaceId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
    val createdAtMillis: Long,
    val updatedAtMillis: Long
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

enum class ReviewRating {
    AGAIN,
    HARD,
    GOOD,
    EASY
}

sealed interface ReviewFilter {
    data object AllCards : ReviewFilter

    data class Deck(
        val deckId: String
    ) : ReviewFilter

    data class Tag(
        val tag: String
    ) : ReviewFilter
}

data class ReviewCard(
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
    val createdAtMillis: Long
)

data class ReviewDeckFilterOption(
    val deckId: String,
    val title: String,
    val totalCount: Int
)

data class ReviewTagFilterOption(
    val tag: String,
    val totalCount: Int
)

data class ReviewSessionSnapshot(
    val selectedFilter: ReviewFilter,
    val selectedFilterTitle: String,
    val cards: List<ReviewCard>,
    val remainingCount: Int,
    val totalCount: Int,
    val availableDeckFilters: List<ReviewDeckFilterOption>,
    val availableTagFilters: List<ReviewTagFilterOption>,
    val isLoading: Boolean
)

data class ReviewTimelinePage(
    val cards: List<ReviewCard>,
    val hasMoreCards: Boolean
)

data class AppMetadataSummary(
    val workspaceName: String,
    val deckCount: Int,
    val cardCount: Int,
    val localStorageLabel: String,
    val syncStatusText: String
)

data class WorkspaceTagSummary(
    val tag: String,
    val cardsCount: Int
)

data class WorkspaceTagsSummary(
    val tags: List<WorkspaceTagSummary>,
    val totalCards: Int
)

data class WorkspaceOverviewSummary(
    val workspaceId: String,
    val workspaceName: String,
    val totalCards: Int,
    val deckCount: Int,
    val tagsCount: Int,
    val dueCount: Int,
    val newCount: Int,
    val reviewedCount: Int
)
