package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary

enum class AccessCapability {
    CAMERA,
    MICROPHONE,
    PHOTOS,
    FILES
}

enum class AccessStatus {
    ALLOWED,
    ASK_EVERY_TIME,
    BLOCKED,
    SYSTEM_PICKER,
    UNAVAILABLE
}

data class AccessCapabilityUiState(
    val capability: AccessCapability,
    val title: String,
    val summary: String,
    val status: AccessStatus,
    val guidance: String,
    val primaryActionLabel: String?
)

data class WorkspaceSettingsUiState(
    val workspaceName: String,
    val deckCount: Int,
    val totalCards: Int,
    val tagCount: Int,
    val schedulerSummary: String,
    val exportSummary: String
)

data class WorkspaceOverviewUiState(
    val workspaceName: String,
    val totalCards: Int,
    val deckCount: Int,
    val tagCount: Int,
    val dueCount: Int,
    val newCount: Int,
    val reviewedCount: Int
)

data class DecksUiState(
    val searchQuery: String,
    val decks: List<DeckSummary>
)

data class DeckDetailUiState(
    val deck: DeckSummary?,
    val cards: List<com.flashcardsopensourceapp.data.local.model.CardSummary>
)

data class DeckEditorUiState(
    val isLoading: Boolean,
    val title: String,
    val isEditing: Boolean,
    val name: String,
    val selectedEffortLevels: List<EffortLevel>,
    val selectedTags: List<String>,
    val availableTags: List<WorkspaceTagSummary>,
    val errorMessage: String
)

data class WorkspaceTagsUiState(
    val searchQuery: String,
    val tags: List<WorkspaceTagSummary>,
    val totalCards: Int
)

data class SchedulerSettingsUiState(
    val isLoading: Boolean,
    val algorithm: String,
    val desiredRetentionText: String,
    val learningStepsText: String,
    val relearningStepsText: String,
    val maximumIntervalDaysText: String,
    val enableFuzz: Boolean,
    val updatedAtLabel: String,
    val errorMessage: String,
    val showSaveConfirmation: Boolean
)

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
    val lastSyncAttempt: String
)

data class WorkspaceExportUiState(
    val workspaceName: String,
    val activeCardsCount: Int,
    val isExporting: Boolean,
    val errorMessage: String
)
