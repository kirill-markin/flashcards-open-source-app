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
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.buildCurrentWorkspaceItems
import com.flashcardsopensourceapp.feature.settings.cloud.currentWorkspaceSelectionErrorMessage
import com.flashcardsopensourceapp.feature.settings.cloud.displayCloudAccountStateTitle
import com.flashcardsopensourceapp.feature.settings.cloud.resolveSelectedWorkspaceId
import com.flashcardsopensourceapp.feature.settings.cloud.workspaceSelectionTitle
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.resolveWorkspaceName
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
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    workspaceRepository: WorkspaceRepository,
    private val strings: SettingsStringResolver
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
    private val visibleAppScreenState = visibleAppScreenRepository.observeVisibleAppScreen().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = VisibleAppScreen.OTHER
    )
    private var pendingAutoSyncRequestId: String? = null
    private var currentWorkspaceSignatureAtAutoSyncStart: CurrentWorkspaceVisibleSignature? = null
    private var lastVisibleAutoSyncChangeSignature: CurrentWorkspaceVisibleSignature? = null

    val uiState: StateFlow<CurrentWorkspaceUiState> = combine(
        workspaceRepository.observeAppMetadata(),
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { metadata, cloudSettings, draft ->
        val isOperationActive = draft.operation != CurrentWorkspaceOperation.IDLE
        val resolvedMetadataCurrentWorkspaceName = strings.resolveWorkspaceName(
            workspaceName = metadata.currentWorkspaceName
        )
        val selectionErrorMessage = if (
            draft.workspaceLoadState == CurrentWorkspaceLoadState.Loaded &&
            isOperationActive.not()
        ) {
            currentWorkspaceSelectionErrorMessage(
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                workspaces = draft.workspaces,
                strings = strings
            )
        } else {
            null
        }
        val currentWorkspaceName = if (selectionErrorMessage == null) {
            if (
                isOperationActive
                && resolvedMetadataCurrentWorkspaceName == strings.get(R.string.settings_unavailable)
            ) {
                draft.pendingWorkspaceTitle ?: resolvedMetadataCurrentWorkspaceName
            } else {
                resolvedMetadataCurrentWorkspaceName
            }
        } else {
            strings.get(R.string.settings_unavailable)
        }
        CurrentWorkspaceUiState(
            cloudStatusTitle = displayCloudAccountStateTitle(
                cloudState = cloudSettings.cloudState,
                strings = strings
            ),
            currentWorkspaceName = currentWorkspaceName,
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
                workspaces = draft.workspaces,
                strings = strings
            )
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CurrentWorkspaceUiState(
            cloudStatusTitle = strings.get(R.string.settings_loading),
            currentWorkspaceName = strings.get(R.string.settings_loading),
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

    init {
        observeAutoSyncDrivenWorkspaceChanges()
    }

    suspend fun loadWorkspaces() {
        val cloudSettings = cloudAccountRepository.observeCloudSettings().first()
        if (cloudSettings.cloudState != CloudAccountState.LINKED) {
            messageController.showMessage(
                message = if (cloudSettings.cloudState == CloudAccountState.GUEST) {
                    strings.get(R.string.settings_current_workspace_load_guest_message)
                } else {
                    strings.get(R.string.settings_current_workspace_load_sign_in_message)
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
                    errorMessage = error.message ?: strings.get(R.string.settings_current_workspace_load_failed)
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
                    workspaces = state.workspaces,
                    strings = strings
                ),
                retryAction = CurrentWorkspaceRetryAction.CompleteLink(selection = selection),
                errorMessage = ""
            )
        }
        try {
            val workspace = cloudAccountRepository.completeLinkedWorkspaceTransition(selection)
            val cloudSettings = cloudAccountRepository.observeCloudSettings().first()
            require(cloudSettings.activeWorkspaceId == workspace.workspaceId) {
                "Workspace switch returned '${workspace.workspaceId}', but activeWorkspaceId is '${cloudSettings.activeWorkspaceId}'."
            }
            require(cloudSettings.linkedWorkspaceId == workspace.workspaceId) {
                "Workspace switch returned '${workspace.workspaceId}', but linkedWorkspaceId is '${cloudSettings.linkedWorkspaceId}'."
            }
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            val reconciliationErrorMessage = workspaceReconciliationErrorMessage(
                expectedWorkspaceId = workspace.workspaceId,
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                workspaces = workspaces,
                strings = strings
            )
            require(reconciliationErrorMessage == null) {
                reconciliationErrorMessage ?: strings.get(R.string.settings_current_workspace_reconcile_failed)
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
            messageController.showMessage(
                message = strings.get(R.string.settings_current_workspace_switched_message, workspace.name)
            )
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    errorMessage = error.message ?: strings.get(R.string.settings_current_workspace_switch_failed)
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
        }
    }

    fun retryLastWorkspaceActionAsync() {
        viewModelScope.launch {
            retryLastWorkspaceAction()
        }
    }

    private fun observeAutoSyncDrivenWorkspaceChanges() {
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
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_CURRENT_WORKSPACE) {
            return
        }

        pendingAutoSyncRequestId = request.requestId
        currentWorkspaceSignatureAtAutoSyncStart = buildCurrentWorkspaceVisibleSignature(uiState = uiState.value)
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val currentWorkspaceSignatureBeforeSync = currentWorkspaceSignatureAtAutoSyncStart
        currentWorkspaceSignatureAtAutoSyncStart = null

        if (completion.outcome !is AutoSyncOutcome.Succeeded) {
            return
        }
        if (completion.request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_CURRENT_WORKSPACE) {
            return
        }

        val currentWorkspaceSignature = buildCurrentWorkspaceVisibleSignature(uiState = uiState.value)
        if (
            currentWorkspaceSignatureBeforeSync == null ||
            currentWorkspaceSignatureBeforeSync == currentWorkspaceSignature
        ) {
            return
        }
        if (currentWorkspaceSignature == lastVisibleAutoSyncChangeSignature) {
            return
        }

        lastVisibleAutoSyncChangeSignature = currentWorkspaceSignature
        messageController.showMessage(message = workspaceUpdatedOnAnotherDeviceMessage(strings = strings))
    }

}

private data class CurrentWorkspaceItemVisibleSignature(
    val workspaceId: String,
    val title: String,
    val subtitle: String,
    val isSelected: Boolean
)

private data class CurrentWorkspaceVisibleSignature(
    val currentWorkspaceName: String,
    val linkedEmail: String?,
    val workspaces: List<CurrentWorkspaceItemVisibleSignature>
)

private fun buildCurrentWorkspaceVisibleSignature(
    uiState: CurrentWorkspaceUiState
): CurrentWorkspaceVisibleSignature {
    return CurrentWorkspaceVisibleSignature(
        currentWorkspaceName = uiState.currentWorkspaceName,
        linkedEmail = uiState.linkedEmail,
        workspaces = uiState.workspaces.map { workspace ->
            CurrentWorkspaceItemVisibleSignature(
                workspaceId = workspace.workspaceId,
                title = workspace.title,
                subtitle = workspace.subtitle,
                isSelected = workspace.isSelected
            )
        }
    )
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
    workspaces: List<CloudWorkspaceSummary>,
    strings: SettingsStringResolver
): String? {
    val selectionErrorMessage = currentWorkspaceSelectionErrorMessage(
        activeWorkspaceId = activeWorkspaceId,
        workspaces = workspaces,
        strings = strings
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
    return strings.get(R.string.settings_current_workspace_reconcile_failed)
}

fun createCurrentWorkspaceViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CurrentWorkspaceViewModel(
                cloudAccountRepository = cloudAccountRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                visibleAppScreenRepository = visibleAppScreenRepository,
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
