package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4

private const val cardsScreenshotFileName: String = "cards-list-google-play-vocabulary.png"

private data class MarketingVocabularyCard(
    val frontText: String,
    val backText: String
)

private val marketingVocabularyCards: List<MarketingVocabularyCard> = listOf(
    MarketingVocabularyCard(
        frontText = "meticulous",
        backText = "Very careful and precise, with strong attention to small details and accuracy."
    ),
    MarketingVocabularyCard(
        frontText = "ambivalent",
        backText = "Having mixed or conflicting feelings about a person, choice, or situation."
    ),
    MarketingVocabularyCard(
        frontText = "pragmatic",
        backText = "Focused on practical results and realistic solutions rather than ideal theories."
    ),
    MarketingVocabularyCard(
        frontText = "mitigate",
        backText = "Make something less severe or harmful, especially when you cannot remove the problem completely."
    )
)

@RunWith(AndroidJUnit4::class)
class MarketingCardsScreenshotTest {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun capturesVocabularyCardsListScreenshot() {
        val robot = MarketingScreenshotRobot(composeRule = composeRule)

        robot.waitForCardsEmptyState()
        marketingVocabularyCards.forEach { card ->
            robot.createCard(
                frontText = card.frontText,
                backText = card.backText,
                tags = listOf("vocabulary"),
                effortLevelTitle = "Medium"
            )
        }

        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("mitigate").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("pragmatic").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("ambivalent").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("meticulous").fetchSemanticsNodes().isNotEmpty()
        }

        val screenshotPath = robot.saveScreenshot(fileName = cardsScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue("Expected screenshot file at $screenshotPath.", screenshotListing.contains(cardsScreenshotFileName))
    }
}
