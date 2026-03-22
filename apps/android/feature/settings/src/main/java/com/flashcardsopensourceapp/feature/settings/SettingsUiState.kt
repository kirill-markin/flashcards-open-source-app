package com.flashcardsopensourceapp.feature.settings

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
