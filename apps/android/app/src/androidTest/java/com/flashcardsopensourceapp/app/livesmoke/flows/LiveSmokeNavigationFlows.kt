@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke.flows

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickNode
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickTag
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.tapBackIcon
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTagToExist
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTextToExist
import com.flashcardsopensourceapp.app.livesmoke.support.LiveSmokeContext
import com.flashcardsopensourceapp.app.livesmoke.support.internalUiTimeoutMillis
import com.flashcardsopensourceapp.feature.settings.settingsAccessRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAccountStatusRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAgentConnectionsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDecksRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteAccountRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeviceDiagnosticsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsExportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsFeedbackRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLanguageRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLegalRowTag
import com.flashcardsopensourceapp.feature.settings.settingsOpenSourceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsResetStudyProgressRowTag
import com.flashcardsopensourceapp.feature.settings.settingsReviewRemindersRowTag
import com.flashcardsopensourceapp.feature.settings.settingsSchedulingRowTag
import com.flashcardsopensourceapp.feature.settings.settingsServerRowTag
import com.flashcardsopensourceapp.feature.settings.settingsSupportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsTagsRowTag

internal fun LiveSmokeContext.openCardsTab() {
    clickNode(
        matcher = hasText("Cards").and(other = hasClickAction()),
        label = "Cards tab"
    )
}

internal fun LiveSmokeContext.openReviewTab() {
    clickNode(
        matcher = hasText("Review").and(other = hasClickAction()),
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
    composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasTestTag(rowTag))
    waitForTagToExist(
        tag = rowTag,
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for settings row '$rowLabel'"
    )
    clickTag(tag = rowTag, label = rowLabel)
}

internal fun LiveSmokeContext.assertSettingsInformationArchitecture() {
    openSettingsTab()
    listOf(
        "Account",
        "General",
        "Support",
        "Advanced"
    ).forEach { sectionTitle ->
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasText(sectionTitle))
        waitForTextToExist(
            text = sectionTitle,
            substring = false,
            timeoutMillis = internalUiTimeoutMillis,
            context = "while verifying settings section '$sectionTitle'"
        )
    }

    listOf(
        settingsAccountStatusRowTag to "Account status",
        settingsCurrentWorkspaceRowTag to "Workspace",
        settingsReviewRemindersRowTag to "Review reminders",
        settingsLanguageRowTag to "Language",
        settingsAccessRowTag to "Access",
        settingsDecksRowTag to "Decks",
        settingsTagsRowTag to "Tags",
        settingsExportRowTag to "Export",
        settingsFeedbackRowTag to "Send feedback",
        settingsLegalRowTag to "Legal",
        settingsSupportRowTag to "Support",
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
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasTestTag(rowTag))
        waitForTagToExist(
            tag = rowTag,
            timeoutMillis = internalUiTimeoutMillis,
            context = "while verifying settings row '$rowLabel'"
        )
    }
}

internal fun LiveSmokeContext.openSettingsInformationArchitectureDetails() {
    listOf(
        SettingsDetailProbe(
            rowTag = settingsAccountStatusRowTag,
            rowLabel = "Account status",
            expectedText = "Cloud status"
        ),
        SettingsDetailProbe(
            rowTag = settingsCurrentWorkspaceRowTag,
            rowLabel = "Workspace",
            expectedText = "Cloud status"
        ),
        SettingsDetailProbe(
            rowTag = settingsReviewRemindersRowTag,
            rowLabel = "Review reminders",
            expectedText = "Workspace review reminders"
        ),
        SettingsDetailProbe(
            rowTag = settingsLanguageRowTag,
            rowLabel = "Language",
            expectedText = "Android controls the app language"
        ),
        SettingsDetailProbe(
            rowTag = settingsAccessRowTag,
            rowLabel = "Access",
            expectedText = "Camera"
        ),
        SettingsDetailProbe(
            rowTag = settingsSchedulingRowTag,
            rowLabel = "Scheduling / FSRS",
            expectedText = "Desired retention"
        ),
        SettingsDetailProbe(
            rowTag = settingsServerRowTag,
            rowLabel = "Server",
            expectedText = "Current server"
        ),
        SettingsDetailProbe(
            rowTag = settingsDeviceDiagnosticsRowTag,
            rowLabel = "Device",
            expectedText = "Workspace ID"
        )
    ).forEach { probe ->
        openSettingsRow(rowTag = probe.rowTag, rowLabel = probe.rowLabel)
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(
            matcher = hasText(probe.expectedText, substring = true)
        )
        waitForTextToExist(
            text = probe.expectedText,
            substring = true,
            timeoutMillis = internalUiTimeoutMillis,
            context = "while verifying ${probe.rowLabel} detail"
        )
        if (probe.rowTag == settingsLanguageRowTag) {
            composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasText("Supported languages"))
            waitForTextToExist(
                text = "Supported languages",
                substring = false,
                timeoutMillis = internalUiTimeoutMillis,
                context = "while verifying Language supported languages title"
            )
            waitForTextToExist(
                text = "English",
                substring = true,
                timeoutMillis = internalUiTimeoutMillis,
                context = "while verifying Language supported languages list"
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
    val expectedText: String
)
