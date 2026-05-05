@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewTodayDueCountTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewTodayNewCountTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewTodayReviewedCountTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressErrorTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressPreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressPreviewButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceSettingsResetProgressPreviewDialogTag

internal fun LiveSmokeContext.resetWorkspaceProgressFromSettings(expectedCardsToResetCount: Int) {
    openSettingsSection(sectionTitle = "Workspace")
    clickTag(tag = workspaceSettingsResetProgressButtonTag, label = "Reset all progress")
    waitForResetProgressConfirmationReady()

    val confirmationPhrase = readTaggedText(
        tag = workspaceSettingsResetProgressConfirmationPhraseTag,
        label = "reset progress confirmation phrase"
    )
    composeRule.onNodeWithTag(workspaceSettingsResetProgressConfirmationFieldTag)
        .performTextReplacement(confirmationPhrase)
    clickTag(
        tag = workspaceSettingsResetProgressConfirmationButtonTag,
        label = "Continue reset progress"
    )

    waitForResetProgressPreviewReady(expectedCardsToResetCount = expectedCardsToResetCount)
    clickTag(tag = workspaceSettingsResetProgressPreviewButtonTag, label = "Confirm reset progress")
    waitForTagToDisappear(
        tag = workspaceSettingsResetProgressPreviewDialogTag,
        timeoutMillis = externalUiTimeoutMillis,
        context = "while waiting for reset progress to complete"
    )
}

internal fun LiveSmokeContext.assertWorkspaceTodayCounts(
    expectedDueCount: Int,
    expectedNewCount: Int,
    expectedReviewedCount: Int
) {
    openSettingsSection(sectionTitle = "Workspace")
    clickNode(
        matcher = hasText("Overview").and(other = hasClickAction()),
        label = "Workspace overview"
    )
    waitUntilWithMitigation(
        timeoutMillis = externalUiTimeoutMillis,
        context = "while waiting for workspace overview counts"
    ) {
        readTaggedTextOrNull(workspaceOverviewTodayDueCountTag) != null &&
            readTaggedTextOrNull(workspaceOverviewTodayNewCountTag) != null &&
            readTaggedTextOrNull(workspaceOverviewTodayReviewedCountTag) != null
    }

    val dueCount = readTaggedText(
        tag = workspaceOverviewTodayDueCountTag,
        label = "workspace overview due count"
    ).toInt()
    val newCount = readTaggedText(
        tag = workspaceOverviewTodayNewCountTag,
        label = "workspace overview new count"
    ).toInt()
    val reviewedCount = readTaggedText(
        tag = workspaceOverviewTodayReviewedCountTag,
        label = "workspace overview reviewed count"
    ).toInt()

    if (
        dueCount != expectedDueCount ||
        newCount != expectedNewCount ||
        reviewedCount != expectedReviewedCount
    ) {
        throw AssertionError(
            "Workspace overview counts did not match. " +
                "Expected due/new/reviewed=$expectedDueCount/$expectedNewCount/$expectedReviewedCount " +
                "but was $dueCount/$newCount/$reviewedCount. " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
        )
    }
}

private fun LiveSmokeContext.waitForResetProgressConfirmationReady() {
    try {
        waitForTagToExist(
            tag = workspaceSettingsResetProgressConfirmationDialogTag,
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for reset progress confirmation dialog"
        )
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for reset progress confirmation fields"
        ) {
            composeRule.onAllNodesWithTag(workspaceSettingsResetProgressConfirmationPhraseTag)
                .fetchSemanticsNodes()
                .isNotEmpty() &&
                composeRule.onAllNodesWithTag(workspaceSettingsResetProgressConfirmationFieldTag)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Reset progress confirmation dialog did not become ready. " +
                "ConfirmationPhrase=${readTaggedTextOrNull(workspaceSettingsResetProgressConfirmationPhraseTag)} " +
                "ConfirmationError=${workspaceSettingsResetProgressErrorTextOrNull()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForResetProgressPreviewReady(expectedCardsToResetCount: Int) {
    try {
        waitForTagToExist(
            tag = workspaceSettingsResetProgressPreviewDialogTag,
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for reset progress preview dialog"
        )
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for reset progress preview body"
        ) {
            val previewBodyText = readTaggedTextOrNull(workspaceSettingsResetProgressPreviewBodyTag)
            previewBodyText != null &&
                extractResetProgressCount(previewBodyText) == expectedCardsToResetCount
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Reset progress preview did not become ready. " +
                "PreviewBody=${readTaggedTextOrNull(workspaceSettingsResetProgressPreviewBodyTag)} " +
                "PreviewError=${workspaceSettingsResetProgressErrorTextOrNull()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.readTaggedText(tag: String, label: String): String {
    waitForTagToExist(
        tag = tag,
        timeoutMillis = externalUiTimeoutMillis,
        context = "while reading $label"
    )
    val text = nodeSummary(composeRule.onNodeWithTag(tag).fetchSemanticsNode()).trim()
    if (text.isBlank()) {
        throw AssertionError("Tagged text for $label was blank.")
    }

    return text
}

private fun LiveSmokeContext.readTaggedTextOrNull(tag: String): String? {
    return composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
        ?.trim()
        ?.takeIf { text -> text.isNotBlank() }
}

private fun LiveSmokeContext.workspaceSettingsResetProgressErrorTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceSettingsResetProgressErrorTag).fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
        ?.trim()
        ?.takeIf { text -> text.isNotBlank() }
}

private fun extractResetProgressCount(previewBodyText: String): Int {
    val match = Regex("""reset progress for (\d+) card""").find(previewBodyText)
        ?: throw AssertionError("Reset progress preview body did not contain a card count: '$previewBodyText'")
    return match.groupValues[1].toInt()
}
