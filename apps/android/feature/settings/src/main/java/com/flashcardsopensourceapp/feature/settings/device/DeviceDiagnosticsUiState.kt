package com.flashcardsopensourceapp.feature.settings.device

data class DeviceDiagnosticsUiState(
    val workspaceName: String,
    val workspaceId: String,
    val appVersion: String,
    val buildNumber: String,
    val operatingSystem: String,
    val deviceModel: String,
    val clientLabel: String,
    val storageLabel: String,
    val outboxEntriesCount: Int,
    val lastSyncCursor: String,
    val lastSyncAttempt: String,
    val lastSuccessfulSync: String,
    val lastSyncError: String
)
