package com.flashcardsopensourceapp.feature.settings.cloud

import com.flashcardsopensourceapp.feature.settings.workspace.CurrentWorkspaceItemUiState

enum class CloudPostAuthMode {
    IDLE,
    READY_TO_AUTO_LINK,
    CHOOSE_WORKSPACE,
    PROCESSING,
    FAILED
}

data class CloudPostAuthUiState(
    val mode: CloudPostAuthMode,
    val verifiedEmail: String?,
    val isGuestUpgrade: Boolean,
    val workspaces: List<CurrentWorkspaceItemUiState>,
    val pendingWorkspaceTitle: String?,
    val processingTitle: String,
    val processingMessage: String,
    val errorMessage: String,
    val canRetry: Boolean,
    val canLogout: Boolean,
    val completionToken: Long?
)
