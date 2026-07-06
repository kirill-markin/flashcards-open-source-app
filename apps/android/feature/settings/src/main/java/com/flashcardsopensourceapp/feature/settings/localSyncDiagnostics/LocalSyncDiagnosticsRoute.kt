package com.flashcardsopensourceapp.feature.settings.localSyncDiagnostics

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.SectionTitle
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.localSyncDiagnosticsCopyButtonTag
import com.flashcardsopensourceapp.feature.settings.localSyncDiagnosticsRefreshButtonTag
import com.flashcardsopensourceapp.feature.settings.localSyncDiagnosticsScreenTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun LocalSyncDiagnosticsRoute(
    uiState: LocalSyncDiagnosticsUiState,
    onRefresh: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val clipboardManager = remember(context) {
        checkNotNull(context.getSystemService(ClipboardManager::class.java)) {
            "ClipboardManager is not available."
        }
    }
    val clipboardLabel = stringResource(R.string.settings_local_sync_diagnostics_clipboard_label)

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_local_sync_diagnostics_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = localSyncDiagnosticsScreenTag)
        ) {
            when (uiState) {
                LocalSyncDiagnosticsUiState.Loading -> {
                    item {
                        LocalSyncDiagnosticsLoadingCard()
                    }
                }

                LocalSyncDiagnosticsUiState.NoWorkspace -> {
                    item {
                        LocalSyncDiagnosticsMessageCard(
                            title = stringResource(R.string.settings_local_sync_diagnostics_no_workspace_title),
                            body = stringResource(R.string.settings_local_sync_diagnostics_no_workspace_body)
                        )
                    }
                }

                is LocalSyncDiagnosticsUiState.Ready -> {
                    item {
                        LocalSyncDiagnosticsActionsCard(
                            reportText = uiState.reportText,
                            clipboardLabel = clipboardLabel,
                            clipboardManager = clipboardManager,
                            onRefresh = onRefresh
                        )
                    }
                    item {
                        SectionTitle(text = stringResource(R.string.settings_local_sync_diagnostics_cards_sync_section))
                    }
                    item {
                        LocalSyncDiagnosticsInfoCard(
                            title = stringResource(R.string.settings_local_sync_diagnostics_cards_sync_section),
                            rows = uiState.cardsSyncRows
                        )
                    }
                    item {
                        SectionTitle(text = stringResource(R.string.settings_local_sync_diagnostics_managed_media_sync_section))
                    }
                    item {
                        LocalSyncDiagnosticsInfoCard(
                            title = stringResource(R.string.settings_local_sync_diagnostics_managed_media_sync_section),
                            rows = uiState.managedMediaSyncRows
                        )
                    }
                    item {
                        SectionTitle(text = stringResource(R.string.settings_local_sync_diagnostics_problem_records_section))
                    }
                    if (uiState.problemSections.isEmpty()) {
                        item {
                            LocalSyncDiagnosticsMessageCard(
                                title = stringResource(R.string.settings_local_sync_diagnostics_problem_records_section),
                                body = stringResource(R.string.settings_local_sync_diagnostics_no_problem_records)
                            )
                        }
                    } else {
                        uiState.problemSections.forEach { section ->
                            item {
                                SectionTitle(text = section.title)
                            }
                            section.records.forEach { record ->
                                item {
                                    LocalSyncDiagnosticsInfoCard(
                                        title = record.title,
                                        rows = record.rows
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LocalSyncDiagnosticsActionsCard(
    reportText: String,
    clipboardLabel: String,
    clipboardManager: ClipboardManager,
    onRefresh: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            FilledTonalButton(
                onClick = onRefresh,
                modifier = Modifier
                    .weight(1f)
                    .testTag(tag = localSyncDiagnosticsRefreshButtonTag)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Refresh,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = stringResource(R.string.settings_local_sync_diagnostics_refresh_button))
            }
            OutlinedButton(
                onClick = {
                    clipboardManager.setPrimaryClip(
                        ClipData.newPlainText(
                            clipboardLabel,
                            reportText
                        )
                    )
                },
                modifier = Modifier
                    .weight(1f)
                    .testTag(tag = localSyncDiagnosticsCopyButtonTag)
            ) {
                Icon(
                    imageVector = Icons.Outlined.ContentCopy,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = stringResource(R.string.settings_local_sync_diagnostics_copy_button))
            }
        }
    }
}

@Composable
private fun LocalSyncDiagnosticsLoadingCard() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_loading),
                style = MaterialTheme.typography.titleMedium
            )
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun LocalSyncDiagnosticsMessageCard(
    title: String,
    body: String
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun LocalSyncDiagnosticsInfoCard(
    title: String,
    rows: List<LocalSyncDiagnosticsRowUiState>
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium
            )
            rows.forEach { row ->
                LocalSyncDiagnosticsInfoRow(row = row)
            }
        }
    }
}

@Composable
private fun LocalSyncDiagnosticsInfoRow(row: LocalSyncDiagnosticsRowUiState) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = row.label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        SelectionContainer {
            Text(
                text = row.value,
                style = MaterialTheme.typography.bodyLarge
            )
        }
    }
}
