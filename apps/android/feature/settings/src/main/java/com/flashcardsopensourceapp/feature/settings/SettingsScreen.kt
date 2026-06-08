package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
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
import androidx.compose.ui.platform.testTag
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
    onOpenAccountStatus: () -> Unit,
    onOpenCurrentWorkspace: () -> Unit,
    onOpenReviewReminders: () -> Unit,
    onOpenReviewAnimations: () -> Unit,
    onOpenLanguage: () -> Unit,
    onOpenAccess: () -> Unit,
    onOpenDecks: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenExport: () -> Unit,
    onOpenFeedback: () -> Unit,
    onOpenLegal: () -> Unit,
    onOpenSupport: () -> Unit,
    onOpenOpenSource: () -> Unit,
    onOpenScheduling: () -> Unit,
    onOpenAgentConnections: () -> Unit,
    onOpenServer: () -> Unit,
    onOpenDeviceDiagnostics: () -> Unit,
    onOpenResetStudyProgress: () -> Unit,
    onOpenDeleteCurrentWorkspace: () -> Unit,
    onOpenDeleteAccount: () -> Unit,
    onOpenTest: () -> Unit
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
                SectionTitle(text = stringResource(R.string.settings_section_account))
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_account_status_title),
                    summary = uiState.accountStatusTitle,
                    testTag = settingsAccountStatusRowTag,
                    onClick = onOpenAccountStatus
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_root_current_workspace_title),
                    summary = uiState.currentWorkspaceName,
                    testTag = settingsCurrentWorkspaceRowTag,
                    onClick = onOpenCurrentWorkspace
                )
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_section_general))
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_review_reminders_title),
                    summary = stringResource(R.string.settings_review_reminders_summary),
                    testTag = settingsReviewRemindersRowTag,
                    onClick = onOpenReviewReminders
                )
            }

            if (uiState.canManageAccountPreferences) {
                item {
                    SettingsRootRow(
                        title = stringResource(R.string.settings_review_animations_title),
                        summary = if (uiState.reviewReactionAnimationsEnabled) {
                            stringResource(R.string.settings_common_on)
                        } else {
                            stringResource(R.string.settings_common_off)
                        },
                        testTag = settingsReviewAnimationsRowTag,
                        onClick = onOpenReviewAnimations
                    )
                }
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_language_title),
                    summary = stringResource(R.string.settings_language_summary),
                    testTag = settingsLanguageRowTag,
                    onClick = onOpenLanguage
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_root_access_title),
                    summary = stringResource(R.string.settings_root_access_summary),
                    testTag = settingsAccessRowTag,
                    onClick = onOpenAccess
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_workspace_decks_title),
                    summary = stringResource(R.string.settings_decks_summary),
                    testTag = settingsDecksRowTag,
                    onClick = onOpenDecks
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_workspace_tags_title),
                    summary = stringResource(R.string.settings_tags_summary),
                    testTag = settingsTagsRowTag,
                    onClick = onOpenTags
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_workspace_export_title),
                    summary = stringResource(R.string.settings_export_csv_summary),
                    testTag = settingsExportRowTag,
                    onClick = onOpenExport
                )
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_section_support))
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_root_feedback_title),
                    summary = stringResource(R.string.settings_root_feedback_summary),
                    testTag = settingsFeedbackRowTag,
                    onClick = onOpenFeedback
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_account_legal_title),
                    summary = null,
                    testTag = settingsLegalRowTag,
                    onClick = onOpenLegal
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_account_support_title),
                    summary = null,
                    testTag = settingsSupportRowTag,
                    onClick = onOpenSupport
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_account_open_source_title),
                    summary = stringResource(R.string.settings_account_open_source_summary),
                    testTag = settingsOpenSourceRowTag,
                    onClick = onOpenOpenSource
                )
            }

            item {
                SectionTitle(text = stringResource(R.string.settings_section_advanced))
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_scheduling_title),
                    summary = stringResource(R.string.settings_scheduling_summary),
                    testTag = settingsSchedulingRowTag,
                    onClick = onOpenScheduling
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_account_agent_connections_title),
                    summary = stringResource(R.string.settings_account_agent_connections_summary),
                    testTag = settingsAgentConnectionsRowTag,
                    onClick = onOpenAgentConnections
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_server_title),
                    summary = stringResource(R.string.settings_server_summary),
                    testTag = settingsServerRowTag,
                    onClick = onOpenServer
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_device_diagnostics_title),
                    summary = null,
                    testTag = settingsDeviceDiagnosticsRowTag,
                    onClick = onOpenDeviceDiagnostics
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_reset_study_progress_title),
                    summary = stringResource(R.string.settings_workspace_reset_body),
                    testTag = settingsResetStudyProgressRowTag,
                    onClick = onOpenResetStudyProgress
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_delete_current_workspace_title),
                    summary = stringResource(R.string.settings_workspace_delete_body),
                    testTag = settingsDeleteCurrentWorkspaceRowTag,
                    onClick = onOpenDeleteCurrentWorkspace
                )
            }

            item {
                SettingsRootRow(
                    title = stringResource(R.string.settings_account_danger_zone_dialog_title),
                    summary = stringResource(R.string.settings_account_danger_zone_body),
                    testTag = settingsDeleteAccountRowTag,
                    onClick = onOpenDeleteAccount
                )
            }

            if (uiState.isTestModeEnabled) {
                item {
                    SettingsRootRow(
                        title = stringResource(R.string.settings_root_test_title),
                        summary = stringResource(R.string.settings_root_test_summary),
                        testTag = settingsTestRowTag,
                        onClick = onOpenTest
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsRootRow(
    title: String,
    summary: String?,
    testTag: String,
    onClick: () -> Unit
) {
    val supportingContent: (@Composable () -> Unit)? = summary?.let { rowSummary ->
        {
            Text(rowSummary)
        }
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        ListItem(
            headlineContent = {
                Text(title)
            },
            supportingContent = supportingContent,
            modifier = Modifier
                .testTag(tag = testTag)
                .clickable(onClick = onClick)
        )
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
