package com.flashcardsopensourceapp.app.routes

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.AccountDeletionBlockingSurface
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.app.accountDeletionBlockingTechnicalDetailsTag
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountDeletionBlockingSurfaceTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun hiddenStateRendersNoBlockingSurface() {
        composeRule.setContent {
            FlashcardsTheme {
                AccountDeletionBlockingSurface(
                    accountDeletionState = AccountDeletionState.Hidden,
                    onShowTechnicalDetails = { _, _ -> },
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
        var technicalDetails = ""
        var technicalDetailsReportId = ""

        composeRule.setContent {
            FlashcardsTheme {
                AccountDeletionBlockingSurface(
                    accountDeletionState = AccountDeletionState.Failed(
                        message = "Delete request did not finish.",
                        technicalDetailsReportId = "test-account-deletion-state-failed"
                    ),
                    onShowTechnicalDetails = { details, reportId ->
                        technicalDetails = details
                        technicalDetailsReportId = reportId
                    },
                    onRetryDeletion = {
                        retryCalls += 1
                    }
                )
            }
        }

        composeRule.onNodeWithText("Deleting account").assertIsDisplayed()
        composeRule.onNodeWithText(
            "The delete request did not finish yet. Retry to keep the account deletion moving forward."
        ).assertIsDisplayed()
        composeRule.onNodeWithTag(accountDeletionBlockingTechnicalDetailsTag).performClick()
        composeRule.onNodeWithText("Retry deletion").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            retryCalls == 1 &&
                technicalDetails == "AccountDeletionState.Failed: Delete request did not finish." &&
                technicalDetailsReportId == "test-account-deletion-state-failed"
        }
        assertEquals("AccountDeletionState.Failed: Delete request did not finish.", technicalDetails)
        assertEquals("test-account-deletion-state-failed", technicalDetailsReportId)
        assertEquals(1, retryCalls)
    }
}
