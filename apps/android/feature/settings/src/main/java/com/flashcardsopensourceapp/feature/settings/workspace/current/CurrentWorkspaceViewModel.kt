package com.flashcardsopensourceapp.feature.settings.workspace.current

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.buildCurrentWorkspaceItems
import com.flashcardsopensourceapp.feature.settings.cloud.currentWorkspaceSelectionErrorMessage
import com.flashcardsopensourceapp.feature.settings.cloud.displayCloudAccountStateTitle
import com.flashcardsopensourceapp.feature.settings.cloud.expectedWorkspaceCloudFailureMessage
import com.flashcardsopensourceapp.feature.settings.cloud.resolveSelectedWorkspaceId
import com.flashcardsopensourceapp.feature.settings.cloud.workspaceSelectionTitle
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.resolveWorkspaceName
import com.flashcardsopensourceapp.feature.settings.workspace.shared.workspaceUpdatedOnAnotherDeviceMessage
import kotlinx.coroutines.CancellationException
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
    val successMessage: String,
    val workspaceNameDraft: String,
    val hasUserEditedName: Boolean,
    val isSavingName: Boolean,
    val workspaces: List<CloudWorkspaceSummary>
)

class CurrentWorkspaceViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    private val technicalErrorController: AppTechnicalErrorController,
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
            successMessage = "",
            workspaceNameDraft = "",
            hasUserEditedName = false,
            isSavingName = false,
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
        val workspaceNameDraft = if (draft.hasUserEditedName) {
            draft.workspaceNameDraft
        } else {
            currentWorkspaceName
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
            successMessage = draft.successMessage,
            workspaceNameDraft = workspaceNameDraft,
            isSavingName = draft.isSavingName,
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
            successMessage = "",
            workspaceNameDraft = "",
            isSavingName = false,
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
                errorMessage = "",
                successMessage = ""
            )
        }
        try {
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    errorMessage = "",
                    successMessage = "",
                    workspaces = workspaces
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_current_workspace_load_failed)
            val expectedErrorMessage = expectedWorkspaceCloudFailureMessage(
                error = error,
                fallbackMessage = errorMessage
            )
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Failed,
                    errorMessage = expectedErrorMessage ?: errorMessage,
                    successMessage = ""
                )
            }
            if (expectedErrorMessage == null) {
                showTechnicalError(
                    message = errorMessage,
                    throwable = error
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
        if (
            selection is CloudWorkspaceLinkSelection.Existing &&
            draftState.value.workspaces.none { workspace ->
                workspace.workspaceId == selection.workspaceId
            }
        ) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    pendingWorkspaceTitle = null,
                    errorMessage = strings.get(R.string.settings_current_workspace_invalid_selection),
                    successMessage = ""
                )
            }
            return
        }

        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.SWITCHING,
                pendingWorkspaceTitle = workspaceSelectionTitle(
                    selection = selection,
                    workspaces = state.workspaces,
                    strings = strings
                ),
                retryAction = CurrentWorkspaceRetryAction.CompleteLink(selection = selection),
                errorMessage = "",
                successMessage = "",
                hasUserEditedName = false
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
            if (reconciliationErrorMessage != null) {
                draftState.update { state ->
                    state.copy(
                        operation = CurrentWorkspaceOperation.IDLE,
                        workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                        pendingWorkspaceTitle = null,
                        errorMessage = reconciliationErrorMessage,
                        successMessage = "",
                        hasUserEditedName = false,
                        workspaces = workspaces
                    )
                }
                return
            }
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    pendingWorkspaceTitle = null,
                    retryAction = null,
                    errorMessage = "",
                    successMessage = "",
                    workspaceNameDraft = workspace.name,
                    hasUserEditedName = false,
                    workspaces = workspaces
                )
            }
            messageController.showMessage(
                message = strings.get(R.string.settings_current_workspace_switched_message, workspace.name)
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    errorMessage = strings.get(R.string.settings_account_status_sync_blocked_body),
                    successMessage = ""
                )
            }
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_current_workspace_switch_failed)
            val expectedErrorMessage = expectedWorkspaceCloudFailureMessage(
                error = error,
                fallbackMessage = errorMessage
            )
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    workspaceLoadState = CurrentWorkspaceLoadState.Loaded,
                    errorMessage = expectedErrorMessage ?: errorMessage,
                    successMessage = ""
                )
            }
            if (expectedErrorMessage == null) {
                showTechnicalError(
                    message = errorMessage,
                    throwable = error
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
        if (uiState.value.isLinked.not()) {
            draftState.update { state ->
                state.copy(
                    errorMessage = strings.get(R.string.settings_workspace_rename_guidance),
                    successMessage = ""
                )
            }
            return false
        }

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
            state.copy(
                isSavingName = true,
                errorMessage = "",
                successMessage = ""
            )
        }

        return try {
            val renamedWorkspace = cloudAccountRepository.renameCurrentWorkspace(name = nextName)
            draftState.update { state ->
                state.copy(
                    workspaceNameDraft = renamedWorkspace.name,
                    hasUserEditedName = false,
                    isSavingName = false,
                    errorMessage = "",
                    successMessage = strings.get(R.string.settings_workspace_name_saved),
                    workspaces = renameSelectedWorkspace(
                        workspaces = state.workspaces,
                        renamedWorkspace = renamedWorkspace
                    )
                )
            }
            true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_workspace_name_save_failed)
            val expectedErrorMessage = expectedWorkspaceCloudFailureMessage(
                error = error,
                fallbackMessage = errorMessage
            )
            draftState.update { state ->
                state.copy(
                    isSavingName = false,
                    errorMessage = expectedErrorMessage ?: errorMessage,
                    successMessage = ""
                )
            }
            if (expectedErrorMessage == null) {
                showTechnicalError(
                    message = errorMessage,
                    throwable = error
                )
            }
            false
        }
    }

    fun saveWorkspaceNameAsync() {
        viewModelScope.launch {
            saveWorkspaceName()
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

    private fun showTechnicalError(
        message: String,
        throwable: Throwable
    ) {
        technicalErrorController.showTechnicalError(
            error = makeAppTechnicalError(
                title = strings.get(R.string.settings_technical_error_title),
                message = message,
                throwable = throwable
            ),
            throwable = throwable
        )
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

private fun renameSelectedWorkspace(
    workspaces: List<CloudWorkspaceSummary>,
    renamedWorkspace: CloudWorkspaceSummary
): List<CloudWorkspaceSummary> {
    return workspaces.map { workspace ->
        if (workspace.workspaceId == renamedWorkspace.workspaceId) {
            workspace.copy(name = renamedWorkspace.name)
        } else {
            workspace
        }
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
    technicalErrorController: AppTechnicalErrorController,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CurrentWorkspaceViewModel(
                cloudAccountRepository = cloudAccountRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                technicalErrorController = technicalErrorController,
                visibleAppScreenRepository = visibleAppScreenRepository,
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
