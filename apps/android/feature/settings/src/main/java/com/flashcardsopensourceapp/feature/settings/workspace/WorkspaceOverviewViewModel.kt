package com.flashcardsopensourceapp.feature.settings.workspace

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.repository.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
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
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    private val strings: SettingsStringResolver
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
    private val visibleAppScreenState = visibleAppScreenRepository.observeVisibleAppScreen().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = VisibleAppScreen.OTHER
    )
    private var pendingAutoSyncRequestId: String? = null
    private var workspaceOverviewSignatureAtAutoSyncStart: WorkspaceOverviewVisibleSignature? = null
    private var lastVisibleAutoSyncChangeSignature: WorkspaceOverviewVisibleSignature? = null

    val uiState: StateFlow<WorkspaceOverviewUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { overview, cloudSettings, draft ->
        val workspaceName = overview?.workspaceName ?: strings.get(R.string.settings_unavailable)
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
            workspaceName = strings.get(R.string.settings_loading),
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

    init {
        observeAutoSyncDrivenWorkspaceOverviewChanges()
    }

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
                state.copy(
                    errorMessage = strings.get(R.string.settings_workspace_name_required),
                    successMessage = ""
                )
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
                    successMessage = strings.get(R.string.settings_workspace_name_saved)
                )
            }
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSavingName = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_workspace_name_save_failed),
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
                    errorMessage = error.message ?: strings.get(R.string.settings_workspace_delete_preview_failed),
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
                state.copy(
                    errorMessage = strings.get(R.string.settings_account_danger_zone_confirmation_required)
                )
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
            draftState.update { state ->
                state.copy(
                    workspaceNameDraft = result.workspace.name,
                    hasUserEditedName = false,
                    isDeletingWorkspace = false,
                    deleteState = DestructiveActionState.IDLE,
                    deleteConfirmationText = "",
                    showDeleteConfirmation = false,
                    deletePreview = null,
                    errorMessage = "",
                    successMessage = strings.get(
                        R.string.settings_current_workspace_switched_message,
                        result.workspace.name
                    )
                )
            }
            messageController.showMessage(
                message = strings.get(R.string.settings_current_workspace_switched_message, result.workspace.name)
            )
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isDeletingWorkspace = false,
                    deleteState = DestructiveActionState.FAILED,
                    errorMessage = error.message ?: strings.get(R.string.settings_workspace_delete_failed),
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

    private fun observeAutoSyncDrivenWorkspaceOverviewChanges() {
        viewModelScope.launch {
            autoSyncEventRepository.observeAutoSyncEvents().collect { event ->
                when (event) {
                    is AutoSyncEvent.Requested -> {
                        handleAutoSyncRequested(request = event.request)
                    }

                    is AutoSyncEvent.Completed -> {
                        handleAutoSyncCompleted(completion = event.completion)
                    }
                }
            }
        }
    }

    private fun handleAutoSyncRequested(request: AutoSyncRequest) {
        if (request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_WORKSPACE_OVERVIEW) {
            return
        }

        pendingAutoSyncRequestId = request.requestId
        workspaceOverviewSignatureAtAutoSyncStart = buildWorkspaceOverviewVisibleSignature(uiState = uiState.value)
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val workspaceOverviewSignatureBeforeSync = workspaceOverviewSignatureAtAutoSyncStart
        workspaceOverviewSignatureAtAutoSyncStart = null

        if (completion.outcome !is AutoSyncOutcome.Succeeded) {
            return
        }
        if (completion.request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_WORKSPACE_OVERVIEW) {
            return
        }

        val currentWorkspaceOverviewSignature = buildWorkspaceOverviewVisibleSignature(uiState = uiState.value)
        if (
            workspaceOverviewSignatureBeforeSync == null ||
            workspaceOverviewSignatureBeforeSync == currentWorkspaceOverviewSignature
        ) {
            return
        }
        if (currentWorkspaceOverviewSignature == lastVisibleAutoSyncChangeSignature) {
            return
        }

        lastVisibleAutoSyncChangeSignature = currentWorkspaceOverviewSignature
        messageController.showMessage(message = workspaceUpdatedOnAnotherDeviceMessage(strings = strings))
    }
}

private data class WorkspaceOverviewVisibleSignature(
    val workspaceName: String,
    val totalCards: Int,
    val deckCount: Int,
    val tagCount: Int,
    val dueCount: Int,
    val newCount: Int,
    val reviewedCount: Int
)

private fun buildWorkspaceOverviewVisibleSignature(
    uiState: WorkspaceOverviewUiState
): WorkspaceOverviewVisibleSignature {
    return WorkspaceOverviewVisibleSignature(
        workspaceName = uiState.workspaceName,
        totalCards = uiState.totalCards,
        deckCount = uiState.deckCount,
        tagCount = uiState.tagCount,
        dueCount = uiState.dueCount,
        newCount = uiState.newCount,
        reviewedCount = uiState.reviewedCount
    )
}

fun createWorkspaceOverviewViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceOverviewViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                visibleAppScreenRepository = visibleAppScreenRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
