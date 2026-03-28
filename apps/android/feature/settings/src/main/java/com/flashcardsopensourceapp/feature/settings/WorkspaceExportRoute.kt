package com.flashcardsopensourceapp.feature.settings

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.ListItem
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import java.time.LocalDate
import kotlinx.coroutines.launch

@Composable
fun WorkspaceExportRoute(
    viewModel: WorkspaceExportViewModel,
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
            } catch (error: IllegalArgumentException) {
                viewModel.showExportError(message = error.message ?: "Android export failed.")
            } catch (error: IllegalStateException) {
                viewModel.showExportError(message = error.message ?: "Android export failed.")
            }
            pendingExportData = null
        }
    }

    SettingsScreenScaffold(
        title = "Export",
        onBack = onBack,
        isBackEnabled = uiState.isExporting.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("CSV export")
                        },
                        supportingContent = {
                            Text("${uiState.activeCardsCount} active cards from ${uiState.workspaceName}")
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
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (uiState.isExporting) "Preparing export..." else "Export CSV")
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
                    Text("Dismiss error")
                }
            }
        }
    }
}
