package com.flashcardsopensourceapp.feature.settings

data class AccountStatusUiState(
    val workspaceName: String,
    val cloudStatusTitle: String,
    val linkedEmail: String?,
    val installationId: String,
    val syncStatusText: String,
    val lastSuccessfulSync: String,
    val isGuest: Boolean,
    val isLinked: Boolean,
    val isLinkingReady: Boolean,
    val isSyncBlocked: Boolean,
    val syncBlockedMessage: String?,
    val showLogoutConfirmation: Boolean,
    val errorMessage: String,
    val isSubmitting: Boolean
)
