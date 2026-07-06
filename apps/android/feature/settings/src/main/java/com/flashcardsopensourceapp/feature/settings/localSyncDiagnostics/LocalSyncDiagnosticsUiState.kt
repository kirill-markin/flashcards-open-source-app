package com.flashcardsopensourceapp.feature.settings.localSyncDiagnostics

sealed interface LocalSyncDiagnosticsUiState {
    data object Loading : LocalSyncDiagnosticsUiState

    data object NoWorkspace : LocalSyncDiagnosticsUiState

    data class Ready(
        val cardsSyncRows: List<LocalSyncDiagnosticsRowUiState>,
        val managedMediaSyncRows: List<LocalSyncDiagnosticsRowUiState>,
        val problemSections: List<LocalSyncDiagnosticsProblemSectionUiState>,
        val reportText: String
    ) : LocalSyncDiagnosticsUiState
}

data class LocalSyncDiagnosticsRowUiState(
    val label: String,
    val value: String
)

data class LocalSyncDiagnosticsProblemSectionUiState(
    val title: String,
    val records: List<LocalSyncDiagnosticsProblemRecordUiState>
)

data class LocalSyncDiagnosticsProblemRecordUiState(
    val title: String,
    val rows: List<LocalSyncDiagnosticsRowUiState>
)
