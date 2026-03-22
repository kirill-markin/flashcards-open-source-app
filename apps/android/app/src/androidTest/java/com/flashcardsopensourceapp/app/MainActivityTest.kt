package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun navigationShowsAllTopLevelScreens() {
        waitForSeededCards()

        composeRule.onNodeWithText("Cards").performClick()
        composeRule.onNodeWithText("Android draft cards flow").fetchSemanticsNode()

        composeRule.onNodeWithText("AI").performClick()
        composeRule.onNodeWithText("Android draft AI shell").fetchSemanticsNode()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Android draft settings").fetchSemanticsNode()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithText("Android draft review flow").fetchSemanticsNode()
    }

    @Test
    fun cardsCreateEditDeleteFlowUpdatesUi() {
        waitForSeededCards()

        composeRule.onNodeWithText("Cards").performClick()
        composeRule.onNodeWithContentDescription("Add card").performClick()

        composeRule.onNodeWithText("Front text").performTextInput("Draft Android card")
        composeRule.onNodeWithText("Back text").performTextInput("This came from the Android prototype.")
        composeRule.onNodeWithText("Tags").performTextInput("draft, android")
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("Draft Android card").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("Draft Android card").performClick()
        composeRule.onNodeWithText("Front text").performTextReplacement("Updated Android draft card")
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("Updated Android draft card").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("Updated Android draft card").performClick()
        composeRule.onNodeWithText("Delete card").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("Updated Android draft card").fetchSemanticsNodes().isEmpty()
        }

        assertTrue(
            composeRule.onAllNodesWithText("Updated Android draft card").fetchSemanticsNodes().isEmpty()
        )
    }

    private fun waitForSeededCards() {
        composeRule.onNodeWithText("Cards").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("What does val mean in Kotlin?").fetchSemanticsNodes().isNotEmpty()
        }
    }
}
