package com.flashcardsopensourceapp.feature.ai.anki

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.data.local.model.ai.aiChatMaximumFileAttachmentBytes
import com.flashcardsopensourceapp.data.local.model.ai.aiChatMaximumUploadedAttachmentsPerMessage
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.input.aiChatDocumentPickerMimeTypes

const val ankiImportScreenTag: String = "anki_import_screen"
const val ankiImportChooseFilesButtonTag: String = "anki_import_choose_files"
const val ankiImportStartButtonTag: String = "anki_import_start"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnkiImportRoute(
    viewModel: AnkiImportViewModel,
    onStartImport: (AiAnkiImport, AiAnkiImportOrigin) -> Unit,
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val prompt = stringResource(id = R.string.ai_anki_import_prompt)
    val openDocuments = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
        onResult = viewModel::onFilePickerResult
    )
    val progressMessage = when {
        uiState.isPreparing -> R.string.ai_anki_import_preparing
        uiState.isCheckingFiles -> R.string.ai_anki_import_checking_files
        else -> null
    }
    val origin = uiState.origin

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(id = R.string.ai_anki_import_title)) },
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
                .testTag(ankiImportScreenTag)
        ) {
            item {
                Text(
                    text = stringResource(
                        R.string.ai_anki_import_description,
                        aiChatMaximumUploadedAttachmentsPerMessage,
                        aiChatMaximumFileAttachmentBytes / (1024L * 1024)
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            item {
                OutlinedButton(
                    onClick = {
                        if (viewModel.beginFilePicker()) {
                            try {
                                openDocuments.launch(aiChatDocumentPickerMimeTypes())
                            } catch (_: ActivityNotFoundException) {
                                viewModel.onFilePickerUnavailable()
                            }
                        }
                    },
                    enabled = origin != null && uiState.isBusy.not() &&
                        uiState.files.size < aiChatMaximumUploadedAttachmentsPerMessage,
                    modifier = Modifier.testTag(ankiImportChooseFilesButtonTag)
                ) {
                    Text(stringResource(id = R.string.ai_anki_import_choose_files))
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
            items(items = uiState.files, key = { file -> file.uri.toString() }) { file ->
                val fileName = file.attachment.fileName
                ListItem(
                    headlineContent = { Text(fileName) },
                    trailingContent = {
                        IconButton(onClick = { viewModel.removeFile(file = file) }, enabled = uiState.isBusy.not()) {
                            Icon(
                                imageVector = Icons.Outlined.Close,
                                contentDescription = stringResource(R.string.ai_anki_import_remove_file, fileName)
                            )
                        }
                    }
                )
            }
            item {
                Button(
                    onClick = {
                        if (origin != null) {
                            val request = viewModel.takeImport(message = prompt)
                            if (request != null) {
                                onStartImport(request, origin)
                            }
                        }
                    },
                    enabled = origin != null && uiState.isBusy.not() && uiState.files.isNotEmpty(),
                    modifier = Modifier.testTag(ankiImportStartButtonTag)
                ) {
                    Text(stringResource(id = R.string.ai_anki_import_start))
                }
            }
        }
    }
}
