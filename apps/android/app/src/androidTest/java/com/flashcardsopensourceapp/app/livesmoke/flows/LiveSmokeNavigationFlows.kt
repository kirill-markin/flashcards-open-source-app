@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke.flows

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickNode
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.tapBackIcon
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTagToExist
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilWithMitigation
import com.flashcardsopensourceapp.app.livesmoke.support.LiveSmokeContext
import com.flashcardsopensourceapp.app.livesmoke.support.internalUiTimeoutMillis
import com.flashcardsopensourceapp.app.navigation.ReviewDestination
import com.flashcardsopensourceapp.feature.settings.access.accessSettingsScreenTag
import com.flashcardsopensourceapp.feature.settings.account.accountStatusScreenTag
import com.flashcardsopensourceapp.feature.settings.device.deviceDiagnosticsScreenTag
import com.flashcardsopensourceapp.feature.settings.language.languageSettingsScreenTag
import com.flashcardsopensourceapp.feature.settings.language.languageSettingsSupportedLanguagesSectionTag
import com.flashcardsopensourceapp.feature.settings.leaderboard.leaderboardParticipationScreenTag
import com.flashcardsopensourceapp.feature.settings.review.reviewNotificationsScreenTag
import com.flashcardsopensourceapp.feature.settings.scheduler.schedulerSettingsScreenTag
import com.flashcardsopensourceapp.feature.settings.server.serverSettingsScreenTag
import com.flashcardsopensourceapp.feature.settings.settingsAccessRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAccountStatusRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAgentConnectionsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAccountSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsAdvancedSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDecksRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteAccountRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeviceDiagnosticsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsExportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsFeedbackRowTag
import com.flashcardsopensourceapp.feature.settings.settingsGeneralSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsImportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLanguageRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLeaderboardParticipationRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLegalRowTag
import com.flashcardsopensourceapp.feature.settings.settingsOpenSourceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsResetStudyProgressRowTag
import com.flashcardsopensourceapp.feature.settings.settingsReviewRemindersRowTag
import com.flashcardsopensourceapp.feature.settings.settingsRootScreenTag
import com.flashcardsopensourceapp.feature.settings.settingsSchedulingRowTag
import com.flashcardsopensourceapp.feature.settings.settingsServerRowTag
import com.flashcardsopensourceapp.feature.settings.settingsSupportSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsSupportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsTagsRowTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceListTag

internal fun LiveSmokeContext.openCardsTab() {
    clickNode(
        matcher = hasText("Cards").and(other = hasClickAction()),
        label = "Cards tab"
    )
}

internal fun LiveSmokeContext.openReviewTab() {
    clickNode(
        matcher = hasTestTag(ReviewDestination.testTag).and(other = hasClickAction()),
        label = "Review tab"
    )
}

internal fun LiveSmokeContext.openAiTab() {
    clickNode(
        matcher = hasText("AI").and(other = hasClickAction()),
        label = "AI tab"
    )
}

internal fun LiveSmokeContext.openSettingsTab() {
    clickNode(
        matcher = hasText("Settings").and(other = hasClickAction()),
        label = "Settings tab"
    )
}

internal fun LiveSmokeContext.openSettingsRow(rowTag: String, rowLabel: String) {
    openSettingsTab()
    val rowMatcher = hasTestTag(rowTag).and(other = hasClickAction())

    scrollSettingsRootTargetIntoView(
        targetTag = rowTag,
        targetLabel = rowLabel,
        targetMatcher = rowMatcher
    )
    clickNode(matcher = rowMatcher, label = rowLabel)
}

internal fun LiveSmokeContext.openSettingsRow(rowTag: String, rowLabel: String, destinationTag: String) {
    openSettingsRow(rowTag = rowTag, rowLabel = rowLabel)
    waitForTagToExist(
        tag = destinationTag,
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for settings detail '$rowLabel'"
    )
}

internal fun LiveSmokeContext.assertSettingsInformationArchitecture() {
    openSettingsTab()
    listOf(
        settingsAccountSectionTag to "Account",
        settingsGeneralSectionTag to "General",
        settingsSupportSectionTag to "Support",
        settingsAdvancedSectionTag to "Advanced"
    ).forEach { section ->
        val sectionTag = section.first
        val sectionLabel = section.second
        scrollSettingsRootTargetIntoView(
            targetTag = sectionTag,
            targetLabel = sectionLabel,
            targetMatcher = hasTestTag(sectionTag)
        )
    }

    listOf(
        settingsAccountStatusRowTag to "Account status",
        settingsCurrentWorkspaceRowTag to "Workspace",
        settingsReviewRemindersRowTag to "Reminders",
        settingsLeaderboardParticipationRowTag to "Leaderboard participation",
        settingsLanguageRowTag to "Language",
        settingsAccessRowTag to "Access",
        settingsDecksRowTag to "Decks",
        settingsTagsRowTag to "Tags",
        settingsImportRowTag to "Import",
        settingsExportRowTag to "Export",
        settingsFeedbackRowTag to "Send feedback",
        settingsSupportRowTag to "Support",
        settingsLegalRowTag to "Legal",
        settingsOpenSourceRowTag to "Open source",
        settingsSchedulingRowTag to "Scheduling / FSRS",
        settingsAgentConnectionsRowTag to "Agent connections",
        settingsServerRowTag to "Server",
        settingsDeviceDiagnosticsRowTag to "Device",
        settingsResetStudyProgressRowTag to "Reset study progress",
        settingsDeleteCurrentWorkspaceRowTag to "Delete current workspace",
        settingsDeleteAccountRowTag to "Delete account"
    ).forEach { row ->
        val rowTag = row.first
        val rowLabel = row.second
        scrollSettingsRootTargetIntoView(
            targetTag = rowTag,
            targetLabel = rowLabel,
            targetMatcher = hasTestTag(rowTag).and(other = hasClickAction())
        )
    }
}

