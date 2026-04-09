package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.AccountDangerZoneRoute
import com.flashcardsopensourceapp.feature.settings.AccountDangerZoneUiState
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountDangerZoneRouteTest {
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

        composeRule.onNodeWithText("Delete my account").assertIsNotEnabled()
        composeRule.onNodeWithText(
            "Sign in to a linked cloud account before deleting it."
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

        composeRule.onNodeWithText("Deleting...").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Back").assertIsNotEnabled()
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

        composeRule.onNodeWithText("Delete account").assertIsDisplayed()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            composeRule.onAllNodesWithText("Delete request did not finish.").fetchSemanticsNodes().size == 2
        }
        composeRule.onNodeWithText("delete my account").assertIsDisplayed()
        composeRule.onNodeWithText("Cancel").assertIsDisplayed()
    }
}
