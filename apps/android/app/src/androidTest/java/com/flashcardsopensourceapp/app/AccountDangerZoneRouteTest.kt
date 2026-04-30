package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.annotation.StringRes
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import com.flashcardsopensourceapp.feature.settings.account.AccountDangerZoneRoute
import com.flashcardsopensourceapp.feature.settings.account.AccountDangerZoneUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountDangerZoneRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun unlinkedStateDisablesDeleteActionAndShowsGuidance() {
        composeRule.setContent {
            FlashcardsTheme {
                AccountDangerZoneRoute(
                    uiState = AccountDangerZoneUiState(
                        isLinked = false,
                        confirmationText = "",
                        isDeleting = false,
                        deleteState = DestructiveActionState.IDLE,
                        errorMessage = "",
                        successMessage = "",
                        showDeleteConfirmation = false
                    ),
                    onRequestDeleteConfirmation = {},
                    onDismissDeleteConfirmation = {},
                    onConfirmationTextChange = {},
                    onDeleteAccount = {},
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_danger_zone_delete_button)).assertIsNotEnabled()
        composeRule.onNodeWithText(
            settingsString(SettingsR.string.settings_account_danger_zone_sign_in_guidance)
        ).assertIsDisplayed()
    }

    @Test
    fun deletingStateShowsProgressAndDisablesBackNavigation() {
        composeRule.setContent {
            FlashcardsTheme {
                AccountDangerZoneRoute(
                    uiState = AccountDangerZoneUiState(
                        isLinked = true,
                        confirmationText = "",
                        isDeleting = true,
                        deleteState = DestructiveActionState.IN_PROGRESS,
                        errorMessage = "",
                        successMessage = "",
                        showDeleteConfirmation = false
                    ),
                    onRequestDeleteConfirmation = {},
                    onDismissDeleteConfirmation = {},
                    onConfirmationTextChange = {},
                    onDeleteAccount = {},
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_deleting)).assertIsDisplayed()
        composeRule.onNodeWithContentDescription(settingsString(SettingsR.string.settings_back_content_description)).assertIsNotEnabled()
    }

    @Test
    fun failedConfirmationDialogShowsErrorAndRequiredPhrase() {
        composeRule.setContent {
            FlashcardsTheme {
                AccountDangerZoneRoute(
                    uiState = AccountDangerZoneUiState(
                        isLinked = true,
                        confirmationText = "",
                        isDeleting = false,
                        deleteState = DestructiveActionState.FAILED,
                        errorMessage = "Delete request did not finish.",
                        successMessage = "",
                        showDeleteConfirmation = true
                    ),
                    onRequestDeleteConfirmation = {},
                    onDismissDeleteConfirmation = {},
                    onConfirmationTextChange = {},
                    onDeleteAccount = {},
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_danger_zone_dialog_title)).assertIsDisplayed()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            composeRule.onAllNodesWithText("Delete request did not finish.").fetchSemanticsNodes().size == 2
        }
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_danger_zone_confirmation_phrase)).assertIsDisplayed()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_cancel)).assertIsDisplayed()
    }

    private fun settingsString(@StringRes resId: Int): String {
        return composeRule.activity.getString(resId)
    }
}
