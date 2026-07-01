package com.flashcardsopensourceapp.feature.settings.workspace.export

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SaveAlt
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import com.flashcardsopensourceapp.feature.settings.workspaceExportCsvButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceExportScreenTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataAuthorFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataCommentFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataCreatedAtFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataLabelFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataSourceUrlFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportPreviewButtonTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportSaveButtonTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportShareButtonTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportTagToggleTag
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun WorkspaceExportRoute(
    viewModel: WorkspaceExportViewModel,
    technicalErrorController: AppTechnicalErrorController,
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var pendingExportData by remember {
        mutableStateOf<WorkspaceExportData?>(value = null)
    }
    var pendingPackageExport by remember {
        mutableStateOf<WorkspacePackageExportDownloadResponse?>(value = null)
    }
    val createCsvDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("text/csv")
    ) { uri ->
        val exportData = pendingExportData
        if (uri == null || exportData == null) {
            viewModel.finishExport()
            pendingExportData = null
            return@rememberLauncherForActivityResult
        }

        coroutineScope.launch {
            try {
                writeWorkspaceExportCsv(
                    contentResolver = context.contentResolver,
                    uri = uri,
                    csv = makeWorkspaceCardsCsv(exportData = exportData)
                )
                viewModel.finishExport()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val errorMessage = context.getString(R.string.settings_export_write_failed)
                viewModel.showExportError(message = errorMessage)
                technicalErrorController.showTechnicalError(
                    error = makeAppTechnicalError(
                        title = context.getString(R.string.settings_technical_error_title),
                        message = errorMessage,
                        throwable = error
                    ),
                    throwable = error
                )
            }
            pendingExportData = null
        }
    }
    val createPackageDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/zip")
    ) { uri ->
        val packageExport = pendingPackageExport
        if (uri == null || packageExport == null) {
            viewModel.finishPackageExport()
            pendingPackageExport = null
            return@rememberLauncherForActivityResult
        }

        coroutineScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    writeWorkspacePackageExportZip(
                        contentResolver = context.contentResolver,
                        uri = uri,
                        packageBytes = packageExport.packageBytes
                    )
                }
                viewModel.finishPackageExport()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val errorMessage = context.getString(R.string.settings_export_package_write_failed)
                viewModel.showExportError(message = errorMessage)
                technicalErrorController.showTechnicalError(
                    error = makeAppTechnicalError(
                        title = context.getString(R.string.settings_technical_error_title),
                        message = errorMessage,
                        throwable = error
                    ),
                    throwable = error
                )
            }
            pendingPackageExport = null
        }
    }

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_export_title),
        onBack = onBack,
        isBackEnabled = uiState.isBusy.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = workspaceExportScreenTag)
        ) {
            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    MessageCard(
                        message = uiState.errorMessage,
                        color = MaterialTheme.colorScheme.error,
                        testTag = workspacePackageExportErrorMessageTag
                    )
                }
            }

            item {
                WorkspaceExportCsvCard(uiState = uiState)
            }

            item {
                Button(
                    onClick = {
                        coroutineScope.launch {
                            viewModel.clearErrorMessage()
                            val exportData = viewModel.prepareExportData()
                            if (exportData == null) {
                                return@launch
                            }

                            pendingExportData = exportData
                            createCsvDocumentLauncher.launch(
                                makeWorkspaceExportFilename(
                                    workspaceName = exportData.workspaceName,
                                    date = LocalDate.now()
                                )
                            )
                        }
                    },
                    enabled = uiState.isBusy.not(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = workspaceExportCsvButtonTag)
                ) {
                    Text(
                        if (uiState.isExporting) {
                            stringResource(R.string.settings_export_preparing)
                        } else {
                            stringResource(R.string.settings_export_csv_title)
                        }
                    )
                }
            }

            item {
                WorkspacePackageExportCard(
                    uiState = uiState,
                    onPreviewPackageExport = viewModel::previewPackageExport
                )
            }

            val packagePreview: WorkspacePackageExportPreview? = uiState.packagePreview
            if (packagePreview != null) {
                item {
                    WorkspacePackageExportContentsCard(preview = packagePreview)
                }
                item {
                    WorkspacePackageExportMetadataCard(
                        metadataDraft = uiState.packageMetadataDraft,
                        isBusy = uiState.isBusy,
                        onLabelChange = viewModel::updatePackageLabel,
                        onAuthorChange = viewModel::updatePackageAuthor,
                        onCreatedAtChange = viewModel::updatePackageCreatedAt,
                        onSourceUrlChange = viewModel::updatePackageSourceUrl,
                        onCommentChange = viewModel::updatePackageComment
                    )
                }
                item {
                    WorkspacePackageExportTagsCard(
                        preview = packagePreview,
                        removedTags = uiState.packageRemovedTags,
                        isBusy = uiState.isBusy,
                        onToggleRemovedTag = viewModel::togglePackageRemovedTag
                    )
                }
                item {
                    WorkspacePackageExportSaveButton(
                        uiState = uiState,
                        onSavePackageExport = {
                            coroutineScope.launch {
                                viewModel.clearErrorMessage()
                                val packageExport = viewModel.preparePackageExportDownload()
                                if (packageExport == null) {
                                    return@launch
                                }

                                pendingPackageExport = packageExport
                                createPackageDocumentLauncher.launch(packageExport.fileName)
                            }
                        }
                    )
                }
                item {
                    WorkspacePackageExportShareButton(
                        uiState = uiState,
                        onSharePackageExport = {
                            coroutineScope.launch {
                                viewModel.clearErrorMessage()
                                val packageExport = viewModel.preparePackageExportDownload()
                                if (packageExport == null) {
                                    return@launch
                                }

                                try {
                                    val shareUri: Uri = withContext(Dispatchers.IO) {
                                        prepareWorkspacePackageExportShareUri(
                                            context = context,
                                            packageExport = packageExport
                                        )
                                    }
                                    shareWorkspacePackageExportZip(
                                        context = context,
                                        shareUri = shareUri,
                                        contentType = packageExport.contentType,
                                        title = context.getString(R.string.settings_export_package_share_title)
                                    )
                                    viewModel.finishPackageExport()
                                } catch (error: CancellationException) {
                                    throw error
                                } catch (error: Exception) {
                                    val errorMessage = context.getString(R.string.settings_export_package_share_failed)
                                    viewModel.showExportError(message = errorMessage)
                                    technicalErrorController.showTechnicalError(
                                        error = makeAppTechnicalError(
                                            title = context.getString(R.string.settings_technical_error_title),
                                            message = errorMessage,
                                            throwable = error
                                        ),
                                        throwable = error
                                    )
                                }
                            }
                        }
                    )
                }
            }

            item {
                OutlinedButton(
                    onClick = {
                        viewModel.clearErrorMessage()
                    },
                    enabled = uiState.errorMessage.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.settings_export_dismiss_error))
                }
            }
        }
    }
}

