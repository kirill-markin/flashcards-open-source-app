package com.flashcardsopensourceapp.feature.settings.account

import com.flashcardsopensourceapp.feature.settings.DestructiveActionState

data class AccountDangerZoneUiState(
    val isLinked: Boolean,
    val confirmationText: String,
    val isDeleting: Boolean,
    val deleteState: DestructiveActionState,
    val errorMessage: String,
    val errorTechnicalDetails: String?,
    val errorTechnicalDetailsReportId: String?,
    val successMessage: String,
    val showDeleteConfirmation: Boolean
)
