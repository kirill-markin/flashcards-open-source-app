package com.flashcardsopensourceapp.feature.settings

import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.core.ui.components.SectionTitle
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptConfig
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptId
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptSettings

const val testSettingsPremiumPreviewTag: String = "test_premium_preview"
const val testSettingsAiLimitPreviewTag: String = "test_ai_limit_preview"

/** One preview row per Android after-review prompt; the notifications pre-prompt has one per "Continue" outcome. */
enum class TestReviewPromptPreview(val promptId: ReviewPromptId, val variant: String?) {
    HARD_REMINDER(promptId = ReviewPromptId.HARD_REMINDER, variant = null),
    PAYWALL_INITIAL(promptId = ReviewPromptId.PAYWALL_INITIAL, variant = null),
    PAYWALL_SECOND(promptId = ReviewPromptId.PAYWALL_SECOND, variant = null),
    PAYWALL_PERIODIC(promptId = ReviewPromptId.PAYWALL_PERIODIC, variant = null),
    NOTIFICATIONS_PRE_PROMPT_SYSTEM_DIALOG(promptId = ReviewPromptId.NOTIFICATIONS_PRE_PROMPT, variant = "system dialog"),
    NOTIFICATIONS_PRE_PROMPT_SETTINGS(promptId = ReviewPromptId.NOTIFICATIONS_PRE_PROMPT, variant = "settings"),
    RATING_REQUEST(promptId = ReviewPromptId.RATING_REQUEST, variant = null),
    GUEST_SIGN_IN(promptId = ReviewPromptId.GUEST_SIGN_IN, variant = null),
    AUTOMATIC_FEEDBACK(promptId = ReviewPromptId.AUTOMATIC_FEEDBACK, variant = null)
}

@Composable
fun TestSettingsRoute(
    onPreviewPremium: () -> Unit,
    onPreviewAiLimit: () -> Unit,
    onOpenAnimations: () -> Unit,
    onShowTechnicalErrorDialogPreview: () -> Unit,
    onOpenNotificationDiagnostics: () -> Unit,
    onOpenLocalSyncDiagnostics: () -> Unit,
    reviewPromptConfig: ReviewPromptConfig,
    onPreviewReviewPrompt: (TestReviewPromptPreview) -> Unit,
    onResetReviewPromptState: () -> Unit,
    onBack: () -> Unit
) {
    var isReviewPromptStateReset by rememberSaveable { mutableStateOf(false) }

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

            item {
                SectionTitle(text = stringResource(R.string.settings_test_review_prompts_section))
            }

            item {
                Text(
                    text = "schemaVersion=${reviewPromptConfig.schemaVersion} version=${reviewPromptConfig.version}",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag(tag = testSettingsReviewPromptsConfigTag)
                )
            }

            items(
                items = listTestReviewPromptPreviews(config = reviewPromptConfig),
                key = { preview -> preview.name }
            ) { preview ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(
                                text = preview.variant?.let { variant -> "${preview.promptId.wireValue} ($variant)" }
                                    ?: preview.promptId.wireValue
                            )
                        },
                        supportingContent = {
                            Text(formatReviewPromptSettings(settings = reviewPromptConfig.prompts[preview.promptId]))
                        },
                        modifier = Modifier
                            .testTag(tag = testSettingsReviewPromptRowTag(preview = preview))
                            .clickable(onClick = { onPreviewReviewPrompt(preview) })
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_test_review_prompts_reset))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.RestartAlt,
                                contentDescription = null
                            )
                        },
                        trailingContent = if (isReviewPromptStateReset) {
                            {
                                Icon(
                                    imageVector = Icons.Outlined.Check,
                                    contentDescription = null
                                )
                            }
                        } else {
                            null
                        },
                        modifier = Modifier
                            .testTag(tag = testSettingsReviewPromptsResetRowTag)
                            .clickable(
                                onClick = {
                                    onResetReviewPromptState()
                                    isReviewPromptStateReset = true
                                }
                            )
                    )
                }
            }
        }
    }
}

/** Config order first, then any Android prompt the config leaves out, so every prompt stays reachable. */
private fun listTestReviewPromptPreviews(config: ReviewPromptConfig): List<TestReviewPromptPreview> {
    return (config.order + ReviewPromptId.entries).distinct().flatMap { promptId ->
        TestReviewPromptPreview.entries.filter { preview ->
            preview.promptId == promptId && isTestReviewPromptPreviewAvailable(preview = preview)
        }
    }
}

/** Below API 33 Android has no notifications permission dialog, so "Continue" always opens settings there. */
private fun isTestReviewPromptPreviewAvailable(preview: TestReviewPromptPreview): Boolean {
    return preview != TestReviewPromptPreview.NOTIFICATIONS_PRE_PROMPT_SYSTEM_DIALOG ||
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
}

private fun formatReviewPromptSettings(settings: ReviewPromptSettings?): String {
    if (settings == null) {
        return "absent"
    }
    return listOfNotNull(
        "enabled=${settings.enabled}",
        settings.minTotalReviews?.let { count -> "minTotalReviews=$count" },
        settings.minReviewsToday?.let { count -> "minReviewsToday=$count" },
        settings.minReviewDays?.let { count -> "minReviewDays=$count" },
        settings.cooldownDays?.let { count -> "cooldownDays=$count" }
    ).joinToString(separator = ", ")
}
