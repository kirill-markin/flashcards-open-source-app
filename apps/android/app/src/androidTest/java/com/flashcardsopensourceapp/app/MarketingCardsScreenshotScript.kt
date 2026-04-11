package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val cardsScreenshotFileName: String = "en-3_cards-list-google-play-vocabulary.png"

private data class MarketingConceptCard(
    val frontText: String,
    val backText: String,
    val subjectTag: String
)

private val marketingConceptCards: List<MarketingConceptCard> = listOf(
    MarketingConceptCard(
        frontText = "In economics, what is opportunity cost?",
        backText = "The value of the next best alternative you give up when you choose one option over another.",
        subjectTag = "economics"
    ),
    MarketingConceptCard(
        frontText = "In biology, what is osmosis?",
        backText = "The movement of water through a membrane from lower solute concentration to higher solute concentration.",
        subjectTag = "biology"
    ),
    MarketingConceptCard(
        frontText = "In statistics, what is standard deviation?",
        backText = "A measure of how spread out values are around the average.",
        subjectTag = "statistics"
    ),
    MarketingConceptCard(
        frontText = "In chemistry, what is a catalyst?",
        backText = "A substance that speeds up a chemical reaction without being consumed by it.",
        subjectTag = "chemistry"
    ),
    MarketingConceptCard(
        frontText = "In psychology, what is cognitive bias?",
        backText = "A systematic pattern of thinking that can distort judgment and decision-making.",
        subjectTag = "psychology"
    ),
    MarketingConceptCard(
        frontText = "In physics, what is velocity?",
        backText = "The speed of an object together with the direction of its motion.",
        subjectTag = "physics"
    ),
    MarketingConceptCard(
        frontText = "In computer science, what is recursion?",
        backText = "A method where a function solves a problem by calling itself on smaller versions of that problem.",
        subjectTag = "computer science"
    )
)

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingCardsScreenshotScript {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateConceptCardsListScreenshot() {
        val robot = MarketingScreenshotRobot(composeRule = composeRule)

        robot.waitForCardsEmptyState()
        marketingConceptCards.forEach { card ->
            robot.createCard(
                frontText = card.frontText,
                backText = card.backText,
                tags = listOf(card.subjectTag),
                effortLevelTitle = "Medium"
            )
        }

        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.onAllNodesWithText("In economics, what is opportunity cost?").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("In biology, what is osmosis?").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("In statistics, what is standard deviation?").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("In chemistry, what is a catalyst?").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("In psychology, what is cognitive bias?").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("In physics, what is velocity?").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("In computer science, what is recursion?").fetchSemanticsNodes().isNotEmpty()
        }

        val screenshotPath = robot.saveScreenshot(fileName = cardsScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue("Expected screenshot file at $screenshotPath.", screenshotListing.contains(cardsScreenshotFileName))
    }
}
