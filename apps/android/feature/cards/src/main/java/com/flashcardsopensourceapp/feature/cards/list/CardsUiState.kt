package com.flashcardsopensourceapp.feature.cards.list

import com.flashcardsopensourceapp.data.local.model.cards.CardFilter
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary

data class CardsUiState(
    val isLoading: Boolean,
    val searchQuery: String,
    val activeFilter: CardFilter,
    val availableTagSuggestions: List<WorkspaceTagSummary>,
    val cards: List<CardSummary>
)
