package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.CardSummary

sealed interface DeckDetailInfoUiState {
    val title: String
    val filterSummary: String
    val totalCards: Int
    val dueCards: Int
    val newCards: Int
    val reviewedCards: Int

    data class AllCards(
        override val title: String,
        override val filterSummary: String,
        override val totalCards: Int,
        override val dueCards: Int,
        override val newCards: Int,
        override val reviewedCards: Int
    ) : DeckDetailInfoUiState

    data class PersistedDeck(
        val deckId: String,
        override val title: String,
        override val filterSummary: String,
        override val totalCards: Int,
        override val dueCards: Int,
        override val newCards: Int,
        override val reviewedCards: Int
    ) : DeckDetailInfoUiState
}

data class DeckDetailUiState(
    val detail: DeckDetailInfoUiState?,
    val cards: List<CardSummary>
)
