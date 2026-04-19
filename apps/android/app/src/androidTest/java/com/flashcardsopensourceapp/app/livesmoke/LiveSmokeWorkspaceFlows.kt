@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.feature.settings.cloudPostAuthWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.cloudPostAuthExistingButtonTag
import com.flashcardsopensourceapp.feature.settings.cloudSignInEmailFieldTag
import com.flashcardsopensourceapp.feature.settings.cloudSignInSendCodeButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceExistingRowTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceLoadingStateTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceNameTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceOperationMessageTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceReloadButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceSelectedSummaryTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressErrorTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressPreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressPreviewButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceSettingsResetProgressPreviewDialogTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewTodayDueCountTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewTodayNewCountTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewTodayReviewedCountTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationErrorTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationLoadingTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewContinueButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewDialogTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteWorkspaceButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewNameFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewSaveNameButtonTag
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

private enum class DeletePreviewResolution {
    PREVIEW_READY,
    ERROR_VISIBLE
}

private data class LinkedWorkspaceSelectionSnapshot(
    val cloudState: CloudAccountState,
    val activeWorkspaceId: String?,
    val linkedWorkspaceId: String?,
    val workspaceId: String?,
    val workspaceName: String?
)

internal data class EphemeralWorkspaceHandle(
    val workspaceId: String,
    val workspaceName: String
)

private const val linkedSignInTimeoutMillis: Long = 120_000L
private const val cloudPostAuthLinkingWorkspaceTitle: String = "Linking workspace"
private const val cloudPostAuthSyncingWorkspaceTitle: String = "Syncing workspace"
private const val cloudPostAuthGuestUpgradeTitle: String = "Upgrading guest account"
private const val cloudPostAuthRetryButtonText: String = "Retry"
private const val accountStatusSyncNowButtonText: String = "Sync now"

internal fun LiveSmokeContext.signInWithReviewAccount(reviewEmail: String) {
    openSettingsTab()
    clickNode(
        matcher = hasText("Account").and(other = hasClickAction()),
        label = "Account"
    )
    clickText(text = "Account status", substring = false)
    clickText(text = "Sign in or sign up", substring = false)
    composeRule.onNodeWithTag(cloudSignInEmailFieldTag).performTextInput(reviewEmail)
    clickTag(tag = cloudSignInSendCodeButtonTag, label = "Send code")

    waitForCloudSignInSurface()
    completeCloudPostAuthWorkspaceSelectionIfNeeded()
    waitForLinkedAccountStatusAfterSignIn()
    tapBackIcon()
    tapBackIcon()
}

