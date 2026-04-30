package com.flashcardsopensourceapp.feature.settings.deck

sealed interface DeckListTargetUiState {
    val id: String

    data object AllCards : DeckListTargetUiState {
        override val id: String = "all-cards"
    }

    data class PersistedDeck(
        val deckId: String
    ) : DeckListTargetUiState {
        override val id: String = deckId
    }
}

data class DeckListEntryUiState(
    val target: DeckListTargetUiState,
    val title: String,
    val filterSummary: String,
    val totalCards: Int,
    val dueCards: Int,
    val newCards: Int,
    val reviewedCards: Int
)

data class DecksUiState(
    val searchQuery: String,
    val deckEntries: List<DeckListEntryUiState>
)
