package com.flashcardsopensourceapp.feature.cards

import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel

data class CardsUiState(
    val isLoading: Boolean,
    val searchQuery: String,
    val cards: List<CardSummary>
)

data class CardEditorUiState(
    val isLoading: Boolean,
    val title: String,
    val isEditing: Boolean,
    val availableDecks: List<DeckSummary>,
    val selectedDeckId: String,
    val frontText: String,
    val backText: String,
    val tagsText: String,
    val effortLevel: EffortLevel,
    val errorMessage: String
)
