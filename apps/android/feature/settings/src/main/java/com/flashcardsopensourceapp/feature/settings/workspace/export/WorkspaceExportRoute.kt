package com.flashcardsopensourceapp.feature.settings.workspace.export

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportFormat
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.isWorkspacePackageExportGeneratedImportTag
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import com.flashcardsopensourceapp.feature.settings.workspaceExportScreenTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportCardSelectionTagToggleTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportIncludedTagToggleTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataAuthorFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataCommentFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataCreatedAtFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataLabelFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportMetadataSourceUrlFieldTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportPreviewButtonTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportSaveButtonTag
import com.flashcardsopensourceapp.feature.settings.workspacePackageExportShareButtonTag
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
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
    val resources = LocalResources.current
    val coroutineScope = rememberCoroutineScope()
    val isAnkiExport = viewModel.format == WorkspacePackageExportFormat.ANKI
    val shareTitle = stringResource(
        if (isAnkiExport) R.string.settings_export_anki_share else R.string.settings_export_package_share_title
    )
    val createPackageDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument(viewModel.format.contentType)
    ) { uri ->
        if (uri == null) {
            viewModel.finishPackageExport()
            return@rememberLauncherForActivityResult
        }

        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            val packageExport = viewModel.consumePendingPackageExport()
            if (packageExport == null) {
                viewModel.showExportError(message = resources.getString(R.string.settings_export_package_write_failed))
                return@launch
            }
            try {
                packageExport.use { save ->
                    withContext(Dispatchers.IO) {
                        writeWorkspacePackageExport(
                            contentResolver = context.contentResolver,
                            uri = uri,
                            archiveInput = save.archiveInput
                        )
                    }
                }
                viewModel.finishPackageExport()
            } catch (error: CancellationException) {
                viewModel.finishPackageExport()
                throw error
            } catch (error: Exception) {
                showWorkspaceExportFileError(
                    viewModel = viewModel,
                    technicalErrorController = technicalErrorController,
                    title = resources.getString(R.string.settings_technical_error_title),
                    message = resources.getString(R.string.settings_export_package_write_failed),
                    error = error
                )
            }
        }
    }

    SettingsScreenScaffold(
        title = stringResource(
            if (isAnkiExport) R.string.settings_export_anki_title else R.string.settings_export_title
        ),
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
                WorkspacePackageExportCard(
                    uiState = uiState,
                    sectionTitle = if (isAnkiExport) {
                        R.string.settings_export_anki_section
                    } else {
                        R.string.settings_export_package_section
                    },
                    bodyText = if (isAnkiExport) {
                        R.string.settings_export_anki_body
                    } else {
                        R.string.settings_export_package_body
                    },
                    onPreviewPackageExport = viewModel::previewPackageExport
                )
            }

            val packagePreview: WorkspacePackageExportPreview? = uiState.packagePreview
            if (packagePreview != null) {
                item {
                    WorkspacePackageExportContentsCard(preview = packagePreview)
                }
                item {
                    if (isAnkiExport) {
                        Card(modifier = Modifier.fillMaxWidth()) {
                            WorkspacePackageExportLabelField(
                                label = uiState.packageMetadataDraft.label,
                                fieldTitle = R.string.settings_export_anki_deck_name,
                                isBusy = uiState.isBusy,
                                onLabelChange = viewModel::updatePackageLabel,
                                modifier = Modifier.padding(20.dp)
                            )
                        }
                    } else {
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
                }
                item {
                    WorkspacePackageExportCardSelectionCard(
                        tagOptions = makeWorkspacePackageExportCardSelectionTagOptions(
                            tagCounts = uiState.packageCardSelectionTagCounts,
                            selectedTags = uiState.packageCardSelectionTags
                        ),
                        isBusy = uiState.isBusy,
                        onToggleSelectionTag = viewModel::togglePackageCardSelectionTag
                    )
                }
                item {
                    WorkspacePackageExportIncludedTagsCard(
                        preview = packagePreview,
                        includedTags = uiState.packageIncludedTags,
                        isBusy = uiState.isBusy,
                        onToggleIncludedTag = viewModel::togglePackageIncludedTag
                    )
                }
                if (uiState.isAnkiSelectionEmpty) {
                    item {
                        Text(
                            text = stringResource(R.string.settings_export_anki_empty),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                item {
                    WorkspacePackageExportSaveButton(
                        uiState = uiState,
                        buttonText = stringResource(
                            if (isAnkiExport) R.string.settings_export_anki_save else R.string.settings_export_package_save
                        ),
                        onSavePackageExport = {
                            coroutineScope.launch {
                                viewModel.clearErrorMessage()
                                try {
                                    val fileName = viewModel.preparePackageExportSave(cacheDirectory = context.cacheDir)
                                        ?: return@launch
                                    createPackageDocumentLauncher.launch(fileName)
                                } catch (error: CancellationException) {
                                    viewModel.finishPackageExport()
                                    throw error
                                } catch (error: Exception) {
                                    showWorkspaceExportFileError(
                                        viewModel = viewModel,
                                        technicalErrorController = technicalErrorController,
                                        title = resources.getString(R.string.settings_technical_error_title),
                                        message = resources.getString(R.string.settings_export_package_write_failed),
                                        error = error
                                    )
                                }
                            }
                        }
                    )
                }
                item {
                    WorkspacePackageExportShareButton(
                        uiState = uiState,
                        buttonText = stringResource(
                            if (isAnkiExport) R.string.settings_export_anki_share else R.string.settings_export_package_share
                        ),
                        onSharePackageExport = {
                            coroutineScope.launch {
                                viewModel.clearErrorMessage()
                                val packageExport = viewModel.preparePackageExportDownload(
                                    destinationDirectory = context.cacheDir
                                )
                                if (packageExport == null) {
                                    return@launch
                                }

                                var share: WorkspacePackageExportShare? = null
                                var didLaunchShare = false
                                try {
                                    withContext(Dispatchers.IO) {
                                        share = prepareWorkspacePackageExportShare(
                                            context = context,
                                            packageExport = packageExport
                                        )
                                    }
                                    shareWorkspacePackageExport(
                                        context = context,
                                        shareUri = checkNotNull(share).uri,
                                        contentType = packageExport.contentType,
                                        title = shareTitle
                                    )
                                    didLaunchShare = true
                                    viewModel.finishPackageExport()
                                } catch (error: CancellationException) {
                                    viewModel.finishPackageExport()
                                    throw error
                                } catch (error: Exception) {
                                    showWorkspaceExportFileError(
                                        viewModel = viewModel,
                                        technicalErrorController = technicalErrorController,
                                        title = resources.getString(R.string.settings_technical_error_title),
                                        message = resources.getString(R.string.settings_export_package_share_failed),
                                        error = error
                                    )
                                } finally {
                                    if (didLaunchShare.not()) {
                                        share?.let { deleteWorkspacePackageExportEntry(entry = it.directory) }
                                    }
                                    deleteWorkspacePackageExportEntry(entry = packageExport.archiveFile)
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

private fun showWorkspaceExportFileError(
    viewModel: WorkspaceExportViewModel,
    technicalErrorController: AppTechnicalErrorController,
    title: String,
    message: String,
    error: Exception
) {
    viewModel.showExportError(message = message)
    technicalErrorController.showTechnicalError(
        error = makeAppTechnicalError(title = title, message = message, throwable = error),
        throwable = error
    )
}

private fun shareWorkspacePackageExport(
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
private fun WorkspacePackageExportCard(
    uiState: WorkspaceExportUiState,
    @StringRes sectionTitle: Int,
    @StringRes bodyText: Int,
    onPreviewPackageExport: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(sectionTitle),
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = stringResource(bodyText),
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
            WorkspacePackageExportLabelField(
                label = metadataDraft.label,
                fieldTitle = R.string.settings_export_package_metadata_label,
                isBusy = isBusy,
                onLabelChange = onLabelChange,
                modifier = Modifier
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
private fun WorkspacePackageExportLabelField(
    label: String,
    @StringRes fieldTitle: Int,
    isBusy: Boolean,
    onLabelChange: (String) -> Unit,
    modifier: Modifier
) {
    OutlinedTextField(
        value = label,
        onValueChange = onLabelChange,
        enabled = isBusy.not(),
        singleLine = true,
        label = {
            Text(stringResource(fieldTitle))
        },
        modifier = modifier
            .fillMaxWidth()
            .testTag(tag = workspacePackageExportMetadataLabelFieldTag)
    )
}

@Composable
private fun WorkspacePackageExportCardSelectionCard(
    tagOptions: List<WorkspacePackageExportTagOptionUiState>,
    isBusy: Boolean,
    onToggleSelectionTag: (String) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_export_package_card_selection_section))
            if (tagOptions.isEmpty()) {
                Text(
                    text = stringResource(R.string.settings_export_package_card_selection_all_active),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                )
            } else {
                if (tagOptions.none { tagOption -> tagOption.isSelected }) {
                    Text(
                        text = stringResource(R.string.settings_export_package_card_selection_all_active),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                    )
                }
                tagOptions.forEach { tagOption ->
                    ToggleListItem(
                        title = stringResource(R.string.settings_export_package_select_cards_with_tag, tagOption.tag),
                        supportingText = pluralStringResource(
                            R.plurals.settings_tag_cards_count,
                            tagOption.cardsCount,
                            tagOption.cardsCount
                        ),
                        checked = tagOption.isSelected,
                        enabled = isBusy.not(),
                        testTag = workspacePackageExportCardSelectionTagToggleTag(tag = tagOption.tag),
                        onCheckedChange = {
                            onToggleSelectionTag(tagOption.tag)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspacePackageExportIncludedTagsCard(
    preview: WorkspacePackageExportPreview,
    includedTags: Set<String>,
    isBusy: Boolean,
    onToggleIncludedTag: (String) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_export_package_tags_section))
            val tagOptions: List<WorkspacePackageExportTagOptionUiState> = makeWorkspacePackageExportIncludedTagOptions(
                preview = preview,
                includedTags = includedTags
            )
            val hasGeneratedImportTags: Boolean = preview.availableTagCounts.any { tagCount ->
                isWorkspacePackageExportGeneratedImportTag(tag = tagCount.tag)
            }
            if (tagOptions.isEmpty()) {
                Text(
                    text = stringResource(R.string.settings_export_package_tags_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                )
                if (hasGeneratedImportTags) {
                    Text(
                        text = stringResource(R.string.settings_export_package_generated_import_tag_not_included),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                    )
                }
            } else {
                tagOptions.forEach { tagOption ->
                    ToggleListItem(
                        title = stringResource(R.string.settings_export_package_include_tag, tagOption.tag),
                        supportingText = pluralStringResource(
                            R.plurals.settings_tag_cards_count,
                            tagOption.cardsCount,
                            tagOption.cardsCount
                        ),
                        checked = tagOption.isSelected,
                        enabled = isBusy.not(),
                        testTag = workspacePackageExportIncludedTagToggleTag(tag = tagOption.tag),
                        onCheckedChange = {
                            onToggleIncludedTag(tagOption.tag)
                        }
                    )
                }
                if (hasGeneratedImportTags) {
                    Text(
                        text = stringResource(R.string.settings_export_package_generated_import_tag_not_included),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspacePackageExportSaveButton(
    uiState: WorkspaceExportUiState,
    buttonText: String,
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
                    buttonText
                }
            )
        }
    }
}

@Composable
private fun WorkspacePackageExportShareButton(
    uiState: WorkspaceExportUiState,
    buttonText: String,
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
                    buttonText
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
