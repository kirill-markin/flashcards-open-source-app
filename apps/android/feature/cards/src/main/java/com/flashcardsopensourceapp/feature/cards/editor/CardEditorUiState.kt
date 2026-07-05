package com.flashcardsopensourceapp.feature.cards.editor

import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary

enum class CardEditorTextField {
    FRONT,
    BACK
}

data class CardEditorTextSelection(
    val start: Int,
    val end: Int
) {
    init {
        require(start >= 0) {
            "Card editor text selection start must not be negative."
        }
        require(end >= start) {
            "Card editor text selection end must be greater than or equal to start."
        }
    }
}

data class CardEditorManagedImageReference(
    val referenceKey: String,
    val mediaAssetId: String,
    val label: String?
) {
    init {
        require(referenceKey.isNotBlank()) {
            "Card editor managed image reference key must not be blank."
        }
        require(mediaAssetId.isNotBlank()) {
            "Card editor managed image asset id must not be blank."
        }
        require(label == null || label.isNotBlank()) {
            "Card editor managed image label must not be blank when present."
        }
    }
}

data class CardEditorUiState(
    val isLoading: Boolean,
    val title: String,
    val isEditing: Boolean,
    val frontText: String,
    val backText: String,
    val frontTextSelection: CardEditorTextSelection,
    val backTextSelection: CardEditorTextSelection,
    val frontManagedImageReferences: List<CardEditorManagedImageReference>,
    val backManagedImageReferences: List<CardEditorManagedImageReference>,
    val selectedTags: List<String>,
    val availableTagSuggestions: List<WorkspaceTagSummary>,
    val frontTextErrorMessage: String,
    val backTextErrorMessage: String,
    val tagsErrorMessage: String,
    val errorMessage: String,
    val isDirty: Boolean
)