private fun LiveSmokeContext.waitForCloudSignInSurface() {
    try {
        waitUntilWithMitigation(
            timeoutMillis = linkedSignInTimeoutMillis,
            context = "while waiting for sign-in to reach account status or post-auth sync"
        ) {
            hasVisibleText(text = accountStatusSyncNowButtonText, substring = false) ||
                hasVisibleText(text = cloudSyncChooserPrompt, substring = false) ||
                hasVisibleText(text = cloudPostAuthLinkingWorkspaceTitle, substring = false) ||
                hasVisibleText(text = cloudPostAuthSyncingWorkspaceTitle, substring = false) ||
                hasVisibleText(text = cloudPostAuthGuestUpgradeTitle, substring = false) ||
                hasVisibleText(text = cloudPostAuthRetryButtonText, substring = false)
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Sign-in did not reach account status or post-auth sync. " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = cloudPostAuthWorkspaceRowTag)} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.completeCloudPostAuthWorkspaceSelectionIfNeeded() {
    if (hasVisibleText(text = cloudSyncChooserPrompt, substring = false).not()) {
        return
    }

    val visibleRows: List<String> = captureVisibleWorkspaceRows(rowTag = cloudPostAuthWorkspaceRowTag)
    if (visibleRows.isEmpty()) {
        throw AssertionError(
            "Cloud sync chooser was visible without selectable workspace rows. " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
        )
    }

    runWithInlineRawScreenStateOnFailure(action = "click_post_auth_workspace_row") {
        dismissExternalSystemDialogIfPresent()
        val preferredWorkspaceId: String? = currentActiveWorkspaceIdOrNull()
        if (
            preferredWorkspaceId != null &&
            composeRule.onAllNodesWithTag(
                testTag = cloudPostAuthExistingButtonTag(workspaceId = preferredWorkspaceId)
            ).fetchSemanticsNodes().isNotEmpty()
        ) {
            composeRule.onNodeWithTag(
                testTag = cloudPostAuthExistingButtonTag(workspaceId = preferredWorkspaceId)
            ).performClick()
        } else {
            composeRule.onAllNodesWithTag(cloudPostAuthWorkspaceRowTag)[0].performClick()
        }
        composeRule.waitForIdle()
    }
}

private fun LiveSmokeContext.waitForLinkedAccountStatusAfterSignIn() {
    try {
        waitUntilWithMitigation(
            timeoutMillis = linkedSignInTimeoutMillis,
            context = "while waiting for the linked account status surface after sign-in"
        ) {
            if (hasVisibleText(text = cloudPostAuthRetryButtonText, substring = false)) {
                throw AssertionError(
                    "Cloud post-auth failed after sign-in. " +
                        "CloudSettings=${currentCloudSettingsSummary()} " +
                        "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
                        "VisibleRows=${captureVisibleWorkspaceRows(rowTag = cloudPostAuthWorkspaceRowTag)}"
                )
            }
            hasVisibleText(text = accountStatusSyncNowButtonText, substring = false)
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Linked account status did not appear after sign-in. " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = cloudPostAuthWorkspaceRowTag)} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.createEphemeralWorkspace(workspaceName: String): EphemeralWorkspaceHandle {
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Create new workspace"),
        timeoutMillis = internalUiTimeoutMillis
    )
    waitForSelectedWorkspaceSummary(
        context = "before creating a linked workspace",
        timeoutMillis = internalUiTimeoutMillis
    )
    val selectedWorkspaceSummaryBeforeCreate: String = selectedWorkspaceSummary(
        context = "before creating a linked workspace"
    )
    val selectedWorkspaceIdBeforeCreate: String = currentWorkspaceIdOrThrow(
        context = "before creating a linked workspace"
    )
    composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
        matcher = hasTestTag(currentWorkspaceCreateButtonTag)
    )
    clickTag(tag = currentWorkspaceCreateButtonTag, label = "Create new workspace")
    val createdWorkspaceSelection: LinkedWorkspaceSelectionSnapshot = waitForLinkedWorkspaceSelectionToChange(
        previousWorkspaceId = selectedWorkspaceIdBeforeCreate,
        timeoutMillis = externalUiTimeoutMillis,
        context = "after creating a linked workspace"
    )
    waitForSelectedWorkspaceSummaryToChange(
        beforeSummary = selectedWorkspaceSummaryBeforeCreate,
        context = "after creating a linked workspace",
        timeoutMillis = externalUiTimeoutMillis
    )
    waitForCurrentWorkspaceOperationToFinish()
    tapBackIcon()

    openSettingsSection(sectionTitle = "Workspace")
    clickText(text = "Overview", substring = false)
    waitForWorkspaceOverviewReady(
        expectedWorkspaceName = workspaceName,
        requireExpectedWorkspaceName = false,
        context = "before renaming the linked workspace"
    )
    composeRule.onNodeWithTag(workspaceOverviewNameFieldTag).performTextReplacement(workspaceName)
    clickTag(tag = workspaceOverviewSaveNameButtonTag, label = "Save workspace name")
    waitForWorkspaceRenameOutcome(expectedWorkspaceName = workspaceName)
    val renamedWorkspaceSelection: LinkedWorkspaceSelectionSnapshot = waitForLinkedWorkspaceName(
        expectedWorkspaceName = workspaceName,
        timeoutMillis = externalUiTimeoutMillis,
        context = "after renaming the linked workspace"
    )
    tapBackIcon()
    tapBackIcon()
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitForCurrentWorkspaceName(expectedWorkspaceName = workspaceName)
    tapBackIcon()

    return EphemeralWorkspaceHandle(
        workspaceId = renamedWorkspaceSelection.workspaceId ?: createdWorkspaceSelection.workspaceId
            ?: throw AssertionError(
                "Created linked workspace did not expose a stable workspace ID. " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
            ),
        workspaceName = workspaceName
    )
}

internal fun LiveSmokeContext.deleteEphemeralWorkspace(workspaceHandle: EphemeralWorkspaceHandle) {
    forceLinkedSyncAndWaitForWorkspace(
        workspaceHandle = workspaceHandle,
        timeoutMillis = externalUiTimeoutMillis
    )
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Create new workspace"),
        timeoutMillis = internalUiTimeoutMillis
    )
    if (composeRule.onAllNodesWithText(workspaceHandle.workspaceName).fetchSemanticsNodes().isEmpty()) {
        tapBackIcon()
        return
    }
    waitForSelectedWorkspaceSummary(
        context = "before deleting the isolated linked workspace",
        timeoutMillis = internalUiTimeoutMillis
    )
    tapBackIcon()

    openSettingsSection(sectionTitle = "Workspace")
    clickText(text = "Overview", substring = false)
    waitForWorkspaceOverviewReady(
        expectedWorkspaceName = workspaceHandle.workspaceName,
        requireExpectedWorkspaceName = true,
        context = "before deleting the isolated linked workspace"
    )
    openDeletePreview(workspaceName = workspaceHandle.workspaceName)
    clickTag(
        tag = workspaceOverviewDeletePreviewContinueButtonTag,
        label = "Continue workspace delete preview"
    )
    waitForDeleteConfirmationReady(workspaceName = workspaceHandle.workspaceName)
    val confirmationPhrase: String = requireNotNull(deleteConfirmationPhraseOrNull()) {
        "Delete confirmation phrase was missing for workspace '${workspaceHandle.workspaceName}'."
    }
    composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationFieldTag)
        .performTextReplacement(confirmationPhrase)
    tapDeleteWorkspaceConfirmation(workspaceName = workspaceHandle.workspaceName)
    waitForLinkedWorkspaceSelectionToChange(
        previousWorkspaceId = workspaceHandle.workspaceId,
        timeoutMillis = externalUiTimeoutMillis,
        context = "after deleting the isolated linked workspace"
    )
    tapBackIcon()
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for workspace deletion to finish"
        ) {
            val currentWorkspaceName: String? = currentWorkspaceNameOrNull()
            val selectedSummary: String? = selectedWorkspaceSummaryOrNull()
            composeRule.onAllNodesWithText(workspaceHandle.workspaceName).fetchSemanticsNodes().isEmpty() &&
                currentWorkspaceName != workspaceHandle.workspaceName &&
                selectedSummary?.contains(other = workspaceHandle.workspaceName) != true
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace deletion did not switch away from '${workspaceHandle.workspaceName}'. " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                "PreviewDialogVisible=${isDeletePreviewDialogVisible()} " +
                "ConfirmationDialogVisible=${isDeleteConfirmationDialogVisible()}",
            error
        )
    }
    waitForSelectedWorkspaceSummary(
        context = "after deleting the isolated linked workspace",
        timeoutMillis = externalUiTimeoutMillis
    )
    tapBackIcon()
}

