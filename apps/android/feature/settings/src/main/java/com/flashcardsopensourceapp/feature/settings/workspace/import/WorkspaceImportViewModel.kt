package com.flashcardsopensourceapp.feature.settings.workspace.importing

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.expectedWorkspacePackageImportCloudFailureMessage
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private data class WorkspaceImportPreviewIdentity(
    val activeWorkspaceId: String,
    val installationId: String
)

private data class WorkspaceImportDraftState(
    val selectedFile: WorkspaceImportSelectedFile?,
    val preview: WorkspacePackageImportPreview?,
    val previewIdentity: WorkspaceImportPreviewIdentity?,
    val addImportTag: Boolean,
    val importTag: String,
    val removedTags: Set<String>,
    val isPreviewing: Boolean,
    val isImporting: Boolean,
    val errorMessage: String,
    val successMessage: String
)

class WorkspaceImportViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val technicalErrorController: AppTechnicalErrorController,
    private val strings: SettingsStringResolver,
    private val currentTimeMillis: () -> Long,
    private val newImportId: () -> String
) : ViewModel() {
    private val cloudSettingsState: StateFlow<CloudSettings> = cloudAccountRepository.observeCloudSettings().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CloudSettings(
            installationId = "",
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = null,
            updatedAtMillis = 0L
        )
    )
    private val draftState = MutableStateFlow(
        value = WorkspaceImportDraftState(
            selectedFile = null,
            preview = null,
            previewIdentity = null,
            addImportTag = true,
            importTag = "",
            removedTags = emptySet(),
            isPreviewing = false,
            isImporting = false,
            errorMessage = "",
            successMessage = ""
        )
    )
    private val isConfirmImportRunning = AtomicBoolean(false)
    private val latestPreviewRequestId = AtomicLong(0L)

    val uiState: StateFlow<WorkspaceImportUiState> = combine(
        cloudSettingsState,
        draftState
    ) { cloudSettings, draft ->
        val currentIdentity: WorkspaceImportPreviewIdentity? = makePreviewIdentity(cloudSettings = cloudSettings)
        val isPreviewCurrent: Boolean = draft.preview != null &&
            draft.selectedFile != null &&
            draft.previewIdentity == currentIdentity
        WorkspaceImportUiState(
            selectedFileName = if (isPreviewCurrent || draft.isPreviewing) {
                draft.selectedFile?.fileName
            } else {
                null
            },
            preview = if (isPreviewCurrent) draft.preview else null,
            addImportTag = draft.addImportTag,
            importTag = draft.importTag,
            removedTags = draft.removedTags,
            isPreviewing = draft.isPreviewing,
            isImporting = draft.isImporting,
            availabilityMessage = workspaceImportAvailabilityMessage(
                cloudSettings = cloudSettings,
                strings = strings
            ),
            errorMessage = draft.errorMessage,
            successMessage = draft.successMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceImportUiState(
            selectedFileName = null,
            preview = null,
            addImportTag = true,
            importTag = "",
            removedTags = emptySet(),
            isPreviewing = false,
            isImporting = false,
            availabilityMessage = strings.get(R.string.settings_import_cloud_required),
            errorMessage = "",
            successMessage = ""
        )
    )

    fun beginPreviewRequest(): Long {
        val previewRequestId: Long = latestPreviewRequestId.incrementAndGet()
        draftState.update { state ->
            state.copy(
                selectedFile = null,
                preview = null,
                previewIdentity = null,
                addImportTag = true,
                importTag = "",
                removedTags = emptySet(),
                isPreviewing = true,
                isImporting = false,
                errorMessage = "",
                successMessage = ""
            )
        }
        return previewRequestId
    }

    internal fun previewSelectedFile(selectedFile: WorkspaceImportSelectedFile) {
        val previewRequestId: Long = beginPreviewRequest()
        previewSelectedFile(
            previewRequestId = previewRequestId,
            selectedFile = selectedFile
        )
    }

    internal fun previewSelectedFile(
        previewRequestId: Long,
        selectedFile: WorkspaceImportSelectedFile
    ) {
        viewModelScope.launch {
            previewSelectedFileAsync(
                previewRequestId = previewRequestId,
                selectedFile = selectedFile
            )
        }
    }

    private suspend fun previewSelectedFileAsync(
        previewRequestId: Long,
        selectedFile: WorkspaceImportSelectedFile
    ) {
        val previewIdentity: WorkspaceImportPreviewIdentity? = makePreviewIdentity(cloudSettings = cloudSettingsState.value)
        if (isCurrentPreviewRequest(previewRequestId = previewRequestId).not()) {
            return
        }
        if (previewIdentity == null) {
            updateDraftStateForPreviewRequest(previewRequestId = previewRequestId) { state ->
                state.copy(
                    selectedFile = null,
                    preview = null,
                    previewIdentity = null,
                    importTag = "",
                    isPreviewing = false,
                    isImporting = false,
                    errorMessage = workspaceImportAvailabilityMessage(
                        cloudSettings = cloudSettingsState.value,
                        strings = strings
                    ),
                    successMessage = ""
                )
            }
            return
        }

        updateDraftStateForPreviewRequest(previewRequestId = previewRequestId) { state ->
            state.copy(
                selectedFile = selectedFile,
                preview = null,
                previewIdentity = previewIdentity,
                addImportTag = true,
                importTag = "",
                removedTags = emptySet(),
                isPreviewing = true,
                isImporting = false,
                errorMessage = "",
                successMessage = ""
            )
        }

        try {
            val preview: WorkspacePackageImportPreview = cloudAccountRepository.previewCurrentWorkspacePackageImport(
                packageBytes = selectedFile.packageBytes.copyOf()
            )
            updateDraftStateForPreviewRequest(previewRequestId = previewRequestId) { state ->
                state.copy(
                    selectedFile = selectedFile,
                    preview = preview,
                    previewIdentity = previewIdentity,
                    addImportTag = preview.defaultOptions.addImportTag,
                    importTag = preview.defaultOptions.suggestedImportTag,
                    removedTags = preview.defaultOptions.removedTags.toSet(),
                    isPreviewing = false,
                    errorMessage = "",
                    successMessage = ""
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            updateDraftStateForPreviewRequest(previewRequestId = previewRequestId) { state ->
                state.copy(
                    selectedFile = null,
                    preview = null,
                    previewIdentity = null,
                    importTag = "",
                    isPreviewing = false,
                    errorMessage = strings.get(R.string.settings_account_status_sync_blocked_body),
                    successMessage = ""
                )
            }
        } catch (error: Exception) {
            handlePreviewImportFailure(
                error = error,
                fallbackMessage = strings.get(R.string.settings_import_preview_failed),
                previewRequestId = previewRequestId
            )
        }
    }

    fun showSelectedFileError(
        previewRequestId: Long,
        message: String
    ) {
        updateDraftStateForPreviewRequest(previewRequestId = previewRequestId) { state ->
            state.copy(
                selectedFile = null,
                preview = null,
                previewIdentity = null,
                importTag = "",
                isPreviewing = false,
                isImporting = false,
                errorMessage = message,
                successMessage = ""
            )
        }
    }

    fun updateAddImportTag(isEnabled: Boolean) {
        draftState.update { state ->
            state.copy(
                addImportTag = isEnabled,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun updateImportTag(importTag: String) {
        draftState.update { state ->
            state.copy(
                importTag = importTag,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun toggleTag(tag: String) {
        val preview: WorkspacePackageImportPreview = requireNotNull(uiState.value.preview) {
            "Workspace package import tag toggles require a current preview."
        }
        require(preview.tagCounts.any { tagCount -> tagCount.tag == tag }) {
            "Workspace package import tag toggle requires an existing preview tag."
        }
        draftState.update { state ->
            val nextRemovedTags: Set<String> = if (state.removedTags.contains(tag)) {
                state.removedTags - tag
            } else {
                state.removedTags + tag
            }
            state.copy(
                removedTags = nextRemovedTags,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun confirmImport() {
        if (isConfirmImportRunning.compareAndSet(false, true).not()) {
            return
        }
        viewModelScope.launch {
            try {
                confirmImportAsync()
            } finally {
                isConfirmImportRunning.set(false)
            }
        }
    }

    private suspend fun confirmImportAsync() {
        val currentUiState: WorkspaceImportUiState = uiState.value
        val selectedFile: WorkspaceImportSelectedFile = draftState.value.selectedFile ?: run {
            draftState.update { state ->
                state.copy(errorMessage = strings.get(R.string.settings_import_preview_required))
            }
            return
        }
        val preview: WorkspacePackageImportPreview = currentUiState.preview ?: run {
            draftState.update { state ->
                state.copy(errorMessage = strings.get(R.string.settings_import_preview_required))
            }
            return
        }
        if (currentUiState.availabilityMessage.isNotEmpty()) {
            draftState.update { state ->
                state.copy(
                    preview = null,
                    selectedFile = null,
                    previewIdentity = null,
                    importTag = "",
                    errorMessage = currentUiState.availabilityMessage,
                    successMessage = ""
                )
            }
            return
        }

        val importedAtMillis: Long = currentTimeMillis()
        val importId: String = newImportId().trim().lowercase(Locale.US)
        val options = try {
            makeWorkspaceImportConfirmOptions(
                preview = preview,
                addImportTag = currentUiState.addImportTag,
                importTag = currentUiState.importTag,
                removedTags = currentUiState.removedTags,
                importedAtMillis = importedAtMillis,
                importId = importId,
                missingImportTagMessage = strings.get(R.string.settings_import_missing_import_tag)
            )
        } catch (error: WorkspaceImportUserException) {
            draftState.update { state ->
                state.copy(
                    errorMessage = error.message ?: strings.get(R.string.settings_import_confirm_failed),
                    successMessage = ""
                )
            }
            return
        }

        draftState.update { state ->
            state.copy(
                isImporting = true,
                errorMessage = "",
                successMessage = ""
            )
        }

        try {
            val result: WorkspacePackageImportConfirmResult = cloudAccountRepository.confirmCurrentWorkspacePackageImport(
                fileName = selectedFile.fileName,
                packageBytes = selectedFile.packageBytes.copyOf(),
                options = options
            )
            draftState.update { state ->
                state.copy(
                    selectedFile = null,
                    preview = null,
                    previewIdentity = null,
                    addImportTag = true,
                    importTag = "",
                    removedTags = emptySet(),
                    isImporting = false,
                    errorMessage = "",
                    successMessage = workspaceImportSuccessMessage(
                        summary = result.summary,
                        strings = strings
                    )
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            draftState.update { state ->
                state.copy(
                    isImporting = false,
                    errorMessage = strings.get(R.string.settings_account_status_sync_blocked_body),
                    successMessage = ""
                )
            }
        } catch (error: Exception) {
            handleImportFailure(
                error = error,
                fallbackMessage = strings.get(R.string.settings_import_confirm_failed),
                isPreviewing = false
            )
        }
    }

    fun clearErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }

    private fun handlePreviewImportFailure(
        error: Exception,
        fallbackMessage: String,
        previewRequestId: Long
    ) {
        val expectedErrorMessage: String? = expectedWorkspacePackageImportCloudFailureMessage(
            error = error,
            fallbackMessage = fallbackMessage
        )
        var didHandleCurrentRequest = false
        updateDraftStateForPreviewRequest(previewRequestId = previewRequestId) { state ->
            didHandleCurrentRequest = true
            state.copy(
                selectedFile = null,
                preview = null,
                previewIdentity = null,
                importTag = "",
                isPreviewing = false,
                isImporting = false,
                errorMessage = expectedErrorMessage ?: fallbackMessage,
                successMessage = ""
            )
        }
        if (didHandleCurrentRequest && expectedErrorMessage == null) {
            technicalErrorController.showTechnicalError(
                error = makeAppTechnicalError(
                    title = strings.get(R.string.settings_technical_error_title),
                    message = fallbackMessage,
                    throwable = error
                ),
                throwable = error
            )
        }
    }

    private fun handleImportFailure(
        error: Exception,
        fallbackMessage: String,
        isPreviewing: Boolean
    ) {
        val expectedErrorMessage: String? = expectedWorkspacePackageImportCloudFailureMessage(
            error = error,
            fallbackMessage = fallbackMessage
        )
        draftState.update { state ->
            state.copy(
                selectedFile = if (isPreviewing) null else state.selectedFile,
                preview = if (isPreviewing) null else state.preview,
                previewIdentity = if (isPreviewing) null else state.previewIdentity,
                importTag = if (isPreviewing) "" else state.importTag,
                isPreviewing = false,
                isImporting = false,
                errorMessage = expectedErrorMessage ?: fallbackMessage,
                successMessage = ""
            )
        }
        if (expectedErrorMessage == null) {
            technicalErrorController.showTechnicalError(
                error = makeAppTechnicalError(
                    title = strings.get(R.string.settings_technical_error_title),
                    message = fallbackMessage,
                    throwable = error
                ),
                throwable = error
            )
        }
    }

    private fun updateDraftStateForPreviewRequest(
        previewRequestId: Long,
        transform: (WorkspaceImportDraftState) -> WorkspaceImportDraftState
    ) {
        draftState.update { state ->
            if (isCurrentPreviewRequest(previewRequestId = previewRequestId)) {
                transform(state)
            } else {
                state
            }
        }
    }

    private fun isCurrentPreviewRequest(previewRequestId: Long): Boolean {
        return latestPreviewRequestId.get() == previewRequestId
    }
}

private fun makePreviewIdentity(cloudSettings: CloudSettings): WorkspaceImportPreviewIdentity? {
    if (cloudSettings.cloudState != CloudAccountState.LINKED) {
        return null
    }
    val activeWorkspaceId: String = cloudSettings.activeWorkspaceId?.trim()?.ifEmpty { null } ?: return null
    val installationId: String = cloudSettings.installationId.trim().ifEmpty { null } ?: return null
    return WorkspaceImportPreviewIdentity(
        activeWorkspaceId = activeWorkspaceId,
        installationId = installationId
    )
}

private fun workspaceImportAvailabilityMessage(
    cloudSettings: CloudSettings,
    strings: SettingsStringResolver
): String {
    if (cloudSettings.cloudState != CloudAccountState.LINKED) {
        return strings.get(R.string.settings_import_cloud_required)
    }
    if (cloudSettings.activeWorkspaceId?.trim().isNullOrEmpty()) {
        return strings.get(R.string.settings_import_workspace_unavailable)
    }
    return ""
}

fun createWorkspaceImportViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    technicalErrorController: AppTechnicalErrorController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceImportViewModel(
                cloudAccountRepository = cloudAccountRepository,
                technicalErrorController = technicalErrorController,
                strings = createSettingsStringResolver(context = applicationContext),
                currentTimeMillis = System::currentTimeMillis,
                newImportId = {
                    UUID.randomUUID().toString().lowercase(Locale.US)
                }
            )
        }
    }
}
