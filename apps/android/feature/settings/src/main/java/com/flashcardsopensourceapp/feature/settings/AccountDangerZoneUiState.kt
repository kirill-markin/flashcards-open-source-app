package com.flashcardsopensourceapp.feature.settings

data class AccountDangerZoneUiState(
    val isLinked: Boolean,
    val confirmationText: String,
    val isDeleting: Boolean,
    val deleteState: DestructiveActionState,
    val errorMessage: String,
    val successMessage: String,
    val showDeleteConfirmation: Boolean
)
