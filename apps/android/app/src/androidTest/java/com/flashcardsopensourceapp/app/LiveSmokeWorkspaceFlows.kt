@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app

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
import com.flashcardsopensourceapp.feature.settings.cloudPostAuthWorkspaceRowTag
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

private enum class DeletePreviewResolution {
    PREVIEW_READY,
    ERROR_VISIBLE
}

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

    val preferredRowIndex: Int = visibleRows.indexOfFirst { row -> row.contains(other = "(Current)") }
        .takeIf { index -> index >= 0 }
        ?: 0
    runWithInlineRawScreenStateOnFailure(action = "click_post_auth_workspace_row") {
        dismissExternalSystemDialogIfPresent()
        composeRule.onAllNodesWithTag(cloudPostAuthWorkspaceRowTag)[preferredRowIndex].performClick()
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

internal fun LiveSmokeContext.createEphemeralWorkspace(workspaceName: String) {
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
    composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
        matcher = hasTestTag(currentWorkspaceCreateButtonTag)
    )
    clickTag(tag = currentWorkspaceCreateButtonTag, label = "Create new workspace")
    waitForSelectedWorkspaceSummaryToChange(
        beforeSummary = selectedWorkspaceSummaryBeforeCreate,
        context = "after creating a linked workspace",
        timeoutMillis = externalUiTimeoutMillis
    )
    tapBackIcon()

    openSettingsSection(sectionTitle = "Workspace")
    clickText(text = "Overview", substring = false)
    composeRule.onNodeWithTag(workspaceOverviewNameFieldTag).performTextReplacement(workspaceName)
    clickTag(tag = workspaceOverviewSaveNameButtonTag, label = "Save workspace name")
    waitForWorkspaceRenameOutcome(expectedWorkspaceName = workspaceName)
    tapBackIcon()
    tapBackIcon()
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitForCurrentWorkspaceName(expectedWorkspaceName = workspaceName)
    tapBackIcon()
}

internal fun LiveSmokeContext.deleteEphemeralWorkspace(workspaceName: String) {
    forceLinkedSyncAndWaitForWorkspace(
        expectedWorkspaceName = workspaceName,
        timeoutMillis = externalUiTimeoutMillis
    )
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Create new workspace"),
        timeoutMillis = internalUiTimeoutMillis
    )
    if (composeRule.onAllNodesWithText(workspaceName).fetchSemanticsNodes().isEmpty()) {
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
    openDeletePreview(workspaceName = workspaceName)
    clickTag(
        tag = workspaceOverviewDeletePreviewContinueButtonTag,
        label = "Continue workspace delete preview"
    )
    waitForDeleteConfirmationReady(workspaceName = workspaceName)
    val confirmationPhrase: String = requireNotNull(deleteConfirmationPhraseOrNull()) {
        "Delete confirmation phrase was missing for workspace '$workspaceName'."
    }
    composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationFieldTag)
        .performTextReplacement(confirmationPhrase)
    tapDeleteWorkspaceConfirmation(workspaceName = workspaceName)
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
            composeRule.onAllNodesWithText(workspaceName).fetchSemanticsNodes().isEmpty() &&
                currentWorkspaceName != workspaceName &&
                selectedSummary?.contains(other = workspaceName) != true
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace deletion did not switch away from '$workspaceName'. " +
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
    expectedWorkspaceName: String,
    timeoutMillis: Long
) {
    val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
    try {
        runBlocking {
            appGraph.syncRepository.syncNow()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Forced linked sync before cleanup failed. " +
                "Workspace=$expectedWorkspaceName " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }

    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitForCurrentWorkspaceName(expectedWorkspaceName = expectedWorkspaceName)
    waitForSelectedWorkspaceSummary(
        context = "after forcing linked sync before cleanup",
        timeoutMillis = timeoutMillis
    )
    val selectedWorkspace: String = selectedWorkspaceSummary(
        context = "after forcing linked sync before cleanup"
    )
    if (selectedWorkspace.contains(other = expectedWorkspaceName).not()) {
        throw AssertionError(
            "Forced linked sync kept the wrong workspace selected before cleanup. " +
                "ExpectedWorkspace=$expectedWorkspaceName " +
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
    val taggedSelection: String? = composeRule.onAllNodesWithTag(currentWorkspaceSelectedSummaryTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
    if (taggedSelection != null) {
        return taggedSelection
    }
    scrollCurrentWorkspaceListToSelectedWorkspace()
    return captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)
        .firstOrNull { row -> row.contains(other = "(Current)") }
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
    composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
        matcher = hasText("(Current)", substring = true)
    )
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
