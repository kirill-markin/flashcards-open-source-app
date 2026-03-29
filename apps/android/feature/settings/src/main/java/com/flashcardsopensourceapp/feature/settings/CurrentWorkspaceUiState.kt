package com.flashcardsopensourceapp.feature.settings

data class CurrentWorkspaceUiState(
    val cloudStatusTitle: String,
    val currentWorkspaceName: String,
    val linkedEmail: String?,
    val isGuest: Boolean,
    val isLinked: Boolean,
    val isLinkingReady: Boolean,
    val hasRequestedWorkspaceLoad: Boolean,
    val existingWorkspaceCount: Int,
    val isLoading: Boolean,
    val isSwitching: Boolean,
    val operation: CurrentWorkspaceOperation,
    val pendingWorkspaceTitle: String?,
    val canRetryLastWorkspaceAction: Boolean,
    val errorMessage: String,
    val workspaces: List<CurrentWorkspaceItemUiState>
)

data class CurrentWorkspaceItemUiState(
    val workspaceId: String,
    val title: String,
    val subtitle: String,
    val isSelected: Boolean,
    val isCreateNew: Boolean
)
