package com.flashcardsopensourceapp.feature.ai.anki

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.aiChatMaximumUploadedAttachmentsPerMessage
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.LocalGuestWorkspaceMigration
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.input.AiAttachmentImportUserException
import com.flashcardsopensourceapp.feature.ai.input.deleteAiChatAttachmentStagedFiles
import com.flashcardsopensourceapp.feature.ai.input.makeAnkiPackageAttachmentFromUri
import com.flashcardsopensourceapp.feature.ai.strings.aiTextProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class AiAnkiImport(
    val message: String,
    val attachments: List<AiChatAttachment.Binary>
)

data class AiAnkiImportOrigin(
    val workspaceId: String,
    val cloudSettings: CloudSettings,
    val configuration: CloudServiceConfiguration,
    val previousGuestMigration: LocalGuestWorkspaceMigration?
)

internal data class AnkiImportFile(val uri: Uri, val attachment: AiChatAttachment.Binary)

internal data class AnkiImportUiState(
    val origin: AiAnkiImportOrigin?,
    val files: List<AnkiImportFile>,
    val isPreparing: Boolean,
    val isPickerOpen: Boolean,
    val isCheckingFiles: Boolean,
    val isStarting: Boolean,
    val errorMessage: String?
) {
    val isBusy: Boolean
        get() = isPreparing || isPickerOpen || isCheckingFiles || isStarting
}

class AnkiImportViewModel(
    private val applicationContext: Context,
    captureImportOrigin: suspend () -> AiAnkiImportOrigin?
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow(
        AnkiImportUiState(
            origin = null,
            files = emptyList(),
            isPreparing = true,
            isPickerOpen = false,
            isCheckingFiles = false,
            isStarting = false,
            errorMessage = null
        )
    )
    internal val uiState: StateFlow<AnkiImportUiState> = uiStateMutable.asStateFlow()

    init {
        viewModelScope.launch {
            val origin = captureImportOrigin()
            uiStateMutable.value = uiStateMutable.value.copy(
                origin = origin,
                isPreparing = false,
                errorMessage = uiStateMutable.value.errorMessage ?: if (origin == null) {
                    applicationContext.getString(R.string.ai_anki_import_workspace_unavailable)
                } else {
                    null
                }
            )
        }
    }

    internal fun beginFilePicker(): Boolean {
        val state = uiStateMutable.value
        if (state.origin == null || state.isBusy || state.files.size >= aiChatMaximumUploadedAttachmentsPerMessage) {
            return false
        }

        uiStateMutable.value = state.copy(isPickerOpen = true, errorMessage = null)
        return true
    }

    internal fun onFilePickerUnavailable() {
        uiStateMutable.value = uiStateMutable.value.copy(
            isPickerOpen = false,
            errorMessage = applicationContext.getString(R.string.ai_anki_import_picker_unavailable)
        )
    }

    internal fun onFilePickerResult(uris: List<Uri>) {
        val state = uiStateMutable.value
        if (state.isPickerOpen.not()) {
            if (uris.isNotEmpty()) {
                showError(message = applicationContext.getString(R.string.ai_anki_import_choose_files_again))
            }
            return
        }

        uiStateMutable.value = state.copy(isPickerOpen = false)
        stageFiles(uris = uris)
    }

    internal fun onFilesDropped(uris: List<Uri>): Job? {
        return stageFiles(uris = uris)
    }

    private fun stageFiles(uris: List<Uri>): Job? {
        val state = uiStateMutable.value
        if (state.origin == null || state.isBusy) return null
        val existingUris = state.files.map { file -> file.uri }.toSet()
        val newUris = uris.distinct().filterNot(existingUris::contains)
        if (newUris.isEmpty()) {
            return null
        }

        if (state.files.size + newUris.size > aiChatMaximumUploadedAttachmentsPerMessage) {
            showError(
                message = applicationContext.getString(
                    R.string.ai_anki_import_too_many_files,
                    aiChatMaximumUploadedAttachmentsPerMessage
                )
            )
            return null
        }

        uiStateMutable.value = state.copy(isCheckingFiles = true, errorMessage = null)
        return viewModelScope.launch {
            val stagedFiles = mutableListOf<AnkiImportFile>()
            try {
                val textProvider = aiTextProvider(context = applicationContext)
                withContext(Dispatchers.IO) {
                    for (uri in newUris) {
                        val attachment = makeAnkiPackageAttachmentFromUri(
                            context = applicationContext,
                            uri = uri,
                            textProvider = textProvider
                        )
                        stagedFiles.add(AnkiImportFile(uri = uri, attachment = attachment))
                    }
                }
                uiStateMutable.value = uiStateMutable.value.copy(
                    files = state.files + stagedFiles,
                    isCheckingFiles = false
                )
            } catch (error: CancellationException) {
                deleteAiChatAttachmentStagedFiles(attachments = stagedFiles.map(AnkiImportFile::attachment))
                throw error
            } catch (error: Exception) {
                deleteAiChatAttachmentStagedFiles(attachments = stagedFiles.map(AnkiImportFile::attachment))
                if (error !is AiAttachmentImportUserException && error !is SecurityException) {
                    AiChatDiagnosticsLogger.error(
                        event = "anki_import_staging_failed",
                        fields = emptyList(),
                        throwable = error
                    )
                }
                uiStateMutable.value = uiStateMutable.value.copy(
                    isCheckingFiles = false,
                    errorMessage = (error as? AiAttachmentImportUserException)?.message
                        ?: applicationContext.getString(R.string.ai_selected_file_read_failed)
                )
            }
        }
    }

    private fun showError(message: String) {
        uiStateMutable.value = uiStateMutable.value.copy(errorMessage = message)
    }

    internal fun removeFile(file: AnkiImportFile) {
        val state = uiStateMutable.value
        if (state.isBusy) {
            return
        }

        uiStateMutable.value = state.copy(files = state.files - file, errorMessage = null)
        deleteAiChatAttachmentStagedFiles(attachments = listOf(file.attachment))
    }

    internal fun takeImport(message: String): AiAnkiImport? {
        val state = uiStateMutable.value
        if (state.files.isEmpty() || state.isBusy) {
            return null
        }
        uiStateMutable.value = state.copy(files = emptyList(), isStarting = true)
        return AiAnkiImport(
            message = message,
            attachments = state.files.map(AnkiImportFile::attachment)
        )
    }

    override fun onCleared() {
        deleteAiChatAttachmentStagedFiles(attachments = uiStateMutable.value.files.map(AnkiImportFile::attachment))
    }
}

fun createAnkiImportViewModelFactory(
    applicationContext: Context,
    captureImportOrigin: suspend () -> AiAnkiImportOrigin?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AnkiImportViewModel(
                applicationContext = applicationContext,
                captureImportOrigin = captureImportOrigin
            )
        }
    }
}
