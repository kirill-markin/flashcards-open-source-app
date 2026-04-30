package com.flashcardsopensourceapp.feature.settings.workspace

data class WorkspaceExportUiState(
    val workspaceName: String,
    val activeCardsCount: Int,
    val isExporting: Boolean,
    val errorMessage: String
)
