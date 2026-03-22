package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    companion object {
        private const val seededCardsTimeoutMillis: Long = 30_000L
    }

    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun navigationShowsAllTopLevelScreens() {
        waitForSeededCards()

        composeRule.onNodeWithText("Cards").performClick()
        composeRule.onNodeWithText("Search cards").fetchSemanticsNode()

        composeRule.onNodeWithText("AI").performClick()
        composeRule.onNodeWithText("Android draft AI shell").fetchSemanticsNode()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Workspace").fetchSemanticsNode()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithText("Android draft review flow").fetchSemanticsNode()
    }

    @Test
    fun cardsCreateFilterEditDeleteFlowUpdatesUi() {
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

        composeRule.onNodeWithContentDescription("Filter cards").performClick()
        composeRule.onNodeWithText("draft (1)").performClick()
        composeRule.onNodeWithText("Apply").performClick()
        composeRule.onNodeWithText("Draft Android card").fetchSemanticsNode()
        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("What does val mean in Kotlin?").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithText("Clear").performClick()

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
    }

    @Test
    fun workspaceDecksAndTagsFlowWorks() {
        waitForSeededCards()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Workspace").performClick()
        composeRule.onNodeWithText("Decks").performClick()
        composeRule.onNodeWithText("Kotlin Basics").fetchSemanticsNode()

        composeRule.onNodeWithContentDescription("Add deck").performClick()
        composeRule.onNodeWithText("Deck name").performTextInput("SQLite Focus")
        composeRule.onNodeWithText("sqlite (2)").performClick()
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("SQLite Focus").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Workspace").performClick()
        composeRule.onNodeWithText("Tags").performClick()
        composeRule.onNodeWithText("Search tags").performTextInput("ui")
        composeRule.onNodeWithText("ui").fetchSemanticsNode()
    }

    @Test
    fun reviewFilterPreviewAndRatingFlowWorks() {
        waitForSeededCards()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithContentDescription("Choose review filter").performClick()
        composeRule.onNodeWithText("Android UI (3)").performClick()
        composeRule.onNodeWithText("What is Compose used for?").fetchSemanticsNode()
        composeRule.onNodeWithText("3 / 3").performClick()
        composeRule.onNodeWithText("Review queue").fetchSemanticsNode()
        composeRule.onNodeWithContentDescription("Back").performClick()

        composeRule.onNodeWithText("Show answer").performClick()
        composeRule.onNodeWithText("Good").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("What is Compose used for?").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithText("What is WorkManager for?").fetchSemanticsNode()
    }

    private fun waitForSeededCards() {
        composeRule.onNodeWithText("Cards").performClick()
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithText("What does val mean in Kotlin?").fetchSemanticsNodes().isNotEmpty()
        }
    }
}
