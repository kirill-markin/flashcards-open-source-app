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
