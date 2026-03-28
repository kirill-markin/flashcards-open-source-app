package com.flashcardsopensourceapp.feature.settings

data class WorkspaceSettingsUiState(
    val workspaceName: String,
    val deckCount: Int,
    val totalCards: Int,
    val tagCount: Int,
    val schedulerSummary: String,
    val exportSummary: String
)
