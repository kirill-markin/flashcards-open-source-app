package com.flashcardsopensourceapp.app

import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import java.io.BufferedReader
import java.io.InputStreamReader

private const val screenshotUiTimeoutMillis: Long = 10_000L
private const val emptyCardsMessage: String = "No cards yet. Tap the add button to create the first card."
private const val marketingScreenshotDirectoryPath: String = "/sdcard/Download/flashcards-marketing-screenshots"
private const val opportunityCostReviewFrontText: String =
    "In economics, what is opportunity cost?"
private const val opportunityCostReviewBackText: String =
    "Opportunity cost is the value of the next best alternative you give up when you choose one option over another.\n\n" +
        "Exam example: If you spend Saturday studying for a microeconomics exam instead of working a paid shift, " +
        "the lost wages are part of the opportunity cost."

private data class MarketingReviewCardFixture(
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevelTitle: String
)

private val opportunityCostReviewCardFixture: MarketingReviewCardFixture = MarketingReviewCardFixture(
    frontText = opportunityCostReviewFrontText,
    backText = opportunityCostReviewBackText,
    tags = listOf("economics"),
    effortLevelTitle = "Medium"
)

internal typealias MainActivityComposeRule =
    AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

internal class MarketingScreenshotRobot(
    private val composeRule: MainActivityComposeRule
) {
    fun waitForCardsEmptyState() {
        openCardsTab()
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText("Search cards").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(emptyCardsMessage).fetchSemanticsNodes().isNotEmpty()
        }
    }

    fun createCard(frontText: String, backText: String, tags: List<String>, effortLevelTitle: String) {
        openCardsTab()
        composeRule.onNodeWithContentDescription("Add card").performClick()
        updateCardText(fieldTitle = "Front", value = frontText)
        updateCardText(fieldTitle = "Back", value = backText)
        scrollToText(text = effortLevelTitle)
        composeRule.onNodeWithText(effortLevelTitle).performClick()

        if (tags.isNotEmpty()) {
            composeRule.onNodeWithText("Tags").performClick()
            tags.forEach { tag ->
                composeRule.onNodeWithText("Add a tag").performTextInput(tag)
                composeRule.onNodeWithText("Add tag").performClick()
            }
            tapBackIcon()
        }

        scrollToText(text = "Save")
        waitForNode(
            matcher = hasClickAction().and(other = hasText("Save"))
        )
        composeRule.onNode(
            matcher = hasClickAction().and(other = hasText("Save"))
        ).performClick()
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText("Search cards").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(frontText).fetchSemanticsNodes().isNotEmpty()
        }
    }

    fun openReviewTab() {
        composeRule.onNode(
            matcher = hasText("Review").and(other = hasClickAction())
        ).performClick()
    }

    fun prepareOpportunityCostReviewCardForReview() {
        waitForCardsEmptyState()
        createCard(
            frontText = opportunityCostReviewCardFixture.frontText,
            backText = opportunityCostReviewCardFixture.backText,
            tags = opportunityCostReviewCardFixture.tags,
            effortLevelTitle = opportunityCostReviewCardFixture.effortLevelTitle
        )
        openReviewTab()
        waitForReviewPrompt(frontText = opportunityCostReviewCardFixture.frontText)
    }

    fun revealAnswerAndWaitForRatings() {
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText("Again").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("Hard").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("Good").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("Easy").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).fetchSemanticsNode()
    }

    fun saveScreenshot(fileName: String): String {
        composeRule.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        val screenshotPath = "$marketingScreenshotDirectoryPath/$fileName"
        runShellCommand(command = "mkdir -p $marketingScreenshotDirectoryPath")
        runShellCommand(command = "screencap -p $screenshotPath")
        return screenshotPath
    }

    private fun openCardsTab() {
        composeRule.onNode(
            matcher = hasText("Cards").and(other = hasClickAction())
        ).performClick()
    }

    private fun updateCardText(fieldTitle: String, value: String) {
        composeRule.onNodeWithText(fieldTitle).performClick()
        composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement(value)
        tapBackIcon()
    }

    private fun tapBackIcon() {
        if (composeRule.onAllNodes(matcher = hasContentDescription("Back")).fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithContentDescription("Back").performClick()
            return
        }

        composeRule.activity.runOnUiThread {
            composeRule.activity.onBackPressedDispatcher.onBackPressed()
        }
        composeRule.waitForIdle()
    }

    private fun scrollToText(text: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(text))
    }

    private fun waitForNode(matcher: SemanticsMatcher) {
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            composeRule.onAllNodes(matcher = matcher).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForReviewPrompt(frontText: String) {
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText(frontText).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    fun runShellCommand(command: String): String {
        val shellOutput = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(shellOutput).use { inputStream ->
            BufferedReader(InputStreamReader(inputStream)).use { reader ->
                return reader.readText()
            }
        }
    }
}
