package com.flashcardsopensourceapp.feature.cards

import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary

data class CardsUiState(
    val isLoading: Boolean,
    val searchQuery: String,
    val activeFilter: CardFilter,
    val availableTagSuggestions: List<WorkspaceTagSummary>,
    val cards: List<CardSummary>
)

data class CardEditorUiState(
    val isLoading: Boolean,
    val title: String,
    val isEditing: Boolean,
    val frontText: String,
    val backText: String,
    val selectedTags: List<String>,
    val availableTagSuggestions: List<WorkspaceTagSummary>,
    val effortLevel: EffortLevel,
    val frontTextErrorMessage: String,
    val backTextErrorMessage: String,
    val tagsErrorMessage: String,
    val errorMessage: String,
    val isDirty: Boolean
)
