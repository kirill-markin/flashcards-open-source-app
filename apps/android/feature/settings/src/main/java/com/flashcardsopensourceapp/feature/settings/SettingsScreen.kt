package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.NoticeCard

@Composable
fun SettingsRoute(
    uiState: SettingsUiState,
    onOpenCurrentWorkspace: () -> Unit,
    onOpenWorkspace: () -> Unit,
    onOpenAccount: () -> Unit,
    onOpenDevice: () -> Unit,
    onOpenAccess: () -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            NoticeCard(
                title = "Android settings",
                body = "Workspace management, account surfaces, device diagnostics, Android-native access, and CSV export now sit on top of the local-first Android app.",
                modifier = Modifier
            )
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Current Workspace")
                    },
                    supportingContent = {
                        Text(uiState.currentWorkspaceName)
                    },
                    modifier = Modifier.clickable(onClick = onOpenCurrentWorkspace)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Workspace")
                    },
                    supportingContent = {
                        Text("${uiState.workspaceName} | ${uiState.deckCount} decks | ${uiState.cardCount} cards")
                    },
                    modifier = Modifier.clickable(onClick = onOpenWorkspace)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Account")
                    },
                    supportingContent = {
                        Text(uiState.accountStatusTitle)
                    },
                    modifier = Modifier.clickable(onClick = onOpenAccount)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("This device")
                    },
                    supportingContent = {
                        Text(uiState.storageLabel)
                    },
                    modifier = Modifier.clickable(onClick = onOpenDevice)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Access")
                    },
                    supportingContent = {
                        Text("Camera, microphone, photos, and files")
                    },
                    modifier = Modifier.clickable(onClick = onOpenAccess)
                )
            }
        }
    }
}

@Composable
fun SettingsPlaceholderRoute(title: String, body: String) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp)
                )
                Text(
                    text = body,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(16.dp)
                )
            }
        }
    }
}
