package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.annotation.StringRes
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.AccountStatusRoute
import com.flashcardsopensourceapp.feature.settings.AccountStatusUiState
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountStatusRouteTest : FirebaseAppInstrumentationTimeoutTest() {
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

        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_sync_blocked_title)).assertIsDisplayed()
        composeRule.onNodeWithText(
            settingsString(SettingsR.string.settings_account_status_sync_blocked_body)
        ).assertIsDisplayed()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_sync_now_button)).assertIsNotEnabled()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_logout)).performScrollTo()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_logout)).assertIsDisplayed()
    }

    private fun settingsString(@StringRes resId: Int): String {
        return composeRule.activity.getString(resId)
    }
}