internal fun LiveSmokeContext.openSettingsInformationArchitectureDetails() {
    listOf(
        SettingsDetailProbe(
            rowTag = settingsAccountStatusRowTag,
            rowLabel = "Account status",
            destinationTag = accountStatusScreenTag
        ),
        SettingsDetailProbe(
            rowTag = settingsCurrentWorkspaceRowTag,
            rowLabel = "Workspace",
            destinationTag = currentWorkspaceListTag
        ),
        SettingsDetailProbe(
            rowTag = settingsReviewRemindersRowTag,
            rowLabel = "Reminders",
            destinationTag = reviewNotificationsScreenTag
        ),
        SettingsDetailProbe(
            rowTag = settingsLeaderboardParticipationRowTag,
            rowLabel = "Leaderboard participation",
            destinationTag = leaderboardParticipationScreenTag
        ),
        SettingsDetailProbe(
            rowTag = settingsLanguageRowTag,
            rowLabel = "Language",
            destinationTag = languageSettingsScreenTag
        ),
        SettingsDetailProbe(
            rowTag = settingsAccessRowTag,
            rowLabel = "Access",
            destinationTag = accessSettingsScreenTag
        ),
        SettingsDetailProbe(
            rowTag = settingsSchedulingRowTag,
            rowLabel = "Scheduling / FSRS",
            destinationTag = schedulerSettingsScreenTag
        ),
        SettingsDetailProbe(
            rowTag = settingsServerRowTag,
            rowLabel = "Server",
            destinationTag = serverSettingsScreenTag
        ),
        SettingsDetailProbe(
            rowTag = settingsDeviceDiagnosticsRowTag,
            rowLabel = "Device",
            destinationTag = deviceDiagnosticsScreenTag
        )
    ).forEach { probe ->
        openSettingsRow(
            rowTag = probe.rowTag,
            rowLabel = probe.rowLabel,
            destinationTag = probe.destinationTag
        )
        if (probe.rowTag == settingsLanguageRowTag) {
            composeRule.onNodeWithTag(testTag = languageSettingsScreenTag)
                .performScrollToNode(matcher = hasTestTag(languageSettingsSupportedLanguagesSectionTag))
            waitForTagToExist(
                tag = languageSettingsSupportedLanguagesSectionTag,
                timeoutMillis = internalUiTimeoutMillis,
                context = "while verifying Language supported languages section"
            )
        }
        tapBackIcon()
    }
}

internal fun LiveSmokeContext.dismissAiConsentIfNeeded() {
    if (composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isNotEmpty()) {
        clickText(text = "OK", substring = false)
    }
}

internal fun LiveSmokeContext.updateCardText(fieldTitle: String, value: String) {
    clickText(text = fieldTitle, substring = false)
    composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement(value)
    tapBackIcon()
}

private data class SettingsDetailProbe(
    val rowTag: String,
    val rowLabel: String,
    val destinationTag: String
)

private fun LiveSmokeContext.scrollSettingsRootTargetIntoView(
    targetTag: String,
    targetLabel: String,
    targetMatcher: SemanticsMatcher
) {
    composeRule.onNodeWithTag(testTag = settingsRootScreenTag)
        .performScrollToNode(matcher = targetMatcher)
    waitForTagToExist(
        tag = targetTag,
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for settings root target '$targetLabel'"
    )
    composeRule.onNodeWithTag(testTag = targetTag).performScrollTo()
    waitForSettingsRootTargetToBeDisplayed(
        targetTag = targetTag,
        targetLabel = targetLabel
    )
}

private fun LiveSmokeContext.waitForSettingsRootTargetToBeDisplayed(
    targetTag: String,
    targetLabel: String
) {
    waitUntilWithMitigation(
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for settings root target '$targetLabel' to be displayed"
    ) {
        composeRule.onNodeWithTag(testTag = targetTag).isDisplayed()
    }
}
