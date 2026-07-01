package com.flashcardsopensourceapp.feature.settings.workspace.export

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
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.isWorkspacePackageExportGeneratedImportTag
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.expectedWorkspacePackageExportCloudFailureMessage
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
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

private data class WorkspacePackageExportPreviewIdentity(
    val activeWorkspaceId: String,
    val installationId: String
)

private data class WorkspaceExportDraftState(
    val isExporting: Boolean,
    val packagePreview: WorkspacePackageExportPreview?,
    val packagePreviewIdentity: WorkspacePackageExportPreviewIdentity?,
    val packageMetadataDraft: WorkspacePackageExportMetadataDraft,
    val packageRemovedTags: Set<String>,
    val isPackagePreviewing: Boolean,
    val isPackageExporting: Boolean,
    val errorMessage: String
)

class WorkspaceExportViewModel(
    private val workspaceRepository: WorkspaceRepository,
    private val cloudAccountRepository: CloudAccountRepository,
    private val technicalErrorController: AppTechnicalErrorController,
    private val strings: SettingsStringResolver
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
        value = WorkspaceExportDraftState(
            isExporting = false,
            packagePreview = null,
            packagePreviewIdentity = null,
            packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
            packageRemovedTags = emptySet(),
            isPackagePreviewing = false,
            isPackageExporting = false,
            errorMessage = ""
        )
    )
    private val isPackageExportRunning = AtomicBoolean(false)
    private val latestPackagePreviewRequestId = AtomicLong(0L)

    val uiState: StateFlow<WorkspaceExportUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        cloudSettingsState,
        draftState
    ) { overview, cloudSettings, draft ->
        val currentIdentity: WorkspacePackageExportPreviewIdentity? = makePackagePreviewIdentity(
            cloudSettings = cloudSettings
        )
        val isPackagePreviewCurrent: Boolean = draft.packagePreview != null &&
            draft.packagePreviewIdentity == currentIdentity
        WorkspaceExportUiState(
            workspaceName = overview?.workspaceName ?: strings.get(R.string.settings_unavailable),
            activeCardsCount = overview?.totalCards ?: 0,
            isExporting = draft.isExporting,
            packagePreview = if (isPackagePreviewCurrent) draft.packagePreview else null,
            packageMetadataDraft = if (isPackagePreviewCurrent) {
                draft.packageMetadataDraft
            } else {
                emptyWorkspacePackageExportMetadataDraft()
            },
            packageRemovedTags = if (isPackagePreviewCurrent) draft.packageRemovedTags else emptySet(),
            isPackagePreviewing = draft.isPackagePreviewing,
            isPackageExporting = draft.isPackageExporting,
            packageAvailabilityMessage = workspacePackageExportAvailabilityMessage(
                cloudSettings = cloudSettings,
                strings = strings
            ),
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceExportUiState(
            workspaceName = strings.get(R.string.settings_loading),
            activeCardsCount = 0,
            isExporting = false,
            packagePreview = null,
            packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
            packageRemovedTags = emptySet(),
            isPackagePreviewing = false,
            isPackageExporting = false,
            packageAvailabilityMessage = strings.get(R.string.settings_export_package_cloud_required),
            errorMessage = ""
        )
    )

    suspend fun prepareExportData(): WorkspaceExportData? {
        draftState.update { state ->
            state.copy(
                isExporting = true,
                errorMessage = ""
            )
        }

        return try {
            val exportData = workspaceRepository.loadWorkspaceExportData()
            if (exportData == null) {
                draftState.update { state ->
                    state.copy(
                        isExporting = false,
                        errorMessage = strings.get(R.string.settings_export_unavailable)
                    )
                }
            }
            exportData
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_export_prepare_failed)
            draftState.update { state ->
                state.copy(
                    isExporting = false,
                    errorMessage = errorMessage
                )
            }
            technicalErrorController.showTechnicalError(
                error = makeAppTechnicalError(
                    title = strings.get(R.string.settings_technical_error_title),
                    message = errorMessage,
                    throwable = error
                ),
                throwable = error
            )
            null
        }
    }

    fun previewPackageExport() {
        val previewRequestId: Long = latestPackagePreviewRequestId.incrementAndGet()
        viewModelScope.launch {
            previewPackageExportAsync(previewRequestId = previewRequestId)
        }
    }

    private suspend fun previewPackageExportAsync(previewRequestId: Long) {
        val previewIdentity: WorkspacePackageExportPreviewIdentity? = makePackagePreviewIdentity(
            cloudSettings = cloudSettingsState.value
        )
        if (isCurrentPackagePreviewRequest(previewRequestId = previewRequestId).not()) {
            return
        }
        if (previewIdentity == null) {
            updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
                state.copy(
                    packagePreview = null,
                    packagePreviewIdentity = null,
                    packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
                    packageRemovedTags = emptySet(),
                    isPackagePreviewing = false,
                    isPackageExporting = false,
                    errorMessage = workspacePackageExportAvailabilityMessage(
                        cloudSettings = cloudSettingsState.value,
                        strings = strings
                    )
                )
            }
            return
        }

        updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
            state.copy(
                packagePreview = null,
                packagePreviewIdentity = previewIdentity,
                packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
                packageRemovedTags = emptySet(),
                isPackagePreviewing = true,
                isPackageExporting = false,
                errorMessage = ""
            )
        }

        try {
            val preview: WorkspacePackageExportPreview = cloudAccountRepository.previewCurrentWorkspacePackageExport(
                request = makeDefaultWorkspacePackageExportPreviewRequest()
            )
            updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
                state.copy(
                    packagePreview = preview,
                    packagePreviewIdentity = previewIdentity,
                    packageMetadataDraft = makeWorkspacePackageExportMetadataDraft(
                        defaultPackageMetadata = preview.defaultPackageMetadata
                    ),
                    packageRemovedTags = makeWorkspacePackageExportInitialRemovedTags(preview = preview),
                    isPackagePreviewing = false,
                    errorMessage = ""
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
                state.copy(
                    packagePreview = null,
                    packagePreviewIdentity = null,
                    packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
                    packageRemovedTags = emptySet(),
                    isPackagePreviewing = false,
                    errorMessage = strings.get(R.string.settings_account_status_sync_blocked_body)
                )
            }
        } catch (error: Exception) {
            handlePackageExportFailureForPreviewRequest(
                error = error,
                fallbackMessage = strings.get(R.string.settings_export_package_preview_failed),
                previewRequestId = previewRequestId
            )
        }
    }

    suspend fun preparePackageExportDownload(): WorkspacePackageExportDownloadResponse? {
        if (isPackageExportRunning.compareAndSet(false, true).not()) {
            return null
        }
        return try {
            preparePackageExportDownloadAsync()
        } finally {
            isPackageExportRunning.set(false)
        }
    }

    private suspend fun preparePackageExportDownloadAsync(): WorkspacePackageExportDownloadResponse? {
        val currentUiState: WorkspaceExportUiState = uiState.value
        val preview: WorkspacePackageExportPreview = currentUiState.packagePreview ?: run {
            draftState.update { state ->
                state.copy(errorMessage = strings.get(R.string.settings_export_package_preview_required))
            }
            return null
        }
        if (currentUiState.packageAvailabilityMessage.isNotEmpty()) {
            draftState.update { state ->
                state.copy(
                    packagePreview = null,
                    packagePreviewIdentity = null,
                    packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
                    packageRemovedTags = emptySet(),
                    errorMessage = currentUiState.packageAvailabilityMessage
                )
            }
            return null
        }

        draftState.update { state ->
            state.copy(
                isPackageExporting = true,
                errorMessage = ""
            )
        }

        return try {
            cloudAccountRepository.exportCurrentWorkspacePackage(
                request = makeWorkspacePackageExportRequest(
                    preview = preview,
                    metadataDraft = currentUiState.packageMetadataDraft,
                    removedTags = currentUiState.packageRemovedTags
                )
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            draftState.update { state ->
                state.copy(
                    isPackageExporting = false,
                    errorMessage = strings.get(R.string.settings_account_status_sync_blocked_body)
                )
            }
            null
        } catch (error: Exception) {
            handlePackageExportFailure(
                error = error,
                fallbackMessage = strings.get(R.string.settings_export_package_download_failed)
            )
            null
        }
    }

    fun updatePackageLabel(label: String) {
        draftState.update { state ->
            state.copy(
                packageMetadataDraft = state.packageMetadataDraft.copy(label = label),
                errorMessage = ""
            )
        }
    }

    fun updatePackageAuthor(author: String) {
        draftState.update { state ->
            state.copy(
                packageMetadataDraft = state.packageMetadataDraft.copy(author = author),
                errorMessage = ""
            )
        }
    }

    fun updatePackageCreatedAt(createdAt: String) {
        draftState.update { state ->
            state.copy(
                packageMetadataDraft = state.packageMetadataDraft.copy(createdAt = createdAt),
                errorMessage = ""
            )
        }
    }

    fun updatePackageSourceUrl(sourceUrl: String) {
        draftState.update { state ->
            state.copy(
                packageMetadataDraft = state.packageMetadataDraft.copy(sourceUrl = sourceUrl),
                errorMessage = ""
            )
        }
    }

    fun updatePackageComment(comment: String) {
        draftState.update { state ->
            state.copy(
                packageMetadataDraft = state.packageMetadataDraft.copy(comment = comment),
                errorMessage = ""
            )
        }
    }

    fun togglePackageRemovedTag(tag: String) {
        val preview: WorkspacePackageExportPreview = requireNotNull(uiState.value.packagePreview) {
            "Workspace package export tag toggles require a current preview."
        }
        require(preview.availableTagCounts.any { tagCount -> tagCount.tag == tag }) {
            "Workspace package export tag toggle requires an existing preview tag."
        }
        require(isWorkspacePackageExportGeneratedImportTag(tag = tag).not()) {
            "Workspace package export generated import tags cannot be kept."
        }
        draftState.update { state ->
            val nextRemovedTags: Set<String> = if (state.packageRemovedTags.contains(tag)) {
                state.packageRemovedTags - tag
            } else {
                state.packageRemovedTags + tag
            }
            state.copy(
                packageRemovedTags = nextRemovedTags,
                errorMessage = ""
            )
        }
    }

    fun finishExport() {
        draftState.update { state ->
            state.copy(isExporting = false)
        }
    }

    fun finishPackageExport() {
        draftState.update { state ->
            state.copy(isPackageExporting = false)
        }
    }

    fun showExportError(message: String) {
        draftState.update { state ->
            state.copy(
                isExporting = false,
                isPackageExporting = false,
                errorMessage = message
            )
        }
    }

    fun clearErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }

    private fun handlePackageExportFailureForPreviewRequest(
        error: Exception,
        fallbackMessage: String,
        previewRequestId: Long
    ) {
        val expectedErrorMessage: String? = expectedWorkspacePackageExportCloudFailureMessage(
            error = error,
            fallbackMessage = fallbackMessage
        )
        var didHandleCurrentRequest = false
        updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
            didHandleCurrentRequest = true
            state.copy(
                packagePreview = null,
                packagePreviewIdentity = null,
                packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
                packageRemovedTags = emptySet(),
                isPackagePreviewing = false,
                isPackageExporting = false,
                errorMessage = expectedErrorMessage ?: fallbackMessage
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

    private fun handlePackageExportFailure(
        error: Exception,
        fallbackMessage: String
    ) {
        val expectedErrorMessage: String? = expectedWorkspacePackageExportCloudFailureMessage(
            error = error,
            fallbackMessage = fallbackMessage
        )
        draftState.update { state ->
            state.copy(
                isPackagePreviewing = false,
                isPackageExporting = false,
                errorMessage = expectedErrorMessage ?: fallbackMessage
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

    private fun updateDraftStateForPackagePreviewRequest(
        previewRequestId: Long,
        transform: (WorkspaceExportDraftState) -> WorkspaceExportDraftState
    ) {
        draftState.update { state ->
            if (isCurrentPackagePreviewRequest(previewRequestId = previewRequestId)) {
                transform(state)
            } else {
                state
            }
        }
    }

    private fun isCurrentPackagePreviewRequest(previewRequestId: Long): Boolean {
        return latestPackagePreviewRequestId.get() == previewRequestId
    }
}

private fun emptyWorkspacePackageExportMetadataDraft(): WorkspacePackageExportMetadataDraft {
    return WorkspacePackageExportMetadataDraft(
        label = "",
        author = "",
        comment = "",
        createdAt = "",
        sourceUrl = ""
    )
}

private fun makePackagePreviewIdentity(cloudSettings: CloudSettings): WorkspacePackageExportPreviewIdentity? {
    if (cloudSettings.cloudState != CloudAccountState.LINKED) {
        return null
    }
    val activeWorkspaceId: String = cloudSettings.activeWorkspaceId?.trim()?.ifEmpty { null } ?: return null
    val installationId: String = cloudSettings.installationId.trim().ifEmpty { null } ?: return null
    return WorkspacePackageExportPreviewIdentity(
        activeWorkspaceId = activeWorkspaceId,
        installationId = installationId
    )
}

private fun workspacePackageExportAvailabilityMessage(
    cloudSettings: CloudSettings,
    strings: SettingsStringResolver
): String {
    if (cloudSettings.cloudState != CloudAccountState.LINKED) {
        return strings.get(R.string.settings_export_package_cloud_required)
    }
    if (cloudSettings.activeWorkspaceId?.trim().isNullOrEmpty()) {
        return strings.get(R.string.settings_export_package_workspace_unavailable)
    }
    return ""
}

fun createWorkspaceExportViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    technicalErrorController: AppTechnicalErrorController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceExportViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                technicalErrorController = technicalErrorController,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
