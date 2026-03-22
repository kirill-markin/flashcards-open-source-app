package com.flashcardsopensourceapp.feature.settings

data class SettingsUiState(
    val workspaceName: String,
    val cardCount: Int,
    val deckCount: Int,
    val storageLabel: String,
    val syncStatusText: String
)

data class AccountStatusUiState(
    val workspaceName: String,
    val cloudStatusTitle: String,
    val syncStatusText: String
)
