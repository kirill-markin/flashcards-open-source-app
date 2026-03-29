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
import kotlinx.coroutines.launch

private sealed interface CurrentWorkspaceRetryAction {
    data class CompleteLink(
        val selection: CloudWorkspaceLinkSelection
    ) : CurrentWorkspaceRetryAction

    data class SyncOnly(
        val workspaceId: String,
        val workspaceTitle: String
    ) : CurrentWorkspaceRetryAction
}

private data class CurrentWorkspaceDraftState(
    val operation: CurrentWorkspaceOperation,
    val workspaceLoadState: CurrentWorkspaceLoadState,
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
            workspaceLoadState = CurrentWorkspaceLoadState.Loading,
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
        val selectionErrorMessage = if (draft.workspaceLoadState == CurrentWorkspaceLoadState.Loaded) {
            currentWorkspaceSelectionErrorMessage(
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                workspaces = draft.workspaces
            )
        } else {
            null
        }
        CurrentWorkspaceUiState(
            cloudStatusTitle = displayCloudAccountStateTitle(cloudState = cloudSettings.cloudState),
            currentWorkspaceName = if (selectionErrorMessage == null) {
                metadata.currentWorkspaceName
            } else {
                "Unavailable"
            },
            linkedEmail = cloudSettings.linkedEmail,
            isGuest = cloudSettings.cloudState == CloudAccountState.GUEST,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
            workspaceLoadState = draft.workspaceLoadState,
            isSwitching = draft.operation == CurrentWorkspaceOperation.SWITCHING
                || draft.operation == CurrentWorkspaceOperation.SYNCING,
            operation = draft.operation,
            pendingWorkspaceTitle = draft.pendingWorkspaceTitle,
            canRetryLastWorkspaceAction = draft.retryAction != null,
            errorMessage = if (draft.errorMessage.isNotEmpty()) {
                draft.errorMessage
            } else {
                selectionErrorMessage.orEmpty()
            },
            workspaces = buildCurrentWorkspaceItems(
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
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
            workspaceLoadState = CurrentWorkspaceLoadState.Loading,
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
                workspaceLoadState = CurrentWorkspaceLoadState.Loading,
                errorMessage = ""
            )
        }
        try {
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    errorMessage = "",
                    workspaces = workspaces
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Failed,
                    errorMessage = error.message ?: "Could not load linked workspaces."
                )
            }
        }
    }

    /**
     * Workspace management should not be cancelled just because the current
     * settings surface briefly leaves composition during navigation.
     */
    fun loadWorkspacesAsync() {
        viewModelScope.launch {
            loadWorkspaces()
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
            val cloudSettings = cloudAccountRepository.observeCloudSettings().first()
            require(cloudSettings.activeWorkspaceId == workspace.workspaceId) {
                "Workspace switch returned '${workspace.workspaceId}', but activeWorkspaceId is '${cloudSettings.activeWorkspaceId}'."
            }
            require(cloudSettings.linkedWorkspaceId == workspace.workspaceId) {
                "Workspace switch returned '${workspace.workspaceId}', but linkedWorkspaceId is '${cloudSettings.linkedWorkspaceId}'."
            }
            draftState.update { state ->
                state.copy(
                    workspaces = applyOptimisticWorkspaceSelection(
                        workspaces = state.workspaces,
                        selectedWorkspace = workspace
                    )
                )
            }
            runWorkspaceSync(
                workspaceId = workspace.workspaceId,
                workspaceTitle = workspace.name
            )
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    errorMessage = error.message ?: "Workspace switch failed."
                )
            }
        }
    }

    fun switchWorkspaceAsync(selection: CloudWorkspaceLinkSelection) {
        viewModelScope.launch {
            switchWorkspace(selection = selection)
        }
    }

    suspend fun retryLastWorkspaceAction() {
        when (val retryAction = draftState.value.retryAction) {
            null -> Unit
            is CurrentWorkspaceRetryAction.CompleteLink -> switchWorkspace(selection = retryAction.selection)
            is CurrentWorkspaceRetryAction.SyncOnly -> runWorkspaceSync(
                workspaceId = retryAction.workspaceId,
                workspaceTitle = retryAction.workspaceTitle
            )
        }
    }

    fun retryLastWorkspaceActionAsync() {
        viewModelScope.launch {
            retryLastWorkspaceAction()
        }
    }

    private suspend fun runWorkspaceSync(workspaceId: String, workspaceTitle: String) {
        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.SYNCING,
                pendingWorkspaceTitle = workspaceTitle,
                retryAction = CurrentWorkspaceRetryAction.SyncOnly(
                    workspaceId = workspaceId,
                    workspaceTitle = workspaceTitle
                ),
                errorMessage = ""
            )
        }

        try {
            syncRepository.syncNow()
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            val cloudSettings = cloudAccountRepository.observeCloudSettings().first()
            val reconciliationErrorMessage = workspaceReconciliationErrorMessage(
                expectedWorkspaceId = workspaceId,
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                workspaces = workspaces
            )
            require(reconciliationErrorMessage == null) {
                reconciliationErrorMessage ?: "The linked workspace list did not reconcile to the expected current workspace."
            }
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
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
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    errorMessage = error.message ?: "Workspace sync failed."
                )
            }
        }
    }
}

private fun applyOptimisticWorkspaceSelection(
    workspaces: List<CloudWorkspaceSummary>,
    selectedWorkspace: CloudWorkspaceSummary
): List<CloudWorkspaceSummary> {
    return (workspaces.filterNot { workspace -> workspace.workspaceId == selectedWorkspace.workspaceId } +
        selectedWorkspace.copy(isSelected = true)).map { workspace ->
        workspace.copy(isSelected = workspace.workspaceId == selectedWorkspace.workspaceId)
    }
}

private fun workspaceReconciliationErrorMessage(
    expectedWorkspaceId: String,
    activeWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>
): String? {
    val selectionErrorMessage = currentWorkspaceSelectionErrorMessage(
        activeWorkspaceId = activeWorkspaceId,
        workspaces = workspaces
    )
    if (selectionErrorMessage != null) {
        return selectionErrorMessage
    }
    val selectedWorkspaceId = resolveSelectedWorkspaceId(
        activeWorkspaceId = activeWorkspaceId,
        workspaces = workspaces
    )
    if (selectedWorkspaceId == expectedWorkspaceId) {
        return null
    }
    return "The linked workspace list did not reconcile to the expected current workspace."
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
