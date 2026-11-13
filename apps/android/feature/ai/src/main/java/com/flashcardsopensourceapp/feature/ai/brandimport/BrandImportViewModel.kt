package com.flashcardsopensourceapp.feature.ai.brandimport

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiImportSource
import com.flashcardsopensourceapp.data.local.model.ai.AiImportSourceInput
import com.flashcardsopensourceapp.data.local.model.ai.aiChatMaximumUploadedAttachmentsPerMessage
import com.flashcardsopensourceapp.feature.ai.AiImport
import com.flashcardsopensourceapp.feature.ai.AiImportOrigin
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.input.AiAttachmentImportUserException
import com.flashcardsopensourceapp.feature.ai.input.deleteAiChatAttachmentStagedFiles
import com.flashcardsopensourceapp.feature.ai.input.makeAiImportFileAttachmentFromUri
import com.flashcardsopensourceapp.feature.ai.input.makeAiImportPastedTextAttachment
import com.flashcardsopensourceapp.feature.ai.strings.aiTextProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class BrandImportFile(val uri: Uri, val attachment: AiChatAttachment.Binary)

internal data class BrandImportUiState(
    val origin: AiImportOrigin?,
    val files: List<BrandImportFile>,
    val pastedText: String,
    val isPreparing: Boolean,
    val isPickerOpen: Boolean,
    val isCheckingFiles: Boolean,
    val isStarting: Boolean,
    val errorMessage: String?
) {
    val isBusy: Boolean
        get() = isPreparing || isPickerOpen || isCheckingFiles || isStarting
}

class BrandImportViewModel(
    private val applicationContext: Context,
    val source: AiImportSource,
    captureImportOrigin: suspend () -> AiImportOrigin?
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow(
        BrandImportUiState(
            origin = null,
            files = emptyList(),
            pastedText = "",
            isPreparing = true,
            isPickerOpen = false,
            isCheckingFiles = false,
            isStarting = false,
            errorMessage = null
        )
    )
    internal val uiState: StateFlow<BrandImportUiState> = uiStateMutable.asStateFlow()

    init {
        viewModelScope.launch {
            val origin = captureImportOrigin()
            uiStateMutable.value = uiStateMutable.value.copy(
                origin = origin,
                isPreparing = false,
                errorMessage = uiStateMutable.value.errorMessage ?: if (origin == null) {
                    applicationContext.getString(R.string.ai_import_workspace_unavailable)
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
            errorMessage = applicationContext.getString(R.string.ai_import_picker_unavailable)
        )
    }

    internal fun onFilePickerResult(uris: List<Uri>) {
        val state = uiStateMutable.value
        if (state.isPickerOpen.not()) {
            if (uris.isNotEmpty()) {
                showError(message = applicationContext.getString(R.string.ai_import_choose_files_again))
            }
            return
        }

        uiStateMutable.value = state.copy(isPickerOpen = false)
        stageFiles(uris = uris)
    }

    internal fun onFilesDropped(uris: List<Uri>): Job? {
        return stageFiles(uris = uris)
    }

    internal fun updatePastedText(text: String) {
        val state = uiStateMutable.value
        if (state.isBusy) {
            return
        }
        uiStateMutable.value = state.copy(pastedText = text, errorMessage = null)
    }

    private fun stageFiles(uris: List<Uri>): Job? {
        val files = source.input as? AiImportSourceInput.Files ?: return null
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
                    R.string.ai_import_too_many_files,
                    aiChatMaximumUploadedAttachmentsPerMessage
                )
            )
            return null
        }

        uiStateMutable.value = state.copy(isCheckingFiles = true, errorMessage = null)
        return viewModelScope.launch {
            val stagedFiles = mutableListOf<BrandImportFile>()
            try {
                val textProvider = aiTextProvider(context = applicationContext)
                withContext(Dispatchers.IO) {
                    for (uri in newUris) {
                        val attachment = makeAiImportFileAttachmentFromUri(
                            context = applicationContext,
                            uri = uri,
                            source = source,
                            files = files,
                            textProvider = textProvider
                        )
                        stagedFiles.add(BrandImportFile(uri = uri, attachment = attachment))
                    }
                }
                uiStateMutable.value = uiStateMutable.value.copy(
                    files = state.files + stagedFiles,
                    isCheckingFiles = false
                )
            } catch (error: CancellationException) {
                deleteAiChatAttachmentStagedFiles(attachments = stagedFiles.map(BrandImportFile::attachment))
                throw error
            } catch (error: Exception) {
                deleteAiChatAttachmentStagedFiles(attachments = stagedFiles.map(BrandImportFile::attachment))
                if (error !is AiAttachmentImportUserException && error !is SecurityException) {
                    AiChatDiagnosticsLogger.error(
                        event = "anki_import_staging_failed",
                        fields = listOf("sourceId" to source.id),
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

    internal fun removeFile(file: BrandImportFile) {
        val state = uiStateMutable.value
        if (state.isBusy) {
            return
        }

        uiStateMutable.value = state.copy(files = state.files - file, errorMessage = null)
        deleteAiChatAttachmentStagedFiles(attachments = listOf(file.attachment))
    }

    internal fun takeFilesImport(message: String): AiImport? {
        val state = uiStateMutable.value
        if (state.files.isEmpty() || state.isBusy) {
            return null
        }
        uiStateMutable.value = state.copy(files = emptyList(), isStarting = true)
        return AiImport(
            message = message,
            attachments = state.files.map(BrandImportFile::attachment)
        )
    }

    /** Null when nothing can start yet, or when the text cannot be attached; the reason is then shown. */
    internal suspend fun takePastedTextImport(message: String): AiImport? {
        val pastedText = source.input as? AiImportSourceInput.PastedText ?: return null
        val state = uiStateMutable.value
        if (state.pastedText.isBlank() || state.isBusy) {
            return null
        }
        uiStateMutable.value = state.copy(isStarting = true, errorMessage = null)
        return try {
            val attachment = withContext(Dispatchers.IO) {
                makeAiImportPastedTextAttachment(
                    context = applicationContext,
                    text = state.pastedText,
                    pastedText = pastedText
                )
            }
            AiImport(message = message, attachments = listOf(attachment))
        } catch (error: CancellationException) {
            uiStateMutable.value = uiStateMutable.value.copy(isStarting = false)
            throw error
        } catch (error: AiAttachmentImportUserException) {
            uiStateMutable.value = uiStateMutable.value.copy(isStarting = false, errorMessage = error.message)
            null
        } catch (error: Exception) {
            AiChatDiagnosticsLogger.error(
                event = "anki_import_staging_failed",
                fields = listOf("sourceId" to source.id),
                throwable = error
            )
            uiStateMutable.value = uiStateMutable.value.copy(
                isStarting = false,
                errorMessage = applicationContext.getString(R.string.ai_selected_file_read_failed)
            )
            null
        }
    }

    override fun onCleared() {
        deleteAiChatAttachmentStagedFiles(attachments = uiStateMutable.value.files.map(BrandImportFile::attachment))
    }
}

fun createBrandImportViewModelFactory(
    applicationContext: Context,
    source: AiImportSource,
    captureImportOrigin: suspend () -> AiImportOrigin?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            BrandImportViewModel(
                applicationContext = applicationContext,
                source = source,
                captureImportOrigin = captureImportOrigin
            )
        }
    }
}
