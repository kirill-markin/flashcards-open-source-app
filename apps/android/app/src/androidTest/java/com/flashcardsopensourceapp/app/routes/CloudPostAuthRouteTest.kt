package com.flashcardsopensourceapp.app.routes

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthMode
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthRoute
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthUiState
import com.flashcardsopensourceapp.feature.settings.workspace.current.CurrentWorkspaceItemUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudPostAuthRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun readyToAutoLinkTriggersAutoContinueAndDisablesBack() {
        var autoContinueCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.READY_TO_AUTO_LINK,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = false,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = "Personal",
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        errorTechnicalDetails = null,
                        errorTechnicalDetailsReportId = null,
                        canRetry = false,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null
                    ),
                    onAutoContinue = {
                        autoContinueCalls += 1
                    },
                    onSelectWorkspace = {},
                    onRetry = {},
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            autoContinueCalls == 1
        }
        composeRule.onNodeWithText("Preparing Personal...").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Back").assertIsNotEnabled()
        assertEquals(1, autoContinueCalls)
    }

    @Test
    fun chooseWorkspaceStateSelectsExistingWorkspace() {
        var selectedWorkspace: CloudWorkspaceLinkSelection? = null

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.CHOOSE_WORKSPACE,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = false,
                        workspaces = listOf(
                            CurrentWorkspaceItemUiState(
                                workspaceId = "workspace-1",
                                title = "Personal",
                                subtitle = "2 decks | 12 cards",
                                isSelected = true,
                                isCreateNew = false
                            ),
                            CurrentWorkspaceItemUiState(
                                workspaceId = "new",
                                title = "Create new workspace",
                                subtitle = "Start from an empty cloud workspace",
                                isSelected = false,
                                isCreateNew = true
                            )
                        ),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        errorTechnicalDetails = null,
                        errorTechnicalDetailsReportId = null,
                        canRetry = false,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = { selection ->
                        selectedWorkspace = selection
                    },
                    onRetry = {},
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true
                )
            }
        }

        composeRule.onNodeWithText(
            "Choose a linked workspace to open on this Android device, or create a new one."
        ).assertIsDisplayed()
        composeRule.onNodeWithText("Personal (Current)").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            selectedWorkspace == CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-1")
        }
        assertEquals(
            CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-1"),
            selectedWorkspace
        )
    }

    @Test
    fun failedStateShowsRetryAndLogoutActions() {
        var retryCalls = 0
        var logoutCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.FAILED,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = false,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "Cloud sync could not finish.",
                        errorTechnicalDetails = "Cloud sync could not finish.",
                        errorTechnicalDetailsReportId = "test-cloud-post-auth-failure",
                        canRetry = true,
                        canLogout = true,
                        failureActionLabel = "Log out",
                        completionToken = null
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = {},
                    onRetry = {
                        retryCalls += 1
                    },
                    onFailureAction = {
                        logoutCalls += 1
                    },
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true
                )
            }
        }

        composeRule.onNodeWithText("Cloud sync could not finish.").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").performClick()
        composeRule.onNodeWithText("Log out").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            retryCalls == 1 && logoutCalls == 1
        }
        assertEquals(1, retryCalls)
        assertEquals(1, logoutCalls)
    }

    @Test
    fun guestLocalRecoveryReadyStateShowsRecoveryCopyAndAutoContinues() {
        var autoContinueCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.READY_TO_AUTO_LINK,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = true,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        errorTechnicalDetails = null,
                        errorTechnicalDetailsReportId = null,
                        canRetry = false,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null
                    ),
                    onAutoContinue = {
                        autoContinueCalls += 1
                    },
                    onSelectWorkspace = {},
                    onRetry = {},
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            autoContinueCalls == 1
        }
        composeRule.onNodeWithText("Preparing recovered workspace...").assertIsDisplayed()
        assertTrue(
            composeRule.onAllNodesWithText("Create new workspace").fetchSemanticsNodes().isEmpty()
        )
        composeRule.onNodeWithContentDescription("Back").assertIsNotEnabled()
        assertEquals(1, autoContinueCalls)
    }

    @Test
    fun guestLocalRecoveryFailureShowsRetryWithoutLogoutAction() {
        var retryCalls = 0
        var failureActionCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.FAILED,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = true,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "Local data recovery failed. Try again; local data stays on this device.",
                        errorTechnicalDetails = "Local data recovery failed. Try again; local data stays on this device.",
                        errorTechnicalDetailsReportId = "test-cloud-post-auth-recovery-failure",
                        canRetry = true,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = {},
                    onRetry = {
                        retryCalls += 1
                    },
                    onFailureAction = {
                        failureActionCalls += 1
                    },
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true
                )
            }
        }

        composeRule.onNodeWithText(
            "Local data recovery failed. Try again; local data stays on this device."
        ).assertIsDisplayed()
        composeRule.onNodeWithText("Retry").performClick()
        assertTrue(
            composeRule.onAllNodesWithText("Log out").fetchSemanticsNodes().isEmpty()
        )
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            retryCalls == 1
        }
        assertEquals(1, retryCalls)
        assertEquals(0, failureActionCalls)
    }
}
