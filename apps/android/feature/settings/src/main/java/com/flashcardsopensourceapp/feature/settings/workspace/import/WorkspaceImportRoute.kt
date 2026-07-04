package com.flashcardsopensourceapp.feature.settings.workspace.importing

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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportMetadata
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportSourceKind
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportWarning
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import com.flashcardsopensourceapp.feature.settings.workspaceImportAddImportTagToggleTag
import com.flashcardsopensourceapp.feature.settings.workspaceImportChooseFileButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceImportConfirmButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceImportErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspaceImportScreenTag
import com.flashcardsopensourceapp.feature.settings.workspaceImportTagFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceImportTagToggleTag
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun WorkspaceImportRoute(
    viewModel: WorkspaceImportViewModel,
    onBack: () -> Unit
) {
    val uiState: WorkspaceImportUiState = viewModel.uiState.collectAsStateWithLifecycle().value
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val strings = remember(context) {
        createSettingsStringResolver(context = context.applicationContext)
    }
    val openDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }
        val previewRequestId: Long = viewModel.beginPreviewRequest()
        coroutineScope.launch {
            try {
                val selectedFile: WorkspaceImportSelectedFile = withContext(Dispatchers.IO) {
                    readWorkspaceImportSelectedFile(
                        context = context,
                        uri = uri,
                        strings = strings
                    )
                }
                viewModel.previewSelectedFile(
                    previewRequestId = previewRequestId,
                    selectedFile = selectedFile
                )
            } catch (error: WorkspaceImportUserException) {
                viewModel.showSelectedFileError(
                    previewRequestId = previewRequestId,
                    message = error.message ?: context.getString(R.string.settings_import_file_read_failed)
                )
            }
        }
    }

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_import_title),
        onBack = onBack,
        isBackEnabled = uiState.isBusy.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = workspaceImportScreenTag)
        ) {
            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    MessageCard(
                        message = uiState.errorMessage,
                        color = MaterialTheme.colorScheme.error,
                        testTag = workspaceImportErrorMessageTag
                    )
                }
            }

            if (uiState.successMessage.isNotEmpty()) {
                item {
                    MessageCard(
                        message = uiState.successMessage,
                        color = MaterialTheme.colorScheme.primary,
                        testTag = null
                    )
                }
            }

            item {
                WorkspaceImportPackageCard(
                    uiState = uiState,
                    onChoosePackage = {
                        openDocumentLauncher.launch(workspaceImportDocumentPickerMimeTypes())
                    }
                )
            }

            val preview: WorkspacePackageImportPreview? = uiState.preview
            if (preview != null) {
                item {
                    WorkspaceImportSourceCard(
                        selectedFileName = uiState.selectedFileName,
                        preview = preview
                    )
                }
                item {
                    WorkspaceImportMetadataCard(metadata = preview.packageMetadata)
                }
                item {
                    WorkspaceImportCountsCard(preview = preview)
                }
                item {
                    WorkspaceImportOptionsCard(
                        preview = preview,
                        addImportTag = uiState.addImportTag,
                        importTag = uiState.importTag,
                        removedTags = uiState.removedTags,
                        isBusy = uiState.isBusy,
                        onAddImportTagChange = viewModel::updateAddImportTag,
                        onImportTagChange = viewModel::updateImportTag,
                        onToggleTag = viewModel::toggleTag
                    )
                }
                item {
                    WorkspaceImportWarningsCard(warnings = preview.warnings)
                }
                item {
                    WorkspaceImportConfirmButton(
                        uiState = uiState,
                        onConfirmImport = viewModel::confirmImport
                    )
                }
            }

            item {
                OutlinedButton(
                    onClick = viewModel::clearErrorMessage,
                    enabled = uiState.errorMessage.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.settings_import_dismiss_error))
                }
            }
        }
    }
}

@Composable
private fun MessageCard(
    message: String,
    color: Color,
    testTag: String?
) {
    val modifier: Modifier = if (testTag == null) {
        Modifier.padding(20.dp)
    } else {
        Modifier
            .padding(20.dp)
            .testTag(tag = testTag)
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = message,
            color = color,
            modifier = modifier
        )
    }
}

@Composable
private fun WorkspaceImportPackageCard(
    uiState: WorkspaceImportUiState,
    onChoosePackage: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_import_package_section),
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = stringResource(R.string.settings_import_package_body),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (uiState.selectedFileName != null) {
                Text(
                    text = stringResource(R.string.settings_import_selected_file, uiState.selectedFileName),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (uiState.availabilityMessage.isNotEmpty()) {
                Text(
                    text = uiState.availabilityMessage,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            OutlinedButton(
                onClick = onChoosePackage,
                enabled = uiState.canChoosePackage,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = workspaceImportChooseFileButtonTag)
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (uiState.isPreviewing) {
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
                        if (uiState.isPreviewing) {
                            stringResource(R.string.settings_import_previewing)
                        } else {
                            stringResource(R.string.settings_import_choose_package)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspaceImportSourceCard(
    selectedFileName: String?,
    preview: WorkspacePackageImportPreview
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_import_source_section))
            MetadataListItem(
                label = stringResource(R.string.settings_import_source_kind),
                value = workspaceImportSourceKindTitle(sourceKind = preview.sourceKind)
            )
            if (selectedFileName != null) {
                MetadataListItem(
                    label = stringResource(R.string.settings_import_source_title),
                    value = selectedFileName
                )
            }
        }
    }
}

@Composable
private fun WorkspaceImportMetadataCard(metadata: WorkspacePackageImportMetadata) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_import_metadata_section))
            val metadataRows: List<Pair<String, String>> = workspaceImportMetadataRows(metadata = metadata)
            if (metadataRows.isEmpty()) {
                Text(
                    text = stringResource(R.string.settings_import_metadata_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                )
            } else {
                metadataRows.forEach { row ->
                    MetadataListItem(
                        label = row.first,
                        value = row.second
                    )
                }
            }
        }
    }
}

