package com.flashcardsopensourceapp.feature.settings.server

data class ServerSettingsUiState(
    val modeTitle: String,
    val customOrigin: String,
    val apiBaseUrl: String,
    val authBaseUrl: String,
    val previewApiBaseUrl: String?,
    val previewAuthBaseUrl: String?,
    val canApplyPreviewConfiguration: Boolean,
    val canResetToOfficialServer: Boolean,
    val isApplying: Boolean,
    val errorMessage: String
)
