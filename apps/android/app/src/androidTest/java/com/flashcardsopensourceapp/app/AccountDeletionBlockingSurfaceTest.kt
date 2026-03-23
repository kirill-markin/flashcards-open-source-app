package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountDeletionBlockingSurfaceTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun hiddenStateRendersNoBlockingSurface() {
        composeRule.setContent {
            FlashcardsTheme {
                AccountDeletionBlockingSurface(
                    accountDeletionState = AccountDeletionState.Hidden,
                    onRetryDeletion = {}
                )
            }
        }

        assertEquals(
            0,
            composeRule.onAllNodesWithText("Deleting account").fetchSemanticsNodes().size
        )
    }

    @Test
    fun failedStateShowsRetryActionAndErrorMessage() {
        var retryCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                AccountDeletionBlockingSurface(
                    accountDeletionState = AccountDeletionState.Failed(message = "Delete request did not finish."),
                    onRetryDeletion = {
                        retryCalls += 1
                    }
                )
            }
        }

        composeRule.onNodeWithText("Deleting account").assertIsDisplayed()
        composeRule.onNodeWithText("Delete request did not finish.").assertIsDisplayed()
        composeRule.onNodeWithText("Retry deletion").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            retryCalls == 1
        }
        assertEquals(1, retryCalls)
    }
}
