package com.flashcardsopensourceapp.feature.settings.workspace

import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary

data class WorkspaceTagsUiState(
    val searchQuery: String,
    val tags: List<WorkspaceTagSummary>,
    val totalCards: Int
)
