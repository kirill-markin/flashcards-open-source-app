package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.feature.settings.CloudPostAuthMode
import com.flashcardsopensourceapp.feature.settings.CloudPostAuthRoute
import com.flashcardsopensourceapp.feature.settings.CloudPostAuthUiState
import com.flashcardsopensourceapp.feature.settings.CurrentWorkspaceItemUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudPostAuthRouteTest {
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
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = "Personal",
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        canRetry = false,
                        canLogout = false,
                        completionToken = null
                    ),
                    onAutoContinue = {
                        autoContinueCalls += 1
                    },
                    onSelectWorkspace = {},
                    onRetry = {},
                    onLogout = {},
                    onBack = {}
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
                        canRetry = false,
                        canLogout = false,
                        completionToken = null
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = { selection ->
                        selectedWorkspace = selection
                    },
                    onRetry = {},
                    onLogout = {},
                    onBack = {}
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
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "Cloud sync could not finish.",
                        canRetry = true,
                        canLogout = true,
                        completionToken = null
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = {},
                    onRetry = {
                        retryCalls += 1
                    },
                    onLogout = {
                        logoutCalls += 1
                    },
                    onBack = {}
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
}
