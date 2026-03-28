package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

@Composable
fun WorkspaceSettingsRoute(
    uiState: WorkspaceSettingsUiState,
    onOpenOverview: () -> Unit,
    onOpenDecks: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenScheduler: () -> Unit,
    onOpenExport: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Workspace Settings",
        onBack = onBack,
        isBackEnabled = true
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
                            Text("Overview")
                        },
                        supportingContent = {
                            Text("${uiState.workspaceName} | ${uiState.totalCards} cards")
                        },
                        modifier = Modifier.clickable(onClick = onOpenOverview)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Decks")
                        },
                        supportingContent = {
                            Text("${uiState.deckCount} filtered decks")
                        },
                        modifier = Modifier.clickable(onClick = onOpenDecks)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Tags")
                        },
                        supportingContent = {
                            Text("${uiState.tagCount} tags")
                        },
                        modifier = Modifier.clickable(onClick = onOpenTags)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Notifications")
                        },
                        supportingContent = {
                            Text(uiState.notificationsSummary)
                        },
                        modifier = Modifier.clickable(onClick = onOpenNotifications)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Scheduler")
                        },
                        supportingContent = {
                            Text(
                                text = uiState.schedulerSummary,
                                modifier = Modifier.testTag(workspaceSchedulerSummaryTag)
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenScheduler)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Export")
                        },
                        supportingContent = {
                            Text(uiState.exportSummary)
                        },
                        modifier = Modifier.clickable(onClick = onOpenExport)
                    )
                }
            }
        }
    }
}
