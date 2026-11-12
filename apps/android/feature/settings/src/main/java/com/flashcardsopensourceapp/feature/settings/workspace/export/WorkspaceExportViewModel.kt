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
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportFormat
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagCount
import com.flashcardsopensourceapp.data.local.model.workspace.isWorkspacePackageExportGeneratedImportTag
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.expectedWorkspacePackageExportCloudFailureMessage
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val defaultAnkiDeckName: String = "Nibomo Export"

private data class WorkspacePackageExportPreviewIdentity(
    val activeWorkspaceId: String,
    val installationId: String
)

private data class WorkspacePackageExportPreservedDraft(
    val preview: WorkspacePackageExportPreview,
    val previewIdentity: WorkspacePackageExportPreviewIdentity,
    val metadataDraft: WorkspacePackageExportMetadataDraft,
    val cardSelectionTags: Set<String>,
    val cardSelectionTagCounts: List<WorkspacePackageExportTagCount>,
    val knownRegularTags: Set<String>,
    val includedTags: Set<String>
)

private data class WorkspaceExportDraftState(
    val packagePreview: WorkspacePackageExportPreview?,
    val packagePreviewIdentity: WorkspacePackageExportPreviewIdentity?,
    val packageMetadataDraft: WorkspacePackageExportMetadataDraft,
    val packageCardSelectionTags: Set<String>,
    val packageCardSelectionTagCounts: List<WorkspacePackageExportTagCount>,
    val packageKnownRegularTags: Set<String>,
    val packageIncludedTags: Set<String>,
    val isPackagePreviewing: Boolean,
    val isPackageExporting: Boolean,
    val errorMessage: String
)

class WorkspaceExportViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val technicalErrorController: AppTechnicalErrorController,
    private val strings: SettingsStringResolver,
    val format: WorkspacePackageExportFormat
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
            packagePreview = null,
            packagePreviewIdentity = null,
            packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
            packageCardSelectionTags = emptySet(),
            packageCardSelectionTagCounts = emptyList(),
            packageKnownRegularTags = emptySet(),
            packageIncludedTags = emptySet(),
            isPackagePreviewing = false,
            isPackageExporting = false,
            errorMessage = ""
        )
    )
    private val isPackageExportRunning = AtomicBoolean(false)
    private val latestPackagePreviewRequestId = AtomicLong(0L)
    private var pendingPackageExport: WorkspacePackageExportSave? = null

    val uiState: StateFlow<WorkspaceExportUiState> = combine(
        cloudSettingsState,
        draftState
    ) { cloudSettings, draft ->
        val currentIdentity: WorkspacePackageExportPreviewIdentity? = makePackagePreviewIdentity(
            cloudSettings = cloudSettings
        )
        val isPackagePreviewCurrent: Boolean = draft.packagePreview != null &&
            draft.packagePreviewIdentity == currentIdentity
        val currentPackagePreview: WorkspacePackageExportPreview? = if (isPackagePreviewCurrent) {
            draft.packagePreview
        } else {
            null
        }
        WorkspaceExportUiState(
            format = format,
            packagePreview = currentPackagePreview,
            packageMetadataDraft = if (currentPackagePreview != null) {
                draft.packageMetadataDraft
            } else {
                emptyWorkspacePackageExportMetadataDraft()
            },
            packageCardSelectionTags = if (currentPackagePreview != null) draft.packageCardSelectionTags else emptySet(),
            packageCardSelectionTagCounts = if (currentPackagePreview != null) {
                draft.packageCardSelectionTagCounts
            } else {
                emptyList()
            },
            packageIncludedTags = if (currentPackagePreview != null) {
                draft.packageIncludedTags
            } else {
                emptySet()
            },
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
            format = format,
            packagePreview = null,
            packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
            packageCardSelectionTags = emptySet(),
            packageCardSelectionTagCounts = emptyList(),
            packageIncludedTags = emptySet(),
            isPackagePreviewing = false,
            isPackageExporting = false,
            packageAvailabilityMessage = strings.get(R.string.settings_export_package_cloud_required),
            errorMessage = ""
        )
    )

    fun previewPackageExport() {
        requestPackageExportPreview(
            selectedCardTags = emptySet(),
            preservedCardSelectionTagCounts = emptyList(),
            preservedDraft = null
        )
    }

    private fun requestPackageExportPreview(
        selectedCardTags: Set<String>,
        preservedCardSelectionTagCounts: List<WorkspacePackageExportTagCount>,
        preservedDraft: WorkspacePackageExportPreservedDraft?
    ) {
        val previewRequestId: Long = latestPackagePreviewRequestId.incrementAndGet()
        viewModelScope.launch {
            previewPackageExportAsync(
                previewRequestId = previewRequestId,
                selectedCardTags = selectedCardTags,
                preservedCardSelectionTagCounts = preservedCardSelectionTagCounts,
                preservedDraft = preservedDraft
            )
        }
    }

    private suspend fun previewPackageExportAsync(
        previewRequestId: Long,
        selectedCardTags: Set<String>,
        preservedCardSelectionTagCounts: List<WorkspacePackageExportTagCount>,
        preservedDraft: WorkspacePackageExportPreservedDraft?
    ) {
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
                    packageCardSelectionTags = emptySet(),
                    packageCardSelectionTagCounts = emptyList(),
                    packageKnownRegularTags = emptySet(),
                    packageIncludedTags = emptySet(),
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
                packageMetadataDraft = preservedDraft?.metadataDraft ?: emptyWorkspacePackageExportMetadataDraft(),
                packageCardSelectionTags = selectedCardTags,
                packageCardSelectionTagCounts = preservedCardSelectionTagCounts,
                packageKnownRegularTags = preservedDraft?.knownRegularTags ?: emptySet(),
                packageIncludedTags = preservedDraft?.includedTags ?: emptySet(),
                isPackagePreviewing = true,
                isPackageExporting = false,
                errorMessage = ""
            )
        }

        try {
            val preview: WorkspacePackageExportPreview = cloudAccountRepository.previewCurrentWorkspacePackageExport(
                expectedWorkspaceId = previewIdentity.activeWorkspaceId,
                request = makeWorkspacePackageExportPreviewRequest(selectedCardTags = selectedCardTags)
            )
            updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
                val nextCardSelectionTagCounts: List<WorkspacePackageExportTagCount> = if (selectedCardTags.isEmpty()) {
                    preview.availableTagCounts
                } else {
                    preservedCardSelectionTagCounts.ifEmpty { preview.availableTagCounts }
                }
                val nextMetadataDraft = preservedDraft?.metadataDraft ?: when (format) {
                    WorkspacePackageExportFormat.NIBOMO -> makeWorkspacePackageExportMetadataDraft(
                        defaultPackageMetadata = preview.defaultPackageMetadata
                    )
                    WorkspacePackageExportFormat.ANKI ->
                        emptyWorkspacePackageExportMetadataDraft().copy(label = defaultAnkiDeckName)
                }
                val nextKnownRegularTags: Set<String> = makeWorkspacePackageExportKnownRegularTags(preview = preview)
                val nextIncludedTags: Set<String> = preservedDraft?.let { draft ->
                    makeWorkspacePackageExportRefreshedIncludedTags(
                        knownRegularTags = draft.knownRegularTags,
                        includedTags = draft.includedTags,
                        refreshedPreview = preview
                    )
                } ?: makeWorkspacePackageExportInitialIncludedTags(preview = preview)
                state.copy(
                    packagePreview = preview,
                    packagePreviewIdentity = previewIdentity,
                    packageMetadataDraft = nextMetadataDraft,
                    packageCardSelectionTags = selectedCardTags,
                    packageCardSelectionTagCounts = nextCardSelectionTagCounts,
                    packageKnownRegularTags = preservedDraft?.knownRegularTags
                        ?.plus(nextKnownRegularTags)
                        ?: nextKnownRegularTags,
                    packageIncludedTags = nextIncludedTags,
                    isPackagePreviewing = false,
                    errorMessage = ""
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
                restoreWorkspacePackageExportDraftAfterPreviewFailure(
                    state = state,
                    preservedDraft = preservedDraft,
                    errorMessage = strings.get(R.string.settings_account_status_sync_blocked_body)
                )
            }
        } catch (error: Exception) {
            handlePackageExportFailureForPreviewRequest(
                error = error,
                fallbackMessage = strings.get(R.string.settings_export_package_preview_failed),
                previewRequestId = previewRequestId,
                preservedDraft = preservedDraft
            )
        }
    }

    suspend fun preparePackageExportDownload(destinationDirectory: File): WorkspacePackageExportDownloadResponse? {
        if (isPackageExportRunning.compareAndSet(false, true).not()) {
            return null
        }
        return try {
            preparePackageExportDownloadAsync(destinationDirectory = destinationDirectory)
        } catch (error: CancellationException) {
            finishPackageExport()
            throw error
        } finally {
            isPackageExportRunning.set(false)
        }
    }

    private suspend fun preparePackageExportDownloadAsync(
        destinationDirectory: File
    ): WorkspacePackageExportDownloadResponse? {
        val draft = draftState.value
        if (draft.isPackagePreviewing || draft.isPackageExporting) {
            return null
        }
        val cloudSettings = cloudSettingsState.value
        val availabilityMessage = workspacePackageExportAvailabilityMessage(cloudSettings = cloudSettings, strings = strings)
        if (availabilityMessage.isNotEmpty()) {
            showExportError(message = availabilityMessage)
            return null
        }
        val preview = draft.packagePreview
        val previewIdentity = draft.packagePreviewIdentity
        if (preview == null || previewIdentity == null || previewIdentity != makePackagePreviewIdentity(cloudSettings)) {
            showExportError(message = strings.get(R.string.settings_export_package_preview_required))
            return null
        }

        if (preview.isAnkiSelectionEmpty(format = format)) {
            showExportError(message = strings.get(R.string.settings_export_anki_empty))
            return null
        }

        draftState.update { state ->
            state.copy(
                isPackageExporting = true,
                errorMessage = ""
            )
        }

        var archiveFile: File? = null
        var didPrepareExport = false
        return try {
            withContext(Dispatchers.IO) {
                archiveFile = createWorkspacePackageExportFile(destinationDirectory = destinationDirectory)
            }
            val download = cloudAccountRepository.exportCurrentWorkspacePackage(
                expectedWorkspaceId = previewIdentity.activeWorkspaceId,
                format = format,
                request = makeWorkspacePackageExportRequest(
                    preview = preview,
                    metadataDraft = draft.packageMetadataDraft,
                    selectedCardTags = draft.packageCardSelectionTags,
                    includedTags = draft.packageIncludedTags
                ),
                destination = checkNotNull(archiveFile)
            )
            if (previewIdentity != makePackagePreviewIdentity(cloudSettings = cloudSettingsState.value)) {
                showExportError(message = strings.get(R.string.settings_export_package_workspace_unavailable))
                null
            } else {
                didPrepareExport = true
                download
            }
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
        } finally {
            if (didPrepareExport.not()) {
                archiveFile?.let { deleteWorkspacePackageExportEntry(entry = it) }
            }
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

    fun togglePackageCardSelectionTag(tag: String) {
        val currentState: WorkspaceExportDraftState = draftState.value
        require(currentState.packageCardSelectionTagCounts.any { tagCount -> tagCount.tag == tag }) {
            "Workspace package export card selection tag toggle requires an existing preview tag."
        }
        val nextSelectedTags: Set<String> = if (currentState.packageCardSelectionTags.contains(tag)) {
            currentState.packageCardSelectionTags - tag
        } else {
            currentState.packageCardSelectionTags + tag
        }
        requestPackageExportPreview(
            selectedCardTags = nextSelectedTags,
            preservedCardSelectionTagCounts = currentState.packageCardSelectionTagCounts,
            preservedDraft = WorkspacePackageExportPreservedDraft(
                preview = requireNotNull(currentState.packagePreview) {
                    "Workspace package export card selection refresh requires a current preview."
                },
                previewIdentity = requireNotNull(currentState.packagePreviewIdentity) {
                    "Workspace package export card selection refresh requires a current preview identity."
                },
                metadataDraft = currentState.packageMetadataDraft,
                cardSelectionTags = currentState.packageCardSelectionTags,
                cardSelectionTagCounts = currentState.packageCardSelectionTagCounts,
                knownRegularTags = currentState.packageKnownRegularTags,
                includedTags = currentState.packageIncludedTags
            )
        )
    }

    fun togglePackageIncludedTag(tag: String) {
        val preview: WorkspacePackageExportPreview = requireNotNull(uiState.value.packagePreview) {
            "Workspace package export tag toggles require a current preview."
        }
        require(preview.availableTagCounts.any { tagCount -> tagCount.tag == tag }) {
            "Workspace package export tag toggle requires an existing preview tag."
        }
        require(isWorkspacePackageExportGeneratedImportTag(tag = tag).not()) {
            "Workspace package export generated import tags cannot be included."
        }
        draftState.update { state ->
            val nextIncludedTags: Set<String> = if (state.packageIncludedTags.contains(tag)) {
                state.packageIncludedTags - tag
            } else {
                state.packageIncludedTags + tag
            }
            state.copy(
                packageIncludedTags = nextIncludedTags,
                errorMessage = ""
            )
        }
    }

    internal suspend fun preparePackageExportSave(cacheDirectory: File): String? {
        val packageExport = preparePackageExportDownload(destinationDirectory = cacheDirectory) ?: return null
        var save: WorkspacePackageExportSave? = null
        try {
            check(pendingPackageExport == null) {
                "An Android package export is already waiting for a destination."
            }
            withContext(Dispatchers.IO) {
                save = openWorkspacePackageExportSave(packageExport = packageExport)
            }
            val preparedSave = checkNotNull(save)
            pendingPackageExport = preparedSave
            return preparedSave.fileName
        } catch (error: Exception) {
            val preparedSave = save
            if (preparedSave == null) {
                deleteWorkspacePackageExportEntry(entry = packageExport.archiveFile)
            } else {
                preparedSave.close()
            }
            throw error
        }
    }

    internal fun consumePendingPackageExport(): WorkspacePackageExportSave? {
        val packageExport = pendingPackageExport
        pendingPackageExport = null
        return packageExport
    }

    override fun onCleared() {
        discardPendingPackageExport()
    }

    private fun discardPendingPackageExport() {
        consumePendingPackageExport()?.close()
    }

    fun finishPackageExport() {
        discardPendingPackageExport()
        draftState.update { state ->
            state.copy(isPackageExporting = false)
        }
    }

    fun showExportError(message: String) {
        discardPendingPackageExport()
        draftState.update { state ->
            state.copy(
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
        previewRequestId: Long,
        preservedDraft: WorkspacePackageExportPreservedDraft?
    ) {
        val expectedErrorMessage: String? = expectedWorkspacePackageExportCloudFailureMessage(
            error = error,
            fallbackMessage = fallbackMessage,
            ankiEmptyMessage = strings.get(R.string.settings_export_anki_empty)
        )
        var didHandleCurrentRequest = false
        updateDraftStateForPackagePreviewRequest(previewRequestId = previewRequestId) { state ->
            didHandleCurrentRequest = true
            restoreWorkspacePackageExportDraftAfterPreviewFailure(
                state = state,
                preservedDraft = preservedDraft,
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
            fallbackMessage = fallbackMessage,
            ankiEmptyMessage = strings.get(R.string.settings_export_anki_empty)
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

private fun restoreWorkspacePackageExportDraftAfterPreviewFailure(
    state: WorkspaceExportDraftState,
    preservedDraft: WorkspacePackageExportPreservedDraft?,
    errorMessage: String
): WorkspaceExportDraftState {
    if (preservedDraft == null) {
        return state.copy(
            packagePreview = null,
            packagePreviewIdentity = null,
            packageMetadataDraft = emptyWorkspacePackageExportMetadataDraft(),
            packageCardSelectionTags = emptySet(),
            packageCardSelectionTagCounts = emptyList(),
            packageKnownRegularTags = emptySet(),
            packageIncludedTags = emptySet(),
            isPackagePreviewing = false,
            isPackageExporting = false,
            errorMessage = errorMessage
        )
    }
    return state.copy(
        packagePreview = preservedDraft.preview,
        packagePreviewIdentity = preservedDraft.previewIdentity,
        packageMetadataDraft = preservedDraft.metadataDraft,
        packageCardSelectionTags = preservedDraft.cardSelectionTags,
        packageCardSelectionTagCounts = preservedDraft.cardSelectionTagCounts,
        packageKnownRegularTags = preservedDraft.knownRegularTags,
        packageIncludedTags = preservedDraft.includedTags,
        isPackagePreviewing = false,
        isPackageExporting = false,
        errorMessage = errorMessage
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
    cloudAccountRepository: CloudAccountRepository,
    technicalErrorController: AppTechnicalErrorController,
    applicationContext: Context,
    format: WorkspacePackageExportFormat
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceExportViewModel(
                cloudAccountRepository = cloudAccountRepository,
                technicalErrorController = technicalErrorController,
                strings = createSettingsStringResolver(context = applicationContext),
                format = format
            )
        }
    }
}
