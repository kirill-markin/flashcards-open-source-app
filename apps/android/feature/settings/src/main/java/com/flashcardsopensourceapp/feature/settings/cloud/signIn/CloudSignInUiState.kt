package com.flashcardsopensourceapp.feature.settings.cloud.signIn

data class CloudSignInUiState(
    val email: String,
    val code: String,
    val isGuestUpgrade: Boolean,
    val isSendingCode: Boolean,
    val isVerifyingCode: Boolean,
    val errorMessage: String,
    val errorTechnicalDetails: String?,
    val errorTechnicalDetailsReportId: String?,
    val challengeEmail: String?
)
