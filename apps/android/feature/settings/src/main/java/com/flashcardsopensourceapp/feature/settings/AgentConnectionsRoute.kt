package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun AgentConnectionsRoute(
    uiState: AgentConnectionsUiState,
    onReload: () -> Unit,
    onRevokeConnection: (String) -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(uiState.isLinked) {
        if (uiState.isLinked) {
            onReload()
        }
    }

    SettingsScreenScaffold(
        title = "Agent Connections",
        onBack = onBack,
        isBackEnabled = uiState.revokingConnectionId == null
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
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
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        if (uiState.isLinked) {
                            Text(
                                text = "Review and revoke long-lived bot connections tied to this cloud account.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            OutlinedButton(
                                onClick = onReload,
                                enabled = uiState.isLoading.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (uiState.isLoading) "Loading..." else "Reload")
                            }
                        } else {
                            Text(
                                text = "Sign in to the cloud account to manage long-lived bot connections.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            if (uiState.instructions.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.instructions,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            if (uiState.isLinked && uiState.isLoading.not() && uiState.connections.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "No long-lived bot connections were created for this account.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            items(uiState.connections, key = { item -> item.connectionId }) { connection ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(connection.label, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = connection.connectionId,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text("Created: ${connection.createdAtLabel}")
                        Text("Last used: ${connection.lastUsedAtLabel}")
                        Text("Revoked: ${connection.revokedAtLabel}")
                        OutlinedButton(
                            onClick = {
                                onRevokeConnection(connection.connectionId)
                            },
                            enabled = connection.isRevoked.not() &&
                                uiState.revokingConnectionId != connection.connectionId,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                if (uiState.revokingConnectionId == connection.connectionId) {
                                    "Revoking..."
                                } else {
                                    "Revoke"
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