@Composable
private fun workspaceImportMetadataRows(metadata: WorkspacePackageImportMetadata): List<Pair<String, String>> {
    return listOfNotNull(
        metadata.label?.trim()?.ifEmpty { null }?.let { value ->
            stringResource(R.string.settings_import_metadata_label) to value
        },
        metadata.author?.trim()?.ifEmpty { null }?.let { value ->
            stringResource(R.string.settings_import_metadata_author) to value
        },
        metadata.createdAt?.trim()?.ifEmpty { null }?.let { value ->
            stringResource(R.string.settings_import_metadata_created) to value
        },
        metadata.sourceUrl?.trim()?.ifEmpty { null }?.let { value ->
            stringResource(R.string.settings_import_metadata_source_url) to value
        },
        metadata.comment?.trim()?.ifEmpty { null }?.let { value ->
            stringResource(R.string.settings_import_metadata_comment) to value
        }
    )
}

@Composable
private fun WorkspaceImportCountsCard(preview: WorkspacePackageImportPreview) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_import_contents_section))
            MetadataListItem(
                label = stringResource(R.string.settings_import_cards),
                value = preview.cardCount.toString()
            )
            MetadataListItem(
                label = stringResource(R.string.settings_import_referenced_media),
                value = preview.referencedMediaCount.toString()
            )
            MetadataListItem(
                label = stringResource(R.string.settings_import_package_media),
                value = preview.packageMediaFileCount.toString()
            )
        }
    }
}

@Composable
private fun WorkspaceImportOptionsCard(
    preview: WorkspacePackageImportPreview,
    addImportTag: Boolean,
    importTag: String,
    removedTags: Set<String>,
    isBusy: Boolean,
    onAddImportTagChange: (Boolean) -> Unit,
    onImportTagChange: (String) -> Unit,
    onToggleTag: (String) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            SectionHeader(title = stringResource(R.string.settings_import_options_section))
            ToggleListItem(
                title = stringResource(R.string.settings_import_add_import_tag),
                supportingText = stringResource(R.string.settings_import_add_import_tag_body),
                checked = addImportTag,
                enabled = isBusy.not(),
                testTag = workspaceImportAddImportTagToggleTag,
                onCheckedChange = onAddImportTagChange
            )
            if (addImportTag) {
                OutlinedTextField(
                    value = importTag,
                    onValueChange = onImportTagChange,
                    enabled = isBusy.not(),
                    singleLine = true,
                    label = {
                        Text(stringResource(R.string.settings_import_import_tag))
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .testTag(tag = workspaceImportTagFieldTag)
                )
            }
            makeWorkspaceImportTagOptions(
                preview = preview,
                removedTags = removedTags
            ).forEach { tagOption ->
                ToggleListItem(
                    title = stringResource(R.string.settings_import_keep_tag, tagOption.tag),
                    supportingText = pluralStringResource(
                        R.plurals.settings_tag_cards_count,
                        tagOption.cardsCount,
                        tagOption.cardsCount
                    ),
                    checked = tagOption.isKept,
                    enabled = isBusy.not(),
                    testTag = workspaceImportTagToggleTag(tag = tagOption.tag),
                    onCheckedChange = {
                        onToggleTag(tagOption.tag)
                    }
                )
            }
        }
    }
}

@Composable
private fun WorkspaceImportWarningsCard(warnings: List<WorkspacePackageImportWarning>) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_import_warnings_section),
                style = MaterialTheme.typography.titleMedium
            )
            if (warnings.isEmpty()) {
                Text(
                    text = stringResource(R.string.settings_import_warnings_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                warnings.forEach { warning ->
                    Text(
                        text = workspaceImportWarningMessage(warning = warning),
                        color = MaterialTheme.colorScheme.tertiary
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspaceImportConfirmButton(
    uiState: WorkspaceImportUiState,
    onConfirmImport: () -> Unit
) {
    Button(
        onClick = onConfirmImport,
        enabled = uiState.canConfirmImport,
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag = workspaceImportConfirmButtonTag)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (uiState.isImporting) {
                CircularProgressIndicator(
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(18.dp)
                )
            }
            Text(
                if (uiState.isImporting) {
                    stringResource(R.string.settings_import_importing)
                } else {
                    stringResource(R.string.settings_import_confirm_button)
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

@Composable
private fun workspaceImportSourceKindTitle(sourceKind: WorkspacePackageImportSourceKind): String {
    return when (sourceKind) {
        WorkspacePackageImportSourceKind.ZIP -> stringResource(R.string.settings_import_source_zip)
    }
}

@Composable
private fun workspaceImportWarningMessage(warning: WorkspacePackageImportWarning): String {
    if (warning.mediaPath.isEmpty()) {
        return warning.message
    }
    return stringResource(R.string.settings_import_warning_with_path, warning.mediaPath, warning.message)
}
