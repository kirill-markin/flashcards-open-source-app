package com.flashcardsopensourceapp.feature.settings.workspace

import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState

data class WorkspaceSettingsUiState(
    val workspaceName: String,
    val deckCount: Int,
    val totalCards: Int,
    val tagCount: Int,
    val notificationsSummary: String,
    val schedulerSummary: String,
    val exportSummary: String,
    val isLinked: Boolean,
    val errorMessage: String,
    val successMessage: String,
    val resetConfirmationText: String,
    val resetState: DestructiveActionState,
    val isResetPreviewLoading: Boolean,
    val showResetConfirmation: Boolean,
    val showResetPreviewAlert: Boolean,
    val resetProgressPreview: CloudWorkspaceResetProgressPreview?
)