private fun shareWorkspacePackageExportZip(
    context: Context,
    shareUri: Uri,
    contentType: String,
    title: String
) {
    val shareIntent = Intent(Intent.ACTION_SEND)
        .setType(contentType)
        .putExtra(Intent.EXTRA_STREAM, shareUri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    shareIntent.clipData = ClipData.newUri(context.contentResolver, title, shareUri)
    val chooserIntent = Intent.createChooser(shareIntent, title)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(chooserIntent)
}

@Composable
private fun MessageCard(
    message: String,
    color: Color,
    testTag: String
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = message,
            color = color,
            modifier = Modifier
                .padding(20.dp)
                .testTag(tag = testTag)
        )
    }
}

@Composable
private fun WorkspaceExportCsvCard(uiState: WorkspaceExportUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        ListItem(
            headlineContent = {
                Text(stringResource(R.string.settings_export_csv_summary))
            },
            supportingContent = {
                Text(
                    stringResource(
                        R.string.settings_export_csv_workspace_summary,
                        uiState.activeCardsCount,
                        uiState.workspaceName
                    )
                )
            },
            leadingContent = {
                Icon(
                    imageVector = Icons.Outlined.SaveAlt,
                    contentDescription = null
                )
            }
        )
    }
}

@Composable
private fun WorkspacePackageExportCard(
    uiState: WorkspaceExportUiState,
    onPreviewPackageExport: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_export_package_section),
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = stringResource(R.string.settings_export_package_body),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (uiState.packageAvailabilityMessage.isNotEmpty()) {
                Text(
                    text = uiState.packageAvailabilityMessage,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            OutlinedButton(
                onClick = onPreviewPackageExport,
                enabled = uiState.canPreviewPackageExport,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = workspacePackageExportPreviewButtonTag)
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (uiState.isPackagePreviewing) {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(18.dp)
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Outlined.SaveAlt,
                            contentDescription = null
                        )
                    }
                    Text(
                        if (uiState.isPackagePreviewing) {
                            stringResource(R.string.settings_export_package_previewing)
                        } else {
                            stringResource(R.string.settings_export_package_preview)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspacePackageExportContentsCard(preview: WorkspacePackageExportPreview) {
    val context = LocalContext.current
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_export_package_contents_section))
            MetadataListItem(
                label = stringResource(R.string.settings_export_package_cards),
                value = preview.selectedCardCount.toString()
            )
            MetadataListItem(
                label = stringResource(R.string.settings_export_package_referenced_media),
                value = preview.referencedMediaCount.toString()
            )
            MetadataListItem(
                label = stringResource(R.string.settings_export_package_estimated_media_size),
                value = Formatter.formatShortFileSize(context, preview.approximateReferencedMediaBytes)
            )
        }
    }
}

