package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private sealed interface CurrentWorkspaceRetryAction {
    data class CompleteLink(
        val selection: CloudWorkspaceLinkSelection
    ) : CurrentWorkspaceRetryAction

    data class SyncOnly(
        val workspaceTitle: String
    ) : CurrentWorkspaceRetryAction
}

private data class CurrentWorkspaceDraftState(
    val operation: CurrentWorkspaceOperation,
    val pendingWorkspaceTitle: String?,
    val retryAction: CurrentWorkspaceRetryAction?,
    val errorMessage: String,
    val workspaces: List<CloudWorkspaceSummary>
)

class CurrentWorkspaceViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = CurrentWorkspaceDraftState(
            operation = CurrentWorkspaceOperation.IDLE,
            pendingWorkspaceTitle = null,
            retryAction = null,
            errorMessage = "",
            workspaces = emptyList()
        )
    )

    val uiState: StateFlow<CurrentWorkspaceUiState> = combine(
        workspaceRepository.observeAppMetadata(),
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { metadata, cloudSettings, draft ->
        CurrentWorkspaceUiState(
            cloudStatusTitle = displayCloudAccountStateTitle(cloudState = cloudSettings.cloudState),
            currentWorkspaceName = metadata.currentWorkspaceName,
            linkedEmail = cloudSettings.linkedEmail,
            isGuest = cloudSettings.cloudState == CloudAccountState.GUEST,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
            isLoading = draft.operation == CurrentWorkspaceOperation.LOADING,
            isSwitching = draft.operation == CurrentWorkspaceOperation.SWITCHING
                || draft.operation == CurrentWorkspaceOperation.SYNCING,
            operation = draft.operation,
            pendingWorkspaceTitle = draft.pendingWorkspaceTitle,
            canRetryLastWorkspaceAction = draft.retryAction != null,
            errorMessage = draft.errorMessage,
            workspaces = buildCurrentWorkspaceItems(
                currentWorkspaceName = metadata.currentWorkspaceName,
                workspaces = draft.workspaces
            )
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CurrentWorkspaceUiState(
            cloudStatusTitle = "Loading...",
            currentWorkspaceName = "Loading...",
            linkedEmail = null,
            isGuest = false,
            isLinked = false,
            isLinkingReady = false,
            isLoading = false,
            isSwitching = false,
            operation = CurrentWorkspaceOperation.IDLE,
            pendingWorkspaceTitle = null,
            canRetryLastWorkspaceAction = false,
            errorMessage = "",
            workspaces = emptyList()
        )
    )

    suspend fun loadWorkspaces() {
        val cloudSettings = cloudAccountRepository.observeCloudSettings().first()
        if (cloudSettings.cloudState != CloudAccountState.LINKED) {
            messageController.showMessage(
                message = if (cloudSettings.cloudState == CloudAccountState.GUEST) {
                    "Create an account or log in to upgrade Guest AI before managing workspaces."
                } else {
                    "Sign in to load linked workspaces."
                }
            )
            return
        }

        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.LOADING,
                errorMessage = ""
            )
        }
        try {
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = "",
                    workspaces = workspaces
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = error.message ?: "Could not load linked workspaces."
                )
            }
        }
    }

    suspend fun switchWorkspace(selection: CloudWorkspaceLinkSelection) {
        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.SWITCHING,
                pendingWorkspaceTitle = workspaceSelectionTitle(
                    selection = selection,
                    workspaces = state.workspaces
                ),
                retryAction = CurrentWorkspaceRetryAction.CompleteLink(selection = selection),
                errorMessage = ""
            )
        }
        try {
            val workspace = cloudAccountRepository.switchLinkedWorkspace(selection)
            runWorkspaceSync(workspaceTitle = workspace.name)
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = error.message ?: "Workspace switch failed."
                )
            }
        }
    }

    suspend fun retryLastWorkspaceAction() {
        when (val retryAction = draftState.value.retryAction) {
            null -> Unit
            is CurrentWorkspaceRetryAction.CompleteLink -> switchWorkspace(selection = retryAction.selection)
            is CurrentWorkspaceRetryAction.SyncOnly -> runWorkspaceSync(workspaceTitle = retryAction.workspaceTitle)
        }
    }

    private suspend fun runWorkspaceSync(workspaceTitle: String) {
        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.SYNCING,
                pendingWorkspaceTitle = workspaceTitle,
                retryAction = CurrentWorkspaceRetryAction.SyncOnly(workspaceTitle = workspaceTitle),
                errorMessage = ""
            )
        }

        try {
            syncRepository.syncNow()
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    pendingWorkspaceTitle = null,
                    retryAction = null,
                    errorMessage = "",
                    workspaces = workspaces
                )
            }
            messageController.showMessage(message = "Current workspace is now $workspaceTitle.")
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = error.message ?: "Workspace sync failed."
                )
            }
        }
    }
}

fun createCurrentWorkspaceViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CurrentWorkspaceViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController,
                workspaceRepository = workspaceRepository
            )
        }
    }
}
