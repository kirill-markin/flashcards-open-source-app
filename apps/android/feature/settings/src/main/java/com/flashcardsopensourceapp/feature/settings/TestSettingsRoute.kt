package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.core.ui.components.SectionTitle

const val testSettingsPremiumPreviewTag: String = "test_premium_preview"
const val testSettingsAiLimitPreviewTag: String = "test_ai_limit_preview"

@Composable
fun TestSettingsRoute(
    onPreviewPremium: () -> Unit,
    onPreviewAiLimit: () -> Unit,
    onOpenAnimations: () -> Unit,
    onShowTechnicalErrorDialogPreview: () -> Unit,
    onOpenNotificationDiagnostics: () -> Unit,
    onOpenLocalSyncDiagnostics: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_test_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = testSettingsScreenTag)
        ) {
            item {
                SectionTitle(text = stringResource(R.string.settings_test_tools_section))
            }

            item {
                Button(
                    onClick = onPreviewPremium,
                    modifier = Modifier.fillMaxWidth().testTag(tag = testSettingsPremiumPreviewTag)
                ) {
                    Text(stringResource(R.string.settings_premium_preview))
                }
            }

            item {
                Button(
                    onClick = onPreviewAiLimit,
                    modifier = Modifier.fillMaxWidth().testTag(tag = testSettingsAiLimitPreviewTag)
                ) {
                    Text(stringResource(R.string.settings_ai_limit_preview))
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_test_animations_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_test_animations_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.AutoAwesome,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier
                            .testTag(tag = testSettingsAnimationsRowTag)
                            .clickable(onClick = onOpenAnimations)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_test_technical_error_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_test_technical_error_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.BugReport,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier
                            .testTag(tag = testSettingsTechnicalErrorRowTag)
                            .clickable(onClick = onShowTechnicalErrorDialogPreview)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_test_notification_diagnostics_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_test_notification_diagnostics_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Notifications,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier
                            .testTag(tag = testSettingsNotificationDiagnosticsRowTag)
                            .clickable(onClick = onOpenNotificationDiagnostics)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_test_local_sync_diagnostics_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_test_local_sync_diagnostics_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Sync,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier
                            .testTag(tag = testSettingsLocalSyncDiagnosticsRowTag)
                            .clickable(onClick = onOpenLocalSyncDiagnostics)
                    )
                }
            }
        }
    }
}
