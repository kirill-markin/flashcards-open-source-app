package com.flashcardsopensourceapp.feature.settings

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
import com.flashcardsopensourceapp.core.ui.components.SectionTitle

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
        title = "Account Settings",
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
                            Text("Account status")
                        },
                        supportingContent = {
                            Text("Workspace: $workspaceName")
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
                SectionTitle(text = "Support")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Legal & support")
                        },
                        supportingContent = {
                            Text("Privacy, terms, support, and contact")
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
                            Text("Open source")
                        },
                        supportingContent = {
                            Text("GitHub repository and self-hosting direction")
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
                SectionTitle(text = "Advanced")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Advanced")
                        },
                        supportingContent = {
                            Text("Server configuration")
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
                SectionTitle(text = "Connections")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Agent connections")
                        },
                        supportingContent = {
                            Text("Review and revoke long-lived bot connections")
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
                SectionTitle(text = "Danger zone")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Danger zone")
                        },
                        supportingContent = {
                            Text("Delete account")
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
