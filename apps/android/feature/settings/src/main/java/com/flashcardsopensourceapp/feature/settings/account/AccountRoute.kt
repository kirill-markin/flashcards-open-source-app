package com.flashcardsopensourceapp.feature.settings.account

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Handshake
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.core.ui.components.SectionTitle
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun AccountRoute(
    workspaceName: String,
    onOpenStatus: () -> Unit,
    onOpenLegalSupport: () -> Unit,
    onOpenOpenSource: () -> Unit,
    onOpenAdvanced: () -> Unit,
    onOpenAgentConnections: () -> Unit,
    onOpenDangerZone: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_account_title),
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
                            Text(stringResource(R.string.settings_account_status_title))
                        },
                        supportingContent = {
                            Text(
                                stringResource(
                                    R.string.settings_account_workspace_summary,
                                    workspaceName
                                )
                            )
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.PersonOutline,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenStatus)
                    )
                }
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_account_support_section))
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_account_legal_support_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_account_legal_support_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Handshake,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenLegalSupport)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_account_open_source_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_account_open_source_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Code,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenOpenSource)
                    )
                }
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_account_advanced_section))
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_account_advanced_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_account_advanced_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.SettingsEthernet,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenAdvanced)
                    )
                }
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_account_connections_section))
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_account_agent_connections_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_account_agent_connections_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Link,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenAgentConnections)
                    )
                }
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_account_danger_zone_section))
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_account_danger_zone_section))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_account_danger_zone_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.WarningAmber,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenDangerZone)
                    )
                }
            }
        }
    }
}
