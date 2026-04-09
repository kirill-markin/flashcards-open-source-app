package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.SectionTitle

internal val settingsScreenCardSpacing = 16.dp
internal val settingsScreenHorizontalPadding = 16.dp
internal val settingsScreenBottomPadding = 24.dp

internal fun settingsScreenContentPadding(innerPadding: PaddingValues): PaddingValues {
    return PaddingValues(
        start = settingsScreenHorizontalPadding,
        top = innerPadding.calculateTopPadding() + settingsScreenCardSpacing,
        end = settingsScreenHorizontalPadding,
        bottom = innerPadding.calculateBottomPadding() + settingsScreenBottomPadding
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsScreenScaffold(
    title: String,
    onBack: (() -> Unit)?,
    isBackEnabled: Boolean,
    content: @Composable (PaddingValues) -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(title)
                },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(
                            onClick = onBack,
                            enabled = isBackEnabled
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                                contentDescription = stringResource(R.string.settings_back_content_description)
                            )
                        }
                    }
                }
            )
        }
    ) { innerPadding ->
        content(innerPadding)
    }
}

@Composable
fun SettingsRoute(
    uiState: SettingsUiState,
    onOpenCurrentWorkspace: () -> Unit,
    onOpenWorkspace: () -> Unit,
    onOpenAccount: () -> Unit,
    onOpenDevice: () -> Unit,
    onOpenAccess: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_root_title),
        onBack = null,
        isBackEnabled = false
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                SectionTitle(text = stringResource(R.string.settings_section_workspace))
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_root_current_workspace_title))
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
                            Text(stringResource(R.string.settings_root_workspace_title))
                        },
                        supportingContent = {
                            Text(
                                stringResource(
                                    R.string.settings_root_workspace_summary,
                                    uiState.workspaceName,
                                    pluralStringResource(
                                        R.plurals.settings_decks_count,
                                        uiState.deckCount,
                                        uiState.deckCount
                                    ),
                                    pluralStringResource(
                                        R.plurals.settings_cards_count,
                                        uiState.cardCount,
                                        uiState.cardCount
                                    )
                                )
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenWorkspace)
                    )
                }
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_section_account))
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_root_account_title))
                        },
                        supportingContent = {
                            Text(uiState.accountStatusTitle)
                        },
                        modifier = Modifier.clickable(onClick = onOpenAccount)
                    )
                }
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_section_device))
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_root_device_title))
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
                            Text(stringResource(R.string.settings_root_access_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_root_access_summary))
                        },
                        modifier = Modifier.clickable(onClick = onOpenAccess)
                    )
                }
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
