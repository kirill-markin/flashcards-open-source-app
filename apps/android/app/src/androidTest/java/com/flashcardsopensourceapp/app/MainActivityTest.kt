package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodes
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.espresso.Espresso.pressBack
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    companion object {
        private const val seededCardsTimeoutMillis: Long = 30_000L
        private const val uiTimeoutMillis: Long = 10_000L
        private const val maxReviewCardsToRate: Int = 5
        private const val seededCardsVisibleTitle: String = "What does Material 3 provide?"
    }

    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun navigationShowsAllTopLevelScreens() {
        waitForSeededCards()

        composeRule.onNodeWithText("Search cards").fetchSemanticsNode()

        composeRule.onNodeWithText("AI").performClick()
        if (composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithText("OK").performClick()
        }
        composeRule.onNodeWithText("Android draft AI shell").fetchSemanticsNode()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Workspace").fetchSemanticsNode()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithText("Android draft review flow").fetchSemanticsNode()
    }

    @Test
    fun cardsCreateFilterEditDeleteFlowUpdatesUi() {
        waitForSeededCards()

        composeRule.onNodeWithContentDescription("Add card").performClick()

        updateCardText(fieldTitle = "Front", value = "Draft Android card")
        updateCardText(fieldTitle = "Back", value = "This came from the Android prototype.")
        composeRule.onNodeWithText("Tags").performClick()
        composeRule.onNodeWithText("Add a tag").performTextInput("draft")
        composeRule.onNodeWithText("Add tag").performClick()
        composeRule.onNodeWithText("Add a tag").performTextInput("android")
        composeRule.onNodeWithText("Add tag").performClick()
        tapBackIcon()
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Draft Android card").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithContentDescription("Filter cards").performClick()
        composeRule.onNodeWithText("draft (1)").performClick()
        composeRule.onNodeWithText("Apply").performClick()
        composeRule.onNodeWithText("Draft Android card").fetchSemanticsNode()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("What does val mean in Kotlin?").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithText("Clear").performClick()

        composeRule.onNodeWithText("Draft Android card").performClick()
        updateCardText(fieldTitle = "Front", value = "Updated Android draft card")
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Updated Android draft card").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("Updated Android draft card").performClick()
        composeRule.onNodeWithText("Delete card").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
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

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("SQLite Focus").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("SQLite Focus").performClick()
        composeRule.onNodeWithText("What does Room wrap on Android?").performClick()
        composeRule.onNodeWithText("Edit card").fetchSemanticsNode()
        pressBack()
        pressBack()
        pressBack()
        composeRule.onNodeWithText("Tags").performClick()
        composeRule.onNodeWithText("Search tags").performTextInput("ui")
        composeRule.onNodeWithText("3 cards").fetchSemanticsNode()
    }

    @Test
    fun schedulerSettingsFlowUpdatesWorkspaceSummary() {
        waitForSeededCards()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Workspace").performClick()
        composeRule.onNodeWithText("Scheduler").performClick()
        composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement("0.85")
        composeRule.onNodeWithText("Save").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Apply scheduler settings?").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("Apply").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("FSRS-6 0.85").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun settingsAccountDeviceAccessAndExportFlowsOpen() {
        waitForSeededCards()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Workspace").performClick()
        composeRule.onNodeWithText("Overview").performClick()
        composeRule.onNodeWithText("Danger zone").fetchSemanticsNode()
        composeRule.onNodeWithText("Workspace rename is available only for linked cloud workspaces.").fetchSemanticsNode()
        pressBack()
        pressBack()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Account").performClick()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.onNodeWithText("Cloud status").fetchSemanticsNode()
        pressBack()

        composeRule.onNodeWithText("Agent connections").performClick()
        composeRule.onNodeWithText("Sign in to the cloud account to manage long-lived bot connections.").fetchSemanticsNode()
        pressBack()

        composeRule.onNodeWithText("Danger zone").performClick()
        composeRule.onNodeWithText("Delete my account").fetchSemanticsNode()
        pressBack()
        pressBack()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("This device").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("This device").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Local sync diagnostics").fetchSemanticsNodes().isNotEmpty()
        }
        pressBack()

        composeRule.onNodeWithText("Access").performClick()
        composeRule.onNodeWithText("Camera").fetchSemanticsNode()
        composeRule.onNodeWithText("Camera").performClick()
        composeRule.onNodeWithText("Usage").fetchSemanticsNode()
        pressBack()
        pressBack()

        composeRule.onNodeWithText("Workspace").performClick()
        composeRule.onNodeWithText("Export").performClick()
        composeRule.onNodeWithText("Export CSV").fetchSemanticsNode()
    }

    @Test
    fun reviewFilterPreviewAndRatingFlowWorks() {
        waitForSeededCards()

        composeRule.onNodeWithText("Review").performClick()
        openReviewFilter(filterTitle = "Android UI")
        composeRule.onNodeWithText("Show answer").fetchSemanticsNode()
        composeRule.onNodeWithText("Edit card").performClick()
        composeRule.onNodeWithText("Edit card").fetchSemanticsNode()
        pressBack()
        composeRule.onNodeWithText("/", substring = true).performClick()
        composeRule.onNodeWithText("Review queue").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNodeWithText("Show answer").performClick()
        composeRule.onNodeWithText("Good").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Reviewed in this session: 1").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Show answer").fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun reviewEmptyStateSupportsGuidedCreationHandoffs() {
        waitForSeededCards()

        composeRule.onNodeWithText("Review").performClick()
        openReviewFilter(filterTitle = "Android UI")
        finishCurrentReviewFilter(maxCardsToRate = maxReviewCardsToRate)

        composeRule.onNodeWithText("No cards in this filter").fetchSemanticsNode()
        composeRule.onNodeWithText("Create card").fetchSemanticsNode()
        composeRule.onNodeWithText("Create with AI").fetchSemanticsNode()
        composeRule.onNodeWithText("Switch to all cards").fetchSemanticsNode()

        composeRule.onNodeWithText("Create with AI").performClick()
        if (composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithText("OK").performClick()
        }
        composeRule.onNodeWithText("Help me create a card.").fetchSemanticsNode()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithText("No cards in this filter").fetchSemanticsNode()
        composeRule.onNodeWithText("Switch to all cards").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Show answer").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForSeededCards() {
        composeRule.onNodeWithText("Cards").performClick()
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithText(seededCardsVisibleTitle).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun updateCardText(fieldTitle: String, value: String) {
        composeRule.onNodeWithText(fieldTitle).performClick()
        composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement(value)
        tapBackIcon()
    }

    private fun tapBackIcon() {
        composeRule.onNodeWithContentDescription("Back").performClick()
    }

    private fun openReviewFilter(filterTitle: String) {
        composeRule.onNodeWithContentDescription("Choose review filter").performClick()
        composeRule.onNodeWithText(filterTitle, substring = true).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Show answer").fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun finishCurrentReviewFilter(maxCardsToRate: Int) {
        repeat(maxCardsToRate) {
            if (composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()) {
                return
            }

            composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
                composeRule.onAllNodesWithText("Show answer").fetchSemanticsNodes().isNotEmpty()
                    || composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
            }
            if (composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()) {
                return
            }

            composeRule.onNodeWithText("Show answer").performClick()
            composeRule.onNodeWithText("Good").performClick()
        }

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
        }
    }
}
