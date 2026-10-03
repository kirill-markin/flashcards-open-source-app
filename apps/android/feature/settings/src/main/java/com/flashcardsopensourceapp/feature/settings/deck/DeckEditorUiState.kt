package com.flashcardsopensourceapp.feature.settings.deck
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary

data class DeckEditorUiState(
    val isLoading: Boolean,
    val isDeckMissing: Boolean,
    val isSubmitting: Boolean,
    val deleteTarget: DeckEditorDeleteTarget?,
    val title: String,
    val isEditing: Boolean,
    val name: String,
    val selectedTags: List<String>,
    val availableTags: List<WorkspaceTagSummary>,
    val errorMessage: String
)

data class DeckEditorDeleteTarget(
    val deckId: String,
    val name: String
)
