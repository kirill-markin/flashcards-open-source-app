package com.flashcardsopensourceapp.feature.settings.workspace

import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState

data class WorkspaceOverviewUiState(
    val workspaceName: String,
    val totalCards: Int,
    val deckCount: Int,
    val tagCount: Int,
    val dueCount: Int,
    val newCount: Int,
    val reviewedCount: Int,
    val isLinked: Boolean,
    val workspaceNameDraft: String,
    val isSavingName: Boolean,
    val isDeletePreviewLoading: Boolean,
    val isDeletingWorkspace: Boolean,
    val deleteState: DestructiveActionState,
    val errorMessage: String,
    val successMessage: String,
    val deleteConfirmationText: String,
    val showDeletePreviewAlert: Boolean,
    val showDeleteConfirmation: Boolean,
    val deletePreview: CloudWorkspaceDeletePreview?
)
