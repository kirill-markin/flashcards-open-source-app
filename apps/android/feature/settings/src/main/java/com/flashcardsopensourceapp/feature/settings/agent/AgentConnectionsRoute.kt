package com.flashcardsopensourceapp.feature.settings.agent

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

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
        title = stringResource(R.string.settings_agent_connections_title),
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
                                text = stringResource(R.string.settings_agent_connections_intro),
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            OutlinedButton(
                                onClick = onReload,
                                enabled = uiState.isLoading.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    if (uiState.isLoading) {
                                        stringResource(R.string.settings_loading)
                                    } else {
                                        stringResource(R.string.settings_agent_connections_reload)
                                    }
                                )
                            }
                        } else {
                            Text(
                                text = stringResource(R.string.settings_agent_connections_sign_in_guidance),
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
                            text = stringResource(R.string.settings_agent_connections_empty),
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
                        Text(
                            stringResource(
                                R.string.settings_labeled_value,
                                stringResource(R.string.settings_agent_connections_created_label),
                                connection.createdAtLabel
                            )
                        )
                        Text(
                            stringResource(
                                R.string.settings_labeled_value,
                                stringResource(R.string.settings_agent_connections_last_used_label),
                                connection.lastUsedAtLabel
                            )
                        )
                        Text(
                            stringResource(
                                R.string.settings_labeled_value,
                                stringResource(R.string.settings_agent_connections_revoked_label),
                                connection.revokedAtLabel
                            )
                        )
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
                                    stringResource(R.string.settings_revoking)
                                } else {
                                    stringResource(R.string.settings_agent_connections_revoke)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
