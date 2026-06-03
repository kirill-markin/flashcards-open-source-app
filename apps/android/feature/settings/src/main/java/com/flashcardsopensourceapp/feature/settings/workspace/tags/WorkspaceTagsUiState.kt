package com.flashcardsopensourceapp.feature.settings.workspace.tags

import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary

data class WorkspaceTagsUiState(
    val searchQuery: String,
    val tags: List<WorkspaceTagSummary>,
    val totalCards: Int
)
