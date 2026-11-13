package com.flashcardsopensourceapp.feature.ai.brandimport

import android.app.Activity
import android.content.ActivityNotFoundException
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.core.ui.ImportFileField
import com.flashcardsopensourceapp.data.local.model.ai.AiImportSource
import com.flashcardsopensourceapp.data.local.model.ai.AiImportSourceInput
import com.flashcardsopensourceapp.data.local.model.ai.aiChatMaximumUploadedAttachmentsPerMessage
import com.flashcardsopensourceapp.feature.ai.AiImport
import com.flashcardsopensourceapp.feature.ai.AiImportOrigin
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.input.aiChatDocumentPickerMimeTypes
import kotlinx.coroutines.launch

const val brandImportScreenTag: String = "brand_import_screen"
const val brandImportChooseFilesButtonTag: String = "brand_import_choose_files"
const val brandImportPastedTextFieldTag: String = "brand_import_pasted_text"
const val brandImportStartButtonTag: String = "brand_import_start"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrandImportRoute(
    viewModel: BrandImportViewModel,
    onStartImport: (AiImport, AiImportOrigin) -> Unit,
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val activity = LocalActivity.current
    val openDocuments = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
        onResult = viewModel::onFilePickerResult
    )
    val source = viewModel.source
    val brandName = source.brandName
    val prompt = if (brandName == null) {
        stringResource(id = R.string.ai_import_other_prompt)
    } else {
        stringResource(id = R.string.ai_import_brand_prompt, brandName)
    }
    val progressMessage = when {
        uiState.isPreparing -> R.string.ai_import_preparing
        uiState.isCheckingFiles -> R.string.ai_import_checking_files
        else -> null
    }
    val origin = uiState.origin
    val input = source.input

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (brandName == null) {
                            stringResource(id = R.string.ai_import_other_title)
                        } else {
                            stringResource(id = R.string.ai_import_brand_title, brandName)
                        }
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.ai_history_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
                .testTag(brandImportScreenTag)
        ) {
            item {
                Text(
                    text = brandImportDescription(source = source),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            when (input) {
                is AiImportSourceInput.Files -> brandImportFilesInput(
                    activity = activity,
                    viewModel = viewModel,
                    uiState = uiState,
                    files = input,
                    onChooseFiles = {
                        if (viewModel.beginFilePicker()) {
                            try {
                                openDocuments.launch(aiChatDocumentPickerMimeTypes())
                            } catch (_: ActivityNotFoundException) {
                                viewModel.onFilePickerUnavailable()
                            }
                        }
                    }
                )
                is AiImportSourceInput.PastedText -> item {
                    OutlinedTextField(
                        value = uiState.pastedText,
                        onValueChange = viewModel::updatePastedText,
                        enabled = origin != null && uiState.isBusy.not(),
                        minLines = 4,
                        maxLines = 8,
                        label = { Text(stringResource(R.string.ai_import_quizlet_text_label)) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(brandImportPastedTextFieldTag)
                    )
                }
            }
            if (progressMessage != null) {
                item {
                    LinearProgressIndicator()
                    Text(stringResource(id = progressMessage))
                }
            }
            uiState.errorMessage?.let { message ->
                item {
                    Text(text = message, color = MaterialTheme.colorScheme.error)
                }
            }
            item {
                BrandImportStartButton(
                    viewModel = viewModel,
                    uiState = uiState,
                    input = input,
                    prompt = prompt,
                    onStartImport = onStartImport
                )
            }
        }
    }
}

@Composable
private fun brandImportDescription(source: AiImportSource): String {
    val brandName = source.brandName
    return when (val input = source.input) {
        is AiImportSourceInput.PastedText -> stringResource(R.string.ai_import_quizlet_description)
        is AiImportSourceInput.Files -> if (brandName == null) {
            stringResource(R.string.ai_import_other_description)
        } else {
            stringResource(R.string.ai_import_brand_description, input.formats, brandName)
        }
    }
}

private fun LazyListScope.brandImportFilesInput(
    activity: Activity?,
    viewModel: BrandImportViewModel,
    uiState: BrandImportUiState,
    files: AiImportSourceInput.Files,
    onChooseFiles: () -> Unit
) {
    item {
        ImportFileField(
            activity = activity,
            label = files.formats,
            supportingContent = {
                if (uiState.files.isEmpty()) {
                    Text(stringResource(R.string.ai_import_choose_files))
                } else {
                    BrandImportFileNames(
                        files = uiState.files,
                        enabled = !uiState.isBusy,
                        onRemoveFile = viewModel::removeFile
                    )
                }
            },
            onClick = onChooseFiles,
            enabled = uiState.origin != null && uiState.isBusy.not() &&
                uiState.files.size < aiChatMaximumUploadedAttachmentsPerMessage,
            onDrop = viewModel::onFilesDropped,
            modifier = Modifier.testTag(brandImportChooseFilesButtonTag),
            trailingContent = {
                Icon(imageVector = Icons.Outlined.FolderOpen, contentDescription = null)
            }
        )
    }
}

@Composable
private fun BrandImportStartButton(
    viewModel: BrandImportViewModel,
    uiState: BrandImportUiState,
    input: AiImportSourceInput,
    prompt: String,
    onStartImport: (AiImport, AiImportOrigin) -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    val origin = uiState.origin
    val hasInput = when (input) {
        is AiImportSourceInput.Files -> uiState.files.isNotEmpty()
        is AiImportSourceInput.PastedText -> uiState.pastedText.isNotBlank()
    }
    Button(
        onClick = {
            if (origin == null) {
                return@Button
            }
            when (input) {
                is AiImportSourceInput.Files -> {
                    val request = viewModel.takeFilesImport(message = prompt)
                    if (request != null) {
                        onStartImport(request, origin)
                    }
                }
                is AiImportSourceInput.PastedText -> coroutineScope.launch {
                    val request = viewModel.takePastedTextImport(message = prompt)
                    if (request != null) {
                        onStartImport(request, origin)
                    }
                }
            }
        },
        enabled = origin != null && uiState.isBusy.not() && hasInput,
        modifier = Modifier.testTag(brandImportStartButtonTag)
    ) {
        Text(stringResource(id = R.string.ai_import_start))
    }
}

@Composable
private fun BrandImportFileNames(
    files: List<BrandImportFile>,
    enabled: Boolean,
    onRemoveFile: (BrandImportFile) -> Unit
) {
    Column {
        files.forEach { file ->
            val fileName = file.attachment.fileName
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text = fileName, modifier = Modifier.weight(1f))
                IconButton(onClick = { onRemoveFile(file) }, enabled = enabled) {
                    Icon(
                        imageVector = Icons.Outlined.Close,
                        contentDescription = stringResource(R.string.ai_import_remove_file, fileName)
                    )
                }
            }
        }
    }
}