internal fun LiveSmokeContext.forceLinkedSyncAndWaitForWorkspace(
    workspaceHandle: EphemeralWorkspaceHandle,
    timeoutMillis: Long
) {
    waitForLinkedWorkspaceHandle(
        workspaceHandle = workspaceHandle,
        timeoutMillis = timeoutMillis,
        context = "before forcing linked sync before cleanup"
    )
    val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
    try {
        runBlocking {
            appGraph.syncRepository.syncNow()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Forced linked sync before cleanup failed. " +
                "WorkspaceId=${workspaceHandle.workspaceId} " +
                "WorkspaceName=${workspaceHandle.workspaceName} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
    waitForLinkedWorkspaceHandle(
        workspaceHandle = workspaceHandle,
        timeoutMillis = timeoutMillis,
        context = "after forcing linked sync before cleanup"
    )

    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitForCurrentWorkspaceName(expectedWorkspaceName = workspaceHandle.workspaceName)
    waitForSelectedWorkspaceSummary(
        context = "after forcing linked sync before cleanup",
        timeoutMillis = timeoutMillis
    )
    val selectedWorkspace: String = selectedWorkspaceSummary(
        context = "after forcing linked sync before cleanup"
    )
    if (selectedWorkspace.contains(other = workspaceHandle.workspaceName).not()) {
        throw AssertionError(
            "Forced linked sync kept the wrong workspace selected before cleanup. " +
                "ExpectedWorkspaceId=${workspaceHandle.workspaceId} " +
                "ExpectedWorkspaceName=${workspaceHandle.workspaceName} " +
                "SelectedWorkspace=$selectedWorkspace " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
        )
    }
    tapBackIcon()
}

private fun LiveSmokeContext.openDeletePreview(workspaceName: String) {
    clickTag(tag = workspaceOverviewDeleteWorkspaceButtonTag, label = "Delete workspace")
    val resolution: DeletePreviewResolution = waitForDeletePreviewResolution(workspaceName = workspaceName)
    if (resolution == DeletePreviewResolution.PREVIEW_READY) {
        return
    }
    throw AssertionError(
        "Delete workspace preview resolved with an error state. " +
            "Workspace=$workspaceName " +
            "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
            "PreviewBody=${deletePreviewBodyTextOrNull()} " +
            "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
            "CloudSettings=${currentCloudSettingsSummary()} " +
            "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
    )
}

private fun LiveSmokeContext.waitForDeletePreviewResolution(
    workspaceName: String
): DeletePreviewResolution {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for delete preview resolution for '$workspaceName'"
        ) {
            isDeletePreviewDialogVisible() || workspaceOverviewErrorMessageOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete workspace preview did not resolve for '$workspaceName'. " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                "PreviewBody=${deletePreviewBodyTextOrNull()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
    return if (isDeletePreviewDialogVisible()) {
        DeletePreviewResolution.PREVIEW_READY
    } else {
        DeletePreviewResolution.ERROR_VISIBLE
    }
}

private fun LiveSmokeContext.waitForDeleteConfirmationReady(workspaceName: String) {
    try {
        waitForTagToExist(
            tag = workspaceOverviewDeleteConfirmationDialogTag,
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for the delete confirmation dialog for '$workspaceName'"
        )
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for delete confirmation readiness for '$workspaceName'"
        ) {
            isDeleteConfirmationDialogVisible() &&
                deleteConfirmationPhraseOrNull().isNullOrBlank().not() &&
                composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationFieldTag)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete confirmation dialog did not become ready for '$workspaceName'. " +
                "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                "ConfirmationError=${deleteConfirmationErrorOrNull()} " +
                "ConfirmationLoading=${isDeleteConfirmationLoadingVisible()} " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.tapDeleteWorkspaceConfirmation(workspaceName: String) {
    dismissExternalSystemDialogIfPresent()
    composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationButtonTag).performClick()
    composeRule.waitForIdle()
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for delete confirmation completion for '$workspaceName'"
        ) {
            val confirmationError: String? = deleteConfirmationErrorOrNull()
            if (confirmationError != null) {
                throw AssertionError(
                    "Delete workspace confirmation failed for '$workspaceName': $confirmationError. " +
                        "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                        "CloudSettings=${currentCloudSettingsSummary()} " +
                        "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
                )
            }
            isDeleteConfirmationDialogVisible().not()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete workspace confirmation did not complete for '$workspaceName'. " +
                "ConfirmationError=${deleteConfirmationErrorOrNull()} " +
                "ConfirmationLoading=${isDeleteConfirmationLoadingVisible()} " +
                "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
}

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

internal fun LiveSmokeContext.openSettingsSection(sectionTitle: String) {
    openSettingsTab()
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText(sectionTitle),
        timeoutMillis = internalUiTimeoutMillis
    )
    clickNode(
        matcher = hasText(sectionTitle).and(other = hasClickAction()),
        label = sectionTitle
    )
}

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

internal fun LiveSmokeContext.waitForSelectedWorkspaceSummary(context: String, timeoutMillis: Long) {
    try {
        scrollCurrentWorkspaceListToSelectedWorkspace()
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for current workspace selection $context"
        ) {
            selectedWorkspaceSummaryOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace selection did not settle $context. " +
                "Visible linked workspaces=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "Current workspace name=${currentWorkspaceNameOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.waitForCurrentWorkspaceScreenToSettle() {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for the Current Workspace screen to settle"
        ) {
            val visibleError: String? = currentWorkspaceVisibleErrorMessageOrNull()
            if (visibleError != null) {
                throw AssertionError("Current Workspace settled with an error: $visibleError")
            }

            val isLoading: Boolean = composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag)
                .fetchSemanticsNodes()
                .isNotEmpty()
            isLoading.not() && (
                composeRule.onAllNodesWithTag(currentWorkspaceCreateButtonTag)
                    .fetchSemanticsNodes()
                    .isNotEmpty() ||
                    composeRule.onAllNodesWithTag(currentWorkspaceReloadButtonTag)
                        .fetchSemanticsNodes()
                        .isNotEmpty()
                )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current Workspace screen did not settle. " +
                "Loading=${composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag).fetchSemanticsNodes().isNotEmpty()} " +
                "Error=${currentWorkspaceVisibleErrorMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForSelectedWorkspaceSummaryToChange(
    beforeSummary: String,
    context: String,
    timeoutMillis: Long
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for current workspace selection to change $context"
        ) {
            runCatching {
                scrollCurrentWorkspaceListToSelectedWorkspace()
                selectedWorkspaceSummary(context = context) != beforeSummary
            }.getOrDefault(false)
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace selection did not change $context. " +
                "Before=$beforeSummary After=${selectedWorkspaceSummaryOrNull()} " +
                "Current workspace name=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceOperationToStart() {
    try {
        waitForTagToExist(
            tag = currentWorkspaceOperationMessageTag,
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for current workspace operation to start"
        )
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace operation did not start after tapping create. " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                "Current workspace name=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceOperationToFinish() {
    waitForCurrentWorkspaceOperationToLeaveSwitchingState()
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for current workspace operation to finish"
        ) {
            currentWorkspaceOperationMessageOrNull() == null &&
                currentWorkspaceNameOrNull() != "Unavailable" &&
                selectedWorkspaceSummaryOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace operation did not finish. " +
                "Operation=${currentWorkspaceOperationMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                "Current workspace name=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceOperationToLeaveSwitchingState() {
    try {
        waitUntilWithMitigation(
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for current workspace operation to leave switching"
        ) {
            currentWorkspaceOperationMessageOrNull()
                ?.startsWith(prefix = "Switching to")
                ?.not()
                ?: true
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace operation stayed in SWITCHING without progressing. " +
                "Operation=${currentWorkspaceOperationMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                "Current workspace name=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForWorkspaceRenameOutcome(expectedWorkspaceName: String) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for workspace rename to persist"
        ) {
            workspaceOverviewNameFieldValueOrNull() == expectedWorkspaceName &&
                hasVisibleText(text = "Saving...", substring = false).not()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace rename did not persist on the Overview screen. " +
                "FieldValue=${workspaceOverviewNameFieldValueOrNull()} " +
                "Error=${workspaceOverviewErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForWorkspaceOverviewReady(
    expectedWorkspaceName: String,
    requireExpectedWorkspaceName: Boolean,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for workspace overview readiness $context"
        ) {
            val workspaceNameFieldValue: String? = workspaceOverviewNameFieldValueOrNull()
            workspaceOverviewErrorMessageOrNull() == null &&
                hasVisibleText(text = "Saving...", substring = false).not() &&
                workspaceNameFieldValue != null &&
                workspaceNameFieldValue != "Unavailable" &&
                (
                    requireExpectedWorkspaceName.not() ||
                        workspaceNameFieldValue == expectedWorkspaceName
                    )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace overview did not settle $context. " +
                "ExpectedWorkspaceName=$expectedWorkspaceName " +
                "FieldValue=${workspaceOverviewNameFieldValueOrNull()} " +
                "Error=${workspaceOverviewErrorMessageOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.waitForCurrentWorkspaceName(expectedWorkspaceName: String) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for Current Workspace top card to update"
        ) {
            currentWorkspaceNameOrNull() == expectedWorkspaceName
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current Workspace top card did not update after rename. " +
                "TopCard=${currentWorkspaceNameOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.selectedWorkspaceSummary(context: String): String {
    val selectedSummary: String? = selectedWorkspaceSummaryOrNull()
    return requireNotNull(selectedSummary) {
        "Current workspace selection was missing $context."
    }
}

internal fun LiveSmokeContext.selectedWorkspaceSummaryOrNull(): String? {
    val taggedSelection: String? = selectedWorkspaceSummaryFromCurrentSemanticsTree()
    if (taggedSelection != null) {
        return taggedSelection
    }
    scrollCurrentWorkspaceListToSelectedWorkspace()
    return selectedWorkspaceSummaryFromCurrentSemanticsTree()
}

private fun LiveSmokeContext.selectedWorkspaceSummaryFromCurrentSemanticsTree(): String? {
    return selectedWorkspaceSummaryFromSemanticsTree(useUnmergedTree = false)
        ?: selectedWorkspaceSummaryFromSemanticsTree(useUnmergedTree = true)
}

private fun LiveSmokeContext.selectedWorkspaceSummaryFromSemanticsTree(
    useUnmergedTree: Boolean
): String? {
    return composeRule.onAllNodesWithTag(
        testTag = currentWorkspaceSelectedSummaryTag,
        useUnmergedTree = useUnmergedTree
    )
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummaryIncludingDescendants)
        ?.trim()
        ?.takeIf { summary -> summary.isNotBlank() }
}

internal fun LiveSmokeContext.workspaceOverviewNameFieldValueOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewNameFieldTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.config
        ?.getOrNull(SemanticsProperties.EditableText)
        ?.text
}

internal fun LiveSmokeContext.workspaceOverviewErrorMessageOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewErrorMessageTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

internal fun LiveSmokeContext.currentWorkspaceNameOrNull(): String? {
    scrollCurrentWorkspaceListToTopCard()
    return composeRule.onAllNodesWithTag(currentWorkspaceNameTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

internal fun LiveSmokeContext.currentWorkspaceErrorMessageOrNull(): String? {
    scrollCurrentWorkspaceListToTopCard()
    return currentWorkspaceVisibleErrorMessageOrNull()
}

internal fun LiveSmokeContext.currentWorkspaceVisibleErrorMessageOrNull(): String? {
    return composeRule.onAllNodesWithTag(currentWorkspaceErrorMessageTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

internal fun LiveSmokeContext.currentWorkspaceOperationMessageOrNull(): String? {
    scrollCurrentWorkspaceListToTopCard()
    return composeRule.onAllNodesWithTag(currentWorkspaceOperationMessageTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.scrollCurrentWorkspaceListToSelectedWorkspace() {
    if (composeRule.onAllNodesWithTag(currentWorkspaceListTag).fetchSemanticsNodes().isEmpty()) {
        return
    }
    runCatching {
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasTestTag(currentWorkspaceSelectedSummaryTag)
        )
    }
}

private fun LiveSmokeContext.scrollCurrentWorkspaceListToTopCard() {
    if (composeRule.onAllNodesWithTag(currentWorkspaceListTag).fetchSemanticsNodes().isEmpty()) {
        return
    }
    composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
        matcher = hasTestTag(currentWorkspaceNameTag)
    )
}

internal fun LiveSmokeContext.captureVisibleWorkspaceRows(rowTag: String): List<String> {
    return composeRule.onAllNodesWithTag(rowTag)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
}

internal fun LiveSmokeContext.currentCloudSettingsSummary(): String {
    return runBlocking {
        val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
        val cloudSettings = appGraph.cloudAccountRepository.observeCloudSettings().first()
        "cloudState=${cloudSettings.cloudState} " +
            "linkedUserId=${cloudSettings.linkedUserId} " +
            "linkedWorkspaceId=${cloudSettings.linkedWorkspaceId} " +
            "activeWorkspaceId=${cloudSettings.activeWorkspaceId} " +
            "installationId=${cloudSettings.installationId}"
    }
}

internal fun LiveSmokeContext.currentWorkspaceSummaryOrNull(): String? {
    return runBlocking {
        val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
        appGraph.workspaceRepository.observeWorkspace().first()?.let { workspace ->
            "workspaceId=${workspace.workspaceId} name=${workspace.name}"
        }
    }
}

private fun LiveSmokeContext.currentActiveWorkspaceIdOrNull(): String? {
    return runBlocking {
        appGraph().cloudAccountRepository.observeCloudSettings().first().activeWorkspaceId
    }
}

private fun LiveSmokeContext.currentWorkspaceIdOrThrow(context: String): String {
    return runBlocking {
        requireNotNull(appGraph().workspaceRepository.observeWorkspace().first()?.workspaceId) {
            "Workspace ID was missing $context."
        }
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceSelection(
    timeoutMillis: Long,
    context: String,
    predicate: (LinkedWorkspaceSelectionSnapshot) -> Boolean
): LinkedWorkspaceSelectionSnapshot {
    val appGraph = appGraph()
    try {
        return waitForFlowValue(
            timeoutMillis = timeoutMillis,
            context = "while waiting for linked workspace selection $context",
            flow = combine(
                appGraph.cloudAccountRepository.observeCloudSettings(),
                appGraph.workspaceRepository.observeWorkspace()
            ) { cloudSettings, workspace ->
                LinkedWorkspaceSelectionSnapshot(
                    cloudState = cloudSettings.cloudState,
                    activeWorkspaceId = cloudSettings.activeWorkspaceId,
                    linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                    workspaceId = workspace?.workspaceId,
                    workspaceName = workspace?.name
                )
            },
            predicate = predicate
        )
    } catch (error: Throwable) {
        throw AssertionError(
            "Linked workspace selection did not settle $context. " +
                "Snapshot=${currentLinkedWorkspaceSelectionSnapshotSummary()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceSelectionToChange(
    previousWorkspaceId: String,
    timeoutMillis: Long,
    context: String
): LinkedWorkspaceSelectionSnapshot {
    return waitForLinkedWorkspaceSelection(
        timeoutMillis = timeoutMillis,
        context = context
    ) { snapshot ->
        snapshot.isStableLinkedSelection() &&
            snapshot.workspaceId != previousWorkspaceId
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceName(
    expectedWorkspaceName: String,
    timeoutMillis: Long,
    context: String
): LinkedWorkspaceSelectionSnapshot {
    return waitForLinkedWorkspaceSelection(
        timeoutMillis = timeoutMillis,
        context = context
    ) { snapshot ->
        snapshot.isStableLinkedSelection() &&
            snapshot.workspaceName == expectedWorkspaceName
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceHandle(
    workspaceHandle: EphemeralWorkspaceHandle,
    timeoutMillis: Long,
    context: String
): LinkedWorkspaceSelectionSnapshot {
    return waitForLinkedWorkspaceSelection(
        timeoutMillis = timeoutMillis,
        context = context
    ) { snapshot ->
        snapshot.isStableLinkedSelection() &&
            snapshot.workspaceId == workspaceHandle.workspaceId &&
            snapshot.workspaceName == workspaceHandle.workspaceName
    }
}

private fun LinkedWorkspaceSelectionSnapshot.isStableLinkedSelection(): Boolean {
    return cloudState == CloudAccountState.LINKED &&
        activeWorkspaceId != null &&
        activeWorkspaceId == linkedWorkspaceId &&
        activeWorkspaceId == workspaceId
}

private fun LiveSmokeContext.currentLinkedWorkspaceSelectionSnapshotSummary(): String {
    val snapshot = runBlocking {
        combine(
            appGraph().cloudAccountRepository.observeCloudSettings(),
            appGraph().workspaceRepository.observeWorkspace()
        ) { cloudSettings, workspace ->
            LinkedWorkspaceSelectionSnapshot(
                cloudState = cloudSettings.cloudState,
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                workspaceId = workspace?.workspaceId,
                workspaceName = workspace?.name
            )
        }.first()
    }
    return "cloudState=${snapshot.cloudState} " +
        "activeWorkspaceId=${snapshot.activeWorkspaceId} " +
        "linkedWorkspaceId=${snapshot.linkedWorkspaceId} " +
        "workspaceId=${snapshot.workspaceId} " +
        "workspaceName=${snapshot.workspaceName}"
}

private fun LiveSmokeContext.isDeletePreviewDialogVisible(): Boolean {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeletePreviewDialogTag)
        .fetchSemanticsNodes()
        .isNotEmpty()
}

private fun LiveSmokeContext.deletePreviewBodyTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeletePreviewBodyTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.isDeleteConfirmationDialogVisible(): Boolean {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationDialogTag)
        .fetchSemanticsNodes()
        .isNotEmpty()
}

private fun LiveSmokeContext.deleteConfirmationPhraseOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationPhraseTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.deleteConfirmationErrorOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationErrorTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.isDeleteConfirmationLoadingVisible(): Boolean {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationLoadingTag)
        .fetchSemanticsNodes()
        .isNotEmpty()
}
