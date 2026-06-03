package com.flashcardsopensourceapp.feature.settings.workspace.export

data class WorkspaceExportUiState(
    val workspaceName: String,
    val activeCardsCount: Int,
    val isExporting: Boolean,
    val errorMessage: String
)
