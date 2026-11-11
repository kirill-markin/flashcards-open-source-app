package com.flashcardsopensourceapp.feature.cards.library.importing

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.data.local.model.cards.CardImportText
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.editor.CardTagsSelectionRoute
import com.flashcardsopensourceapp.feature.cards.formatCardsTagSelectionSummary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpreadsheetImportRoute(
    viewModel: SpreadsheetImportViewModel,
    onOpenTags: () -> Unit,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current
    val resources = LocalResources.current
    val draft = state.draft
    val invalidCount = remember(draft.rows) { draft.rows.count { row -> !row.isValid } }
    val enabled = !state.isImporting
    BackHandler(enabled = state.isImporting) {}

    Scaffold(
        modifier = Modifier.imePadding(),
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.library_import_spreadsheet_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack, enabled = enabled) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.library_import_back_content_description)
                        )
                    }
                }
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                ) {
                    Column(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                        val error = if (state.hasWorkspaceChanged) {
                            R.string.spreadsheet_import_workspace_changed
                        } else {
                            state.importError
                        }
                        if (error != null) {
                            SpreadsheetImportError(message = stringResource(error))
                        }
                        state.importedCount?.let { count ->
                            Text(pluralStringResource(R.plurals.spreadsheet_import_success, count, count))
                        }
                    }
                    if (state.isImporting) {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                    Button(
                        onClick = {
                            focusManager.clearFocus()
                            viewModel.importCards()
                        },
                        enabled = state.canImport,
                        modifier = Modifier.fillMaxWidth().testTag("spreadsheet_import_confirm")
                    ) {
                        val count = draft.rows.size
                        Text(
                            if (state.isImporting) {
                                stringResource(R.string.spreadsheet_import_progress)
                            } else if (count == 0) {
                                stringResource(R.string.spreadsheet_import_action)
                            } else {
                                pluralStringResource(R.plurals.spreadsheet_import_action_count, count, count)
                            }
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().padding(innerPadding).consumeWindowInsets(innerPadding)
                .testTag("spreadsheet_import_screen")
        ) {
            item {
                Text(
                    text = stringResource(R.string.spreadsheet_import_description),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            item {
                OutlinedTextField(
                    value = draft.sourceText,
                    onValueChange = viewModel::updateSourceText,
                    enabled = enabled,
                    minLines = 4,
                    maxLines = 8,
                    label = { Text(stringResource(R.string.spreadsheet_import_input)) },
                    modifier = Modifier.fillMaxWidth().testTag("spreadsheet_import_input")
                )
            }
            item {
                SpreadsheetSeparatorField(
                    label = stringResource(R.string.spreadsheet_import_field_separator),
                    selected = draft.fieldSeparator,
                    choices = spreadsheetFieldSeparators,
                    customLabel = stringResource(R.string.spreadsheet_import_custom_field_separator),
                    customValue = draft.customFieldSeparator,
                    enabled = enabled,
                    onSelect = viewModel::updateFieldSeparator,
                    onCustomValueChange = viewModel::updateCustomFieldSeparator
                )
            }
            item {
                SpreadsheetSeparatorField(
                    label = stringResource(R.string.spreadsheet_import_row_separator),
                    selected = draft.rowSeparator,
                    choices = spreadsheetRowSeparators,
                    customLabel = stringResource(R.string.spreadsheet_import_custom_row_separator),
                    customValue = draft.customRowSeparator,
                    enabled = enabled,
                    onSelect = viewModel::updateRowSeparator,
                    onCustomValueChange = viewModel::updateCustomRowSeparator
                )
            }
            item {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.cards_tags_title)) },
                    supportingContent = {
                        Text(
                            if (state.selectedTags.isEmpty()) {
                                stringResource(R.string.spreadsheet_import_default_tag)
                            } else {
                                formatCardsTagSelectionSummary(resources = resources, tags = state.selectedTags)
                            }
                        )
                    },
                    modifier = Modifier.clickable(
                        enabled = enabled && state.workspaceId != null && !state.hasWorkspaceChanged,
                        onClick = onOpenTags
                    )
                )
            }
            item {
                Text(
                    text = stringResource(R.string.spreadsheet_import_preview),
                    style = MaterialTheme.typography.titleMedium
                )
            }
            when {
                draft.hasMissingDelimiter && draft.sourceText.isNotEmpty() -> item {
                    SpreadsheetImportError(message = stringResource(R.string.spreadsheet_import_separator_required))
                }
                draft.exceedsCardLimit -> item {
                    SpreadsheetImportError(
                        message = stringResource(R.string.spreadsheet_import_limit, spreadsheetImportMaximumCards)
                    )
                }
                draft.rows.isEmpty() -> item {
                    Text(stringResource(R.string.spreadsheet_import_preview_empty))
                }
                invalidCount > 0 -> item {
                    SpreadsheetImportError(message = stringResource(R.string.spreadsheet_import_invalid_help))
                    TextButton(onClick = viewModel::removeInvalidRows, enabled = enabled) {
                        Text(stringResource(R.string.spreadsheet_import_remove_invalid))
                    }
                }
            }
            itemsIndexed(items = draft.rows, key = { _, row -> row.id }) { index, row ->
                SpreadsheetPreviewRow(
                    number = index + 1,
                    row = row,
                    enabled = enabled,
                    onUpdate = { text -> viewModel.updateRow(id = row.id, text = text) },
                    onRemove = { viewModel.removeRow(id = row.id) }
                )
            }
        }
    }
}

