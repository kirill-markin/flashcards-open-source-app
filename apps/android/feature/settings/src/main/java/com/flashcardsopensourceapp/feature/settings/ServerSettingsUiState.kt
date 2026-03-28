package com.flashcardsopensourceapp.feature.settings

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
