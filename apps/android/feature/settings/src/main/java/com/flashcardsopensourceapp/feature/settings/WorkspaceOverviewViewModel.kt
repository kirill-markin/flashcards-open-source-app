package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private data class WorkspaceOverviewDraftState(
    val workspaceNameDraft: String,
    val hasUserEditedName: Boolean,
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

class WorkspaceOverviewViewModel(
    workspaceRepository: WorkspaceRepository,
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = WorkspaceOverviewDraftState(
            workspaceNameDraft = "",
            hasUserEditedName = false,
            isSavingName = false,
            isDeletePreviewLoading = false,
            isDeletingWorkspace = false,
            deleteState = DestructiveActionState.IDLE,
            errorMessage = "",
            successMessage = "",
            deleteConfirmationText = "",
            showDeletePreviewAlert = false,
            showDeleteConfirmation = false,
            deletePreview = null
        )
    )

    val uiState: StateFlow<WorkspaceOverviewUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { overview, cloudSettings, draft ->
        val workspaceName = overview?.workspaceName ?: "Unavailable"
        val workspaceNameDraft = if (draft.hasUserEditedName) {
            draft.workspaceNameDraft
        } else {
            workspaceName
        }

        WorkspaceOverviewUiState(
            workspaceName = workspaceName,
            totalCards = overview?.totalCards ?: 0,
            deckCount = overview?.deckCount ?: 0,
            tagCount = overview?.tagsCount ?: 0,
            dueCount = overview?.dueCount ?: 0,
            newCount = overview?.newCount ?: 0,
            reviewedCount = overview?.reviewedCount ?: 0,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            workspaceNameDraft = workspaceNameDraft,
            isSavingName = draft.isSavingName,
            isDeletePreviewLoading = draft.isDeletePreviewLoading,
            isDeletingWorkspace = draft.isDeletingWorkspace,
            deleteState = draft.deleteState,
            errorMessage = draft.errorMessage,
            successMessage = draft.successMessage,
            deleteConfirmationText = draft.deleteConfirmationText,
            showDeletePreviewAlert = draft.showDeletePreviewAlert,
            showDeleteConfirmation = draft.showDeleteConfirmation,
            deletePreview = draft.deletePreview
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceOverviewUiState(
            workspaceName = "Loading...",
            totalCards = 0,
            deckCount = 0,
            tagCount = 0,
            dueCount = 0,
            newCount = 0,
            reviewedCount = 0,
            isLinked = false,
            workspaceNameDraft = "",
            isSavingName = false,
            isDeletePreviewLoading = false,
            isDeletingWorkspace = false,
            deleteState = DestructiveActionState.IDLE,
            errorMessage = "",
            successMessage = "",
            deleteConfirmationText = "",
            showDeletePreviewAlert = false,
            showDeleteConfirmation = false,
            deletePreview = null
        )
    )

    fun updateWorkspaceNameDraft(name: String) {
        draftState.update { state ->
            state.copy(
                workspaceNameDraft = name,
                hasUserEditedName = true,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    suspend fun saveWorkspaceName(): Boolean {
        val nextName = uiState.value.workspaceNameDraft.trim()
        if (nextName.isEmpty()) {
            draftState.update { state ->
                state.copy(errorMessage = "Workspace name is required.", successMessage = "")
            }
            return false
        }

        draftState.update { state ->
            state.copy(isSavingName = true, errorMessage = "", successMessage = "")
        }

        return try {
            val renamedWorkspace = cloudAccountRepository.renameCurrentWorkspace(name = nextName)
            draftState.update { state ->
                state.copy(
                    workspaceNameDraft = renamedWorkspace.name,
                    hasUserEditedName = false,
                    isSavingName = false,
                    errorMessage = "",
                    successMessage = "Workspace name saved."
                )
            }
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSavingName = false,
                    errorMessage = error.message ?: "Workspace rename failed.",
                    successMessage = ""
                )
            }
            false
        }
    }

    /**
     * Workspace mutations are owned by the ViewModel so they can finish even
     * when the settings composition is recreated mid-operation.
     */
    fun saveWorkspaceNameAsync() {
        viewModelScope.launch {
            saveWorkspaceName()
        }
    }

    suspend fun requestDeleteWorkspace() {
        draftState.update { state ->
            state.copy(
                isDeletePreviewLoading = true,
                deleteState = DestructiveActionState.IDLE,
                errorMessage = "",
                successMessage = ""
            )
        }

        try {
            val deletePreview = cloudAccountRepository.loadCurrentWorkspaceDeletePreview()
            draftState.update { state ->
                state.copy(
                    isDeletePreviewLoading = false,
                    deleteConfirmationText = "",
                    showDeletePreviewAlert = true,
                    showDeleteConfirmation = false,
                    deleteState = DestructiveActionState.IDLE,
                    deletePreview = deletePreview
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isDeletePreviewLoading = false,
                    errorMessage = error.message ?: "Workspace deletion preview failed.",
                    successMessage = ""
                )
            }
        }
    }

    fun requestDeleteWorkspaceAsync() {
        viewModelScope.launch {
            requestDeleteWorkspace()
        }
    }

    fun dismissDeletePreviewAlert() {
        draftState.update { state ->
            state.copy(showDeletePreviewAlert = false)
        }
    }

    fun openDeleteConfirmation() {
        draftState.update { state ->
            state.copy(
                showDeletePreviewAlert = false,
                showDeleteConfirmation = true,
                deleteState = DestructiveActionState.IDLE
            )
        }
    }

    fun updateDeleteConfirmationText(value: String) {
        draftState.update { state ->
            state.copy(
                deleteConfirmationText = value,
                deleteState = if (state.errorMessage.isEmpty()) {
                    state.deleteState
                } else {
                    DestructiveActionState.IDLE
                },
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun dismissDeleteConfirmation() {
        draftState.update { state ->
            state.copy(
                showDeleteConfirmation = false,
                deleteConfirmationText = "",
                deleteState = DestructiveActionState.IDLE,
                deletePreview = null
            )
        }
    }

    suspend fun deleteWorkspace(): Boolean {
        val deletePreview = requireNotNull(uiState.value.deletePreview) {
            "Workspace delete preview is required before deletion."
        }
        if (uiState.value.deleteConfirmationText != deletePreview.confirmationText) {
            draftState.update { state ->
                state.copy(errorMessage = "Enter the confirmation phrase exactly to continue.")
            }
            return false
        }

        draftState.update { state ->
            state.copy(
                isDeletingWorkspace = true,
                deleteState = DestructiveActionState.IN_PROGRESS,
                errorMessage = "",
                successMessage = ""
            )
        }

        return try {
            val result = cloudAccountRepository.deleteCurrentWorkspace(
                confirmationText = uiState.value.deleteConfirmationText
            )
            val syncFailureMessage = try {
                syncRepository.syncNow()
                null
            } catch (error: Exception) {
                error.message ?: "Workspace sync failed after deletion."
            }
            draftState.update { state ->
                state.copy(
                    workspaceNameDraft = result.workspace.name,
                    hasUserEditedName = false,
                    isDeletingWorkspace = false,
                    deleteState = DestructiveActionState.IDLE,
                    deleteConfirmationText = "",
                    showDeleteConfirmation = false,
                    deletePreview = null,
                    errorMessage = syncFailureMessage.orEmpty(),
                    successMessage = if (syncFailureMessage == null) {
                        "Workspace deleted. Switched to ${result.workspace.name}."
                    } else {
                        "Workspace deleted. Switched to ${result.workspace.name}. Sync still needs attention."
                    }
                )
            }
            messageController.showMessage(
                message = if (syncFailureMessage == null) {
                    "Workspace deleted. Switched to ${result.workspace.name}."
                } else {
                    "Workspace deleted, but sync still needs attention."
                }
            )
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isDeletingWorkspace = false,
                    deleteState = DestructiveActionState.FAILED,
                    errorMessage = error.message ?: "Workspace deletion failed.",
                    successMessage = ""
                )
            }
            false
        }
    }

    fun deleteWorkspaceAsync() {
        viewModelScope.launch {
            deleteWorkspace()
        }
    }
}

fun createWorkspaceOverviewViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceOverviewViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController
            )
        }
    }
}
