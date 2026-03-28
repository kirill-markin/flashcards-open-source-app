package com.flashcardsopensourceapp.feature.settings

data class WorkspaceExportUiState(
    val workspaceName: String,
    val activeCardsCount: Int,
    val isExporting: Boolean,
    val errorMessage: String
)
