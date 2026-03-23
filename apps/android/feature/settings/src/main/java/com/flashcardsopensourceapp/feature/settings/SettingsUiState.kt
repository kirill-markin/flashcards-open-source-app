package com.flashcardsopensourceapp.feature.settings

enum class CurrentWorkspaceOperation {
    IDLE,
    LOADING,
    SWITCHING,
    SYNCING
}

enum class DestructiveActionState {
    IDLE,
    IN_PROGRESS,
    FAILED
}

enum class CloudPostAuthMode {
    IDLE,
    READY_TO_AUTO_LINK,
    CHOOSE_WORKSPACE,
    PROCESSING,
    FAILED
}

data class SettingsUiState(
    val currentWorkspaceName: String,
    val workspaceName: String,
    val cardCount: Int,
    val deckCount: Int,
    val storageLabel: String,
    val syncStatusText: String,
    val accountStatusTitle: String
)

data class AccountStatusUiState(
    val workspaceName: String,
    val cloudStatusTitle: String,
    val linkedEmail: String?,
    val deviceId: String,
    val syncStatusText: String,
    val lastSuccessfulSync: String,
    val isLinked: Boolean,
    val isLinkingReady: Boolean,
    val showLogoutConfirmation: Boolean,
    val errorMessage: String,
    val isSubmitting: Boolean
)

data class CurrentWorkspaceUiState(
    val cloudStatusTitle: String,
    val currentWorkspaceName: String,
    val linkedEmail: String?,
    val isLinked: Boolean,
    val isLinkingReady: Boolean,
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

data class ServerSettingsUiState(
    val modeTitle: String,
    val customOrigin: String,
    val apiBaseUrl: String,
    val authBaseUrl: String,
    val previewApiBaseUrl: String?,
    val previewAuthBaseUrl: String?,
    val isApplying: Boolean,
    val errorMessage: String
)

data class CloudSignInUiState(
    val email: String,
    val code: String,
    val isSendingCode: Boolean,
    val isVerifyingCode: Boolean,
    val errorMessage: String,
    val challengeEmail: String?
)

data class CloudPostAuthUiState(
    val mode: CloudPostAuthMode,
    val verifiedEmail: String?,
    val workspaces: List<CurrentWorkspaceItemUiState>,
    val pendingWorkspaceTitle: String?,
    val processingTitle: String,
    val processingMessage: String,
    val errorMessage: String,
    val canRetry: Boolean,
    val canLogout: Boolean,
    val completionToken: Long?
)

data class AgentConnectionsUiState(
    val isLinked: Boolean,
    val isLoading: Boolean,
    val instructions: String,
    val errorMessage: String,
    val revokingConnectionId: String?,
    val connections: List<AgentConnectionItemUiState>
)

data class AgentConnectionItemUiState(
    val connectionId: String,
    val label: String,
    val createdAtLabel: String,
    val lastUsedAtLabel: String,
    val revokedAtLabel: String,
    val isRevoked: Boolean
)

data class AccountDangerZoneUiState(
    val isLinked: Boolean,
    val confirmationText: String,
    val isDeleting: Boolean,
    val deleteState: DestructiveActionState,
    val errorMessage: String,
    val successMessage: String,
    val showDeleteConfirmation: Boolean
)
