package com.flashcardsopensourceapp.feature.settings.deck

import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary

data class DeckEditorUiState(
    val isLoading: Boolean,
    val title: String,
    val isEditing: Boolean,
    val name: String,
    val selectedEffortLevels: List<EffortLevel>,
    val selectedTags: List<String>,
    val availableTags: List<WorkspaceTagSummary>,
    val errorMessage: String
)
