@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.flashcardsopensourceapp.feature.settings.cloud.cloudPostAuthExistingButtonTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudPostAuthWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudSignInEmailFieldTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudSignInSendCodeButtonTag
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

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

private fun LiveSmokeContext.currentActiveWorkspaceIdOrNull(): String? {
    return runBlocking {
        appGraph().cloudAccountRepository.observeCloudSettings().first().activeWorkspaceId
    }
}
