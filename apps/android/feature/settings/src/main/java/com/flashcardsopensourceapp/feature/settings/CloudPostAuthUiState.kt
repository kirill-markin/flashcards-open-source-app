package com.flashcardsopensourceapp.feature.settings

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