@Composable
fun SpreadsheetImportTagsRoute(viewModel: SpreadsheetImportViewModel, onBack: () -> Unit) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    CardTagsSelectionRoute(
        selectedTags = state.selectedTags,
        availableTagSuggestions = state.availableTags,
        tagsErrorMessage = state.tagError?.let { stringResource(it) }.orEmpty(),
        onToggleSuggestedTag = viewModel::toggleTag,
        onAddTag = viewModel::addTag,
        onRemoveTag = viewModel::removeTag,
        onBack = onBack
    )
}

private val spreadsheetFieldSeparators = listOf(
    SpreadsheetSeparator.TAB, SpreadsheetSeparator.COMMA, SpreadsheetSeparator.CUSTOM
)
private val spreadsheetRowSeparators = listOf(
    SpreadsheetSeparator.NEWLINE, SpreadsheetSeparator.SEMICOLON, SpreadsheetSeparator.CUSTOM
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SpreadsheetSeparatorField(
    label: String,
    selected: SpreadsheetSeparator,
    choices: List<SpreadsheetSeparator>,
    customLabel: String,
    customValue: String,
    enabled: Boolean,
    onSelect: (SpreadsheetSeparator) -> Unit,
    onCustomValueChange: (String) -> Unit
) {
    var isExpanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ExposedDropdownMenuBox(
            expanded = isExpanded,
            onExpandedChange = { isExpanded = it }
        ) {
            OutlinedTextField(
                value = stringResource(selected.label),
                onValueChange = {},
                readOnly = true,
                enabled = enabled,
                label = { Text(label) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = isExpanded) },
                modifier = Modifier.fillMaxWidth()
                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = enabled)
            )
            ExposedDropdownMenu(expanded = isExpanded, onDismissRequest = { isExpanded = false }) {
                choices.forEach { separator ->
                    DropdownMenuItem(
                        text = { Text(stringResource(separator.label)) },
                        onClick = {
                            onSelect(separator)
                            isExpanded = false
                        }
                    )
                }
            }
        }
        if (selected == SpreadsheetSeparator.CUSTOM) {
            OutlinedTextField(
                value = customValue,
                onValueChange = onCustomValueChange,
                enabled = enabled,
                singleLine = true,
                label = { Text(customLabel) },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun SpreadsheetPreviewRow(
    number: Int,
    row: SpreadsheetImportRow,
    enabled: Boolean,
    onUpdate: (CardImportText) -> Unit,
    onRemove: () -> Unit
) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(12.dp)
        ) {
            Text(
                text = stringResource(R.string.spreadsheet_import_card_number, number),
                style = MaterialTheme.typography.titleSmall
            )
            OutlinedTextField(
                value = row.text.frontText,
                onValueChange = { text -> onUpdate(row.text.copy(frontText = text)) },
                label = { Text(stringResource(R.string.cards_front_title)) },
                enabled = enabled,
                isError = row.text.frontText.isBlank(),
                maxLines = 6,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = row.text.backText,
                onValueChange = { text -> onUpdate(row.text.copy(backText = text)) },
                label = { Text(stringResource(R.string.cards_back_title)) },
                enabled = enabled,
                isError = row.text.backText.isBlank(),
                maxLines = 6,
                modifier = Modifier.fillMaxWidth()
            )
            TextButton(onClick = onRemove, enabled = enabled) {
                Text(stringResource(R.string.cards_delete))
            }
        }
    }
}

@Composable
private fun SpreadsheetImportError(message: String) {
    Text(text = message, color = MaterialTheme.colorScheme.error)
}