@Composable
private fun WorkspacePackageExportMetadataCard(
    metadataDraft: WorkspacePackageExportMetadataDraft,
    isBusy: Boolean,
    onLabelChange: (String) -> Unit,
    onAuthorChange: (String) -> Unit,
    onCreatedAtChange: (String) -> Unit,
    onSourceUrlChange: (String) -> Unit,
    onCommentChange: (String) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_export_package_metadata_section),
                style = MaterialTheme.typography.titleMedium
            )
            OutlinedTextField(
                value = metadataDraft.label,
                onValueChange = onLabelChange,
                enabled = isBusy.not(),
                singleLine = true,
                label = {
                    Text(stringResource(R.string.settings_export_package_metadata_label))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = workspacePackageExportMetadataLabelFieldTag)
            )
            OutlinedTextField(
                value = metadataDraft.author,
                onValueChange = onAuthorChange,
                enabled = isBusy.not(),
                singleLine = true,
                label = {
                    Text(stringResource(R.string.settings_export_package_metadata_author))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = workspacePackageExportMetadataAuthorFieldTag)
            )
            OutlinedTextField(
                value = metadataDraft.createdAt,
                onValueChange = onCreatedAtChange,
                enabled = isBusy.not(),
                singleLine = true,
                label = {
                    Text(stringResource(R.string.settings_export_package_metadata_created_at))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = workspacePackageExportMetadataCreatedAtFieldTag)
            )
            OutlinedTextField(
                value = metadataDraft.sourceUrl,
                onValueChange = onSourceUrlChange,
                enabled = isBusy.not(),
                singleLine = true,
                label = {
                    Text(stringResource(R.string.settings_export_package_metadata_source_url))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = workspacePackageExportMetadataSourceUrlFieldTag)
            )
            OutlinedTextField(
                value = metadataDraft.comment,
                onValueChange = onCommentChange,
                enabled = isBusy.not(),
                minLines = 2,
                label = {
                    Text(stringResource(R.string.settings_export_package_metadata_comment))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = workspacePackageExportMetadataCommentFieldTag)
            )
        }
    }
}

@Composable
private fun WorkspacePackageExportTagsCard(
    preview: WorkspacePackageExportPreview,
    removedTags: Set<String>,
    isBusy: Boolean,
    onToggleRemovedTag: (String) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_export_package_tags_section))
            val tagOptions: List<WorkspacePackageExportTagOptionUiState> = makeWorkspacePackageExportTagOptions(
                preview = preview,
                removedTags = removedTags
            )
            if (tagOptions.isEmpty()) {
                Text(
                    text = stringResource(R.string.settings_export_package_tags_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                )
            } else {
                tagOptions.forEach { tagOption ->
                    ToggleListItem(
                        title = if (tagOption.isAlwaysRemoved) {
                            stringResource(R.string.settings_export_package_always_remove_tag, tagOption.tag)
                        } else {
                            stringResource(R.string.settings_export_package_remove_tag, tagOption.tag)
                        },
                        supportingText = if (tagOption.isAlwaysRemoved) {
                            stringResource(R.string.settings_export_package_generated_import_tag_removed)
                        } else {
                            pluralStringResource(
                                R.plurals.settings_tag_cards_count,
                                tagOption.cardsCount,
                                tagOption.cardsCount
                            )
                        },
                        checked = tagOption.isRemoved,
                        enabled = isBusy.not() && tagOption.isAlwaysRemoved.not(),
                        testTag = workspacePackageExportTagToggleTag(tag = tagOption.tag),
                        onCheckedChange = {
                            onToggleRemovedTag(tagOption.tag)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspacePackageExportSaveButton(
    uiState: WorkspaceExportUiState,
    onSavePackageExport: () -> Unit
) {
    Button(
        onClick = onSavePackageExport,
        enabled = uiState.canExportPackage,
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag = workspacePackageExportSaveButtonTag)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (uiState.isPackageExporting) {
                CircularProgressIndicator(
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(18.dp)
                )
            }
            Text(
                if (uiState.isPackageExporting) {
                    stringResource(R.string.settings_export_package_exporting)
                } else {
                    stringResource(R.string.settings_export_package_save)
                }
            )
        }
    }
}

@Composable
private fun WorkspacePackageExportShareButton(
    uiState: WorkspaceExportUiState,
    onSharePackageExport: () -> Unit
) {
    OutlinedButton(
        onClick = onSharePackageExport,
        enabled = uiState.canExportPackage,
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag = workspacePackageExportShareButtonTag)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (uiState.isPackageExporting) {
                CircularProgressIndicator(
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(18.dp)
                )
            }
            Text(
                if (uiState.isPackageExporting) {
                    stringResource(R.string.settings_export_package_exporting)
                } else {
                    stringResource(R.string.settings_export_package_share)
                }
            )
        }
    }
}

@Composable
private fun ToggleListItem(
    title: String,
    supportingText: String,
    checked: Boolean,
    enabled: Boolean,
    testTag: String,
    onCheckedChange: (Boolean) -> Unit
) {
    ListItem(
        headlineContent = {
            Text(title)
        },
        supportingContent = {
            Text(supportingText)
        },
        trailingContent = {
            Switch(
                checked = checked,
                enabled = enabled,
                onCheckedChange = onCheckedChange,
                modifier = Modifier.testTag(tag = testTag)
            )
        },
        modifier = Modifier.clickable(enabled = enabled) {
            onCheckedChange(checked.not())
        }
    )
}

@Composable
private fun MetadataListItem(
    label: String,
    value: String
) {
    ListItem(
        headlineContent = {
            Text(label)
        },
        supportingContent = {
            Text(value)
        }
    )
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
    )
}
