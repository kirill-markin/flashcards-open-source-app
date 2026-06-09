@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke.flows

import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickTag
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.currentBlockingSystemDialogSummaryOrNull
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.dismissExternalSystemDialogIfPresent
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.hasVisibleText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.runWithInlineRawScreenStateOnFailure
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.tapBackIcon
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilWithMitigation
import com.flashcardsopensourceapp.app.livesmoke.support.LiveSmokeContext
import com.flashcardsopensourceapp.app.livesmoke.support.appGraph
import com.flashcardsopensourceapp.app.livesmoke.support.captureVisibleWorkspaceRows
import com.flashcardsopensourceapp.app.livesmoke.support.cloudSyncChooserPrompt
import com.flashcardsopensourceapp.app.livesmoke.support.currentCloudSettingsSummary
import com.flashcardsopensourceapp.app.livesmoke.support.currentWorkspaceSummaryOrNull
import com.flashcardsopensourceapp.feature.settings.cloud.cloudPostAuthExistingButtonTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudPostAuthWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudSignInEmailFieldTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudSignInSendCodeButtonTag
import com.flashcardsopensourceapp.feature.settings.settingsAccountStatusRowTag
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

private const val linkedSignInTimeoutMillis: Long = 120_000L
private const val sendCodeAttemptLimit: Int = 3
private const val sendCodeAttemptTimeoutMillis: Long = 120_000L
private const val cloudPostAuthLinkingWorkspaceTitle: String = "Linking workspace"
private const val cloudPostAuthSyncingWorkspaceTitle: String = "Syncing workspace"
private const val cloudPostAuthGuestUpgradeTitle: String = "Upgrading guest account"
private const val cloudPostAuthRetryButtonText: String = "Retry"
private const val accountStatusSyncNowButtonText: String = "Sync now"
private const val cloudSignInSendCodeTransportFailedText: String =
    "We could not confirm that the code was sent. Check your connection and try again."
private const val cloudSignInSendCodeFailedText: String = "Could not send the sign-in code."

private enum class CloudSignInSendCodeOutcome {
    READY,
    SEND_CODE_FAILED
}

internal fun LiveSmokeContext.signInWithReviewAccount(reviewEmail: String) {
    openSettingsRow(rowTag = settingsAccountStatusRowTag, rowLabel = "Account status")
    clickText(text = "Sign in or sign up", substring = false)
    composeRule.onNodeWithTag(cloudSignInEmailFieldTag).performTextInput(reviewEmail)
    sendReviewAccountCodeWithRetries()

    completeCloudPostAuthWorkspaceSelectionIfNeeded()
    waitForLinkedAccountStatusAfterSignIn()
    tapBackIcon()
    tapBackIcon()
}

private fun LiveSmokeContext.sendReviewAccountCodeWithRetries() {
    var attemptNumber: Int = 1
    while (attemptNumber <= sendCodeAttemptLimit) {
        clickTag(tag = cloudSignInSendCodeButtonTag, label = "Send code")
        when (waitForCloudSignInSendCodeOutcome()) {
            CloudSignInSendCodeOutcome.READY -> return
            CloudSignInSendCodeOutcome.SEND_CODE_FAILED -> {
                if (attemptNumber < sendCodeAttemptLimit) {
                    System.err.println(
                        "event=android_live_smoke_send_code_retry level=warning " +
                            "attempt=$attemptNumber maxAttempts=$sendCodeAttemptLimit"
                    )
                }
            }
        }
        attemptNumber += 1
    }

    throw AssertionError(
        "Sign-in send-code failed after $sendCodeAttemptLimit attempts. " +
            "CloudSettings=${currentCloudSettingsSummary()} " +
            "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
            "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}"
    )
}

private fun LiveSmokeContext.waitForCloudSignInSendCodeOutcome(): CloudSignInSendCodeOutcome {
    try {
        waitUntilWithMitigation(
            timeoutMillis = sendCodeAttemptTimeoutMillis,
            context = "while waiting for sign-in send-code outcome"
        ) {
            isCloudSignInReadySurfaceVisible() || isCloudSignInSendCodeErrorVisible()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Sign-in send-code did not reach a terminal outcome. " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = cloudPostAuthWorkspaceRowTag)} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }

    return if (isCloudSignInReadySurfaceVisible()) {
        CloudSignInSendCodeOutcome.READY
    } else {
        CloudSignInSendCodeOutcome.SEND_CODE_FAILED
    }
}

private fun LiveSmokeContext.isCloudSignInReadySurfaceVisible(): Boolean {
    return hasVisibleText(text = accountStatusSyncNowButtonText, substring = false) ||
        hasVisibleText(text = cloudSyncChooserPrompt, substring = false) ||
        hasVisibleText(text = cloudPostAuthLinkingWorkspaceTitle, substring = false) ||
        hasVisibleText(text = cloudPostAuthSyncingWorkspaceTitle, substring = false) ||
        hasVisibleText(text = cloudPostAuthGuestUpgradeTitle, substring = false) ||
        hasVisibleText(text = cloudPostAuthRetryButtonText, substring = false)
}

private fun LiveSmokeContext.isCloudSignInSendCodeErrorVisible(): Boolean {
    return hasVisibleText(text = cloudSignInSendCodeTransportFailedText, substring = false) ||
        hasVisibleText(text = cloudSignInSendCodeFailedText, substring = false)
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
