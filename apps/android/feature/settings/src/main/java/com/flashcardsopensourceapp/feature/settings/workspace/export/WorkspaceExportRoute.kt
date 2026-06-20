package com.flashcardsopensourceapp.feature.settings.workspace.export

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SaveAlt
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceExportData
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

const val workspaceExportScreenTag: String = "workspace_export_screen"
const val workspaceExportCsvButtonTag: String = "workspace_export_csv_button"

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
    val createDocumentLauncher = rememberLauncherForActivityResult(
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

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_export_title),
        onBack = onBack,
        isBackEnabled = uiState.isExporting.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = workspaceExportScreenTag)
        ) {
            item {
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

            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
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
                            createDocumentLauncher.launch(
                                makeWorkspaceExportFilename(
                                    workspaceName = exportData.workspaceName,
                                    date = LocalDate.now()
                                )
                            )
                        }
                    },
                    enabled = uiState.isExporting.not(),
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
