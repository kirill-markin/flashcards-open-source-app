package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.AccountStatusRoute
import com.flashcardsopensourceapp.feature.settings.AccountStatusUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountStatusRouteTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun blockedSyncStateShowsRecoveryMessageAndDisablesSyncNow() {
        composeRule.setContent {
            FlashcardsTheme {
                AccountStatusRoute(
                    uiState = AccountStatusUiState(
                        workspaceName = "Personal",
                        cloudStatusTitle = "Linked",
                        linkedEmail = "user@example.com",
                        installationId = "installation-1",
                        syncStatusText = "Cloud sync is blocked for this installation.",
                        lastSuccessfulSync = "Never",
                        isGuest = false,
                        isLinked = true,
                        isLinkingReady = false,
                        isSyncBlocked = true,
                        syncBlockedMessage = "Cloud sync is blocked for this installation.",
                        showLogoutConfirmation = false,
                        errorMessage = "",
                        isSubmitting = false
                    ),
                    onOpenSignIn = {},
                    onSyncNow = {},
                    onRequestLogout = {},
                    onDismissLogoutConfirmation = {},
                    onConfirmLogout = {},
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText("Sync is blocked on this device").assertIsDisplayed()
        composeRule.onNodeWithText(
            "Use Log out to clear local cloud identity on this device before reconnecting."
        ).assertIsDisplayed()
        composeRule.onNodeWithText("Sync now").assertIsNotEnabled()
        composeRule.onNodeWithText("Log out").performScrollTo()
        composeRule.onNodeWithText("Log out").assertIsDisplayed()
    }
}
