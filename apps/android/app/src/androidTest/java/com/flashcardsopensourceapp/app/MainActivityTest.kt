package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import com.flashcardsopensourceapp.feature.settings.schedulerApplyButtonTag
import com.flashcardsopensourceapp.feature.settings.schedulerDesiredRetentionFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerLearningStepsFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerMaximumIntervalFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerRelearningStepsFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerSaveButtonTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    companion object {
        private const val seededCardsTimeoutMillis: Long = 30_000L
        private const val uiTimeoutMillis: Long = 10_000L
        private const val seededCardsVisibleTitle: String = "What does Material 3 provide?"
        private const val maxReviewCardsToRate: Int = 5
        private val seededReviewQueueTitles: List<String> = listOf(
            "What does Material 3 provide?",
            "What is Compose used for?",
            "What does Room wrap on Android?"
        )
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
        composeRule.onNodeWithText("Android AI").fetchSemanticsNode()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Workspace").fetchSemanticsNode()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithText("Session progress").fetchSemanticsNode()
    }

    @Test
    fun cardsCreateFilterEditDeleteFlowUpdatesUi() {
        waitForSeededCards()

        composeRule.onNodeWithContentDescription("Add card").performClick()

        updateCardText(fieldTitle = "Front", value = "Android card")
        updateCardText(fieldTitle = "Back", value = "This came from the Android app.")
        composeRule.onNodeWithText("Tags").performClick()
        composeRule.onNodeWithText("Add a tag").performTextInput("draft")
        composeRule.onNodeWithText("Add tag").performClick()
        composeRule.onNodeWithText("Add a tag").performTextInput("android")
        composeRule.onNodeWithText("Add tag").performClick()
        tapBackIcon()
        composeRule.onNode(
            matcher = hasClickAction().and(other = hasText("Save"))
        ).performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Android card").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodes(hasContentDescription("Filter cards").and(other = hasClickAction())).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNode(
            matcher = hasContentDescription("Filter cards").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("draft (1)").performClick()
        composeRule.onNodeWithText("Apply").performClick()
        composeRule.onNodeWithText("Android card").fetchSemanticsNode()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("What does val mean in Kotlin?").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithText("Clear").performClick()

        composeRule.onNodeWithText("Android card").performClick()
        updateCardText(fieldTitle = "Front", value = "Updated Android card")
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Updated Android card").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("Updated Android card").performClick()
        scrollToText(text = "Delete card")
        composeRule.onNodeWithText("Delete card").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Updated Android card").fetchSemanticsNodes().isEmpty()
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
        composeRule.onNode(
            matcher = hasText("What does Room wrap on Android?", substring = true).and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Edit card").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()
        tapBackIcon()
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
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithTag(schedulerDesiredRetentionFieldTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(schedulerLearningStepsFieldTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(schedulerRelearningStepsFieldTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(schedulerMaximumIntervalFieldTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(schedulerDesiredRetentionFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerDesiredRetentionFieldTag).performTextReplacement("0.85")
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("0.85").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(schedulerLearningStepsFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerLearningStepsFieldTag).performTextReplacement("1, 10")
        composeRule.onNodeWithTag(schedulerRelearningStepsFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerRelearningStepsFieldTag).performTextReplacement("10")
        composeRule.onNodeWithTag(schedulerMaximumIntervalFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerMaximumIntervalFieldTag).performTextReplacement("36500")
        composeRule.onNodeWithTag(schedulerSaveButtonTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerSaveButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithTag(schedulerApplyButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(schedulerApplyButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithTag(schedulerApplyButtonTag).fetchSemanticsNodes().isEmpty()
        }
        tapBackIcon()
        if (composeRule.onAllNodesWithText("Workspace").fetchSemanticsNodes().isEmpty()) {
            tapBackIcon()
        }
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithText("Workspace").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("Workspace").performClick()
        composeRule.onNodeWithText("Scheduler").performClick()
        composeRule.onNodeWithTag(schedulerDesiredRetentionFieldTag).performScrollTo()
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithText("0.85").fetchSemanticsNodes().isNotEmpty()
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
        tapBackIcon()
        tapBackIcon()

        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Account").performClick()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.onNodeWithText("Cloud status").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNodeWithText("Agent connections").performClick()
        composeRule.onNodeWithText("Sign in to the cloud account to manage long-lived bot connections.").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNodeWithText("Danger zone").performClick()
        composeRule.onNodeWithText("Delete my account").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()
        openSettingsSection(sectionTitle = "This device")
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Workspace ID").fetchSemanticsNodes().isNotEmpty()
        }
        tapBackIcon()

        openSettingsSection(sectionTitle = "Access")
        composeRule.onNodeWithText("Camera").fetchSemanticsNode()
        composeRule.onNodeWithText("Camera").performClick()
        composeRule.onNodeWithText("Usage").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Export").performClick()
        composeRule.onNodeWithText("Export CSV").fetchSemanticsNode()
    }

    @Test
    fun reviewFilterPreviewAndRatingFlowWorks() {
        waitForSeededCards()

        composeRule.onNodeWithText("Review").performClick()
        openReviewFilter(filterTitle = "Android UI")
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).fetchSemanticsNode()
        composeRule.onNodeWithText("Edit card").performClick()
        composeRule.onNodeWithText("Edit card").fetchSemanticsNode()
        tapBackIcon()
        composeRule.onNodeWithText("3 / 3").performClick()
        composeRule.onNodeWithText("Review queue").fetchSemanticsNode()
        openSeededReviewQueueCard()
        composeRule.onNodeWithText("Edit card").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()

        rateVisibleReviewCard()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).fetchSemanticsNode()
    }

    @Test
    fun reviewEmptyStateSupportsGuidedCreationHandoffs() {
        waitForSeededCards()

        composeRule.onNodeWithText("Review").performClick()
        openReviewFilter(filterTitle = "Android UI")
        drainReviewCardsUntilEmptyState()
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("No cards in this filter").fetchSemanticsNode()
        composeRule.onNodeWithText("Create card").fetchSemanticsNode()
        composeRule.onNodeWithText("Create with AI").fetchSemanticsNode()
        composeRule.onNodeWithText("Switch to all cards").fetchSemanticsNode()

        composeRule.onNodeWithText("Create card").performClick()
        composeRule.onNodeWithText("New card").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNodeWithText("No cards in this filter").fetchSemanticsNode()
        composeRule.onNodeWithText("Create with AI").performClick()
        if (composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithText("OK").performClick()
        }
        composeRule.onNodeWithText("Android AI").fetchSemanticsNode()
        composeRule.onNodeWithText("Message").fetchSemanticsNode()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithText("No cards in this filter").fetchSemanticsNode()
        composeRule.onNodeWithText("Switch to all cards").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun reviewManageDecksHandoffOpensDeckLibraryAndReturnsToReview() {
        waitForSeededCards()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithContentDescription("Choose review filter").performClick()
        composeRule.onNodeWithText("Manage filtered decks").performClick()
        composeRule.onNodeWithText("Decks").fetchSemanticsNode()
        tapBackIcon()
        composeRule.onNodeWithText("Review").fetchSemanticsNode()
        if (composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isEmpty()) {
            tapBackIcon()
        }
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
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
        if (composeRule.onAllNodes(matcher = hasContentDescription("Back")).fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithContentDescription("Back").performClick()
        } else {
            composeRule.activity.runOnUiThread {
                composeRule.activity.onBackPressedDispatcher.onBackPressed()
            }
            composeRule.waitForIdle()
        }
    }

    private fun openSettingsSection(sectionTitle: String) {
        composeRule.onNodeWithText("Settings").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText(sectionTitle).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText(sectionTitle).performClick()
    }

    private fun openReviewFilter(filterTitle: String) {
        composeRule.onNodeWithContentDescription("Choose review filter").performClick()
        composeRule.onNode(
            matcher = hasText(filterTitle, substring = true).and(other = hasClickAction())
        ).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun rateVisibleReviewCard() {
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performScrollTo()
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performClick()
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).performScrollTo()
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            val ratingButtonsGone = composeRule.onAllNodesWithTag(reviewRateGoodButtonTag).fetchSemanticsNodes().isEmpty()
            val nextCardReady = composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
            val emptyStateVisible = composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
            ratingButtonsGone && (nextCardReady || emptyStateVisible)
        }
    }

    private fun openSeededReviewQueueCard() {
        composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
            seededReviewQueueTitles.any { title ->
                composeRule.onAllNodesWithText(title, substring = true).fetchSemanticsNodes().isNotEmpty()
            }
        }
        val visibleTitle = seededReviewQueueTitles.first { title ->
            composeRule.onAllNodesWithText(title, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText(visibleTitle, substring = true).performClick()
    }

    private fun drainReviewCardsUntilEmptyState() {
        repeat(maxReviewCardsToRate) {
            if (composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()) {
                return
            }
            composeRule.waitUntil(timeoutMillis = seededCardsTimeoutMillis) {
                composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
                    || composeRule.onAllNodesWithText("No cards in this filter").fetchSemanticsNodes().isNotEmpty()
            }
            if (composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()) {
                rateVisibleReviewCard()
            }
        }
    }

    private fun scrollToText(text: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(text))
    }
}
